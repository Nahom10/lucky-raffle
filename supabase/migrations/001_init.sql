-- Lucky Raffle: Supabase (PostgreSQL) schema
-- Initial Lucky Raffle domain, wallet, draw, and RLS setup.
create extension if not exists pgcrypto;

-- ---------- types ----------
create type raffle_type   as enum ('cash','item');
create type raffle_status as enum ('draft','open','closed','drawn','cancelled');
create type ledger_kind   as enum ('deposit','purchase','prize','refund','withdrawal_hold','withdrawal_release','adjustment');
create type deposit_status as enum ('pending','verifying','credited','rejected','expired');
create type wd_status     as enum ('requested','approved','paid','rejected');

-- ---------- tables ----------
-- id = Supabase auth user id (created by the telegram-auth Edge Function)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  telegram_id bigint unique not null,
  name text not null,
  phone text,
  is_admin boolean not null default false,
  is_banned boolean not null default false,
  is_house boolean not null default false,          -- optional labeled house account
  created_at timestamptz not null default now()
);

create table raffles (
  id uuid primary key default gen_random_uuid(),
  type raffle_type not null,
  title text not null,
  total_numbers int not null check (total_numbers between 2 and 1000),
  price numeric(12,2) not null check (price > 0),
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  prizes jsonb not null default '[]',               -- [{"kind":"pct","value":50},{"kind":"birr","value":300}]
  item_name text, item_value numeric(12,2), item_image_url text,
  status raffle_status not null default 'draft',
  max_per_user int, min_buyers int, deadline timestamptz,
  seed_hash text,                                   -- sha256(seed_secret), published before sales
  created_at timestamptz not null default now()
);

-- secret seed: no RLS policies = unreadable by clients (service role only)
create table raffle_secrets (raffle_id uuid primary key references raffles(id) on delete cascade, seed_secret text not null);
alter table raffle_secrets enable row level security;

create table tickets (
  raffle_id uuid not null references raffles(id) on delete cascade,
  number int not null,
  user_id uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  primary key (raffle_id, number)                   -- a number can only be sold once
);
create index on tickets (user_id);

-- append-only wallet ledger. balance = sum(amount)
create table ledger (
  id bigserial primary key,
  user_id uuid not null references profiles(id),
  kind ledger_kind not null,
  amount numeric(14,2) not null,                    -- signed
  ref_type text, ref_id uuid, note text,
  idem_key text unique not null,                    -- makes every money move idempotent
  created_at timestamptz not null default now()
);
create index on ledger (user_id);
create view balances with (security_invoker = true) as
  select user_id, sum(amount) as balance from ledger group by user_id;

create table deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  code text unique not null,                        -- e.g. LR4821
  amount numeric(12,2) not null check (amount >= 50),
  claimed_txn text,                                 -- txn id typed by the user (not unique, never trusted alone)
  status deposit_status not null default 'pending',
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now()
);

create table sms_inbox (
  id bigserial primary key,
  raw text not null, amount numeric(12,2), txn_id text unique not null,  -- unique = no reused receipt
  code text, phone text,
  matched_deposit uuid references deposits(id),
  created_at timestamptz not null default now()
);

create table withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  bank text not null, account_no text not null, account_name text not null,
  amount numeric(12,2) not null check (amount > 0),
  status wd_status not null default 'requested',
  paid_ref text, created_at timestamptz not null default now()
);

create table draws (
  raffle_id uuid primary key references raffles(id),
  entropy text not null,                            -- public randomness (e.g. drand round) fixed at draw time
  seed_secret text not null,                        -- revealed after the draw
  results jsonb not null, drawn_at timestamptz not null default now()
);

create table audit_log (id bigserial primary key, actor uuid, action text not null, detail jsonb, at timestamptz not null default now());
create table settings (key text primary key, value jsonb not null);   -- merchant Telebirr number, limits, ...

-- ---------- helpers ----------
create function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from profiles where id = auth.uid()), false) $$;

-- players see names and a masked phone, never the full number
create view ticket_public as
  select t.raffle_id, t.number, p.name, p.is_house,
         case when length(p.phone) > 5 then left(p.phone,2) || '****' || right(p.phone,3) else p.phone end as phone_masked,
         (t.user_id = auth.uid()) as mine
  from tickets t join profiles p on p.id = t.user_id;

-- ---------- player RPCs ----------
create function buy_numbers(p_raffle uuid, p_numbers int[]) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r raffles; p profiles; cost numeric; bal numeric; n int; owned int;
begin
  if uid is null then raise exception 'auth'; end if;
  select * into p from profiles where id = uid;
  if p.is_banned or p.phone is null then raise exception 'profile_incomplete'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));          -- serialises this user's spending
  select * into r from raffles where id = p_raffle;
  if r.status <> 'open' or (r.deadline is not null and r.deadline < now()) then raise exception 'raffle_closed'; end if;
  if coalesce(array_length(p_numbers,1),0) = 0 then raise exception 'empty'; end if;
  foreach n in array p_numbers loop
    if n < 1 or n > r.total_numbers then raise exception 'bad_number'; end if;
  end loop;
  select count(*) into owned from tickets where raffle_id = p_raffle and user_id = uid;
  if r.max_per_user is not null and owned + array_length(p_numbers,1) > r.max_per_user then raise exception 'limit'; end if;
  cost := r.price * array_length(p_numbers,1);
  select coalesce(sum(amount),0) into bal from ledger where user_id = uid;
  if bal < cost then raise exception 'insufficient_balance'; end if;
  begin
    insert into tickets(raffle_id, number, user_id) select p_raffle, x, uid from unnest(p_numbers) x;
  exception when unique_violation then raise exception 'number_taken';
  end;
  insert into ledger(user_id, kind, amount, ref_type, ref_id, idem_key)
    values (uid, 'purchase', -cost, 'raffle', p_raffle, 'buy:' || gen_random_uuid());
  if (select count(*) from tickets where raffle_id = p_raffle) >= r.total_numbers then
    update raffles set status = 'closed' where id = p_raffle;   -- full: ready to draw
  end if;
end $$;

create function create_deposit(p_amount numeric) returns deposits
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); d deposits; c text;
begin
  if uid is null then raise exception 'auth'; end if;
  if p_amount < 50 then raise exception 'min_amount'; end if;
  if (select count(*) from deposits where user_id = uid and status in ('pending','verifying') and expires_at > now()) >= 3
    then raise exception 'too_many_open'; end if;
  loop
    c := 'LR' || lpad((floor(random()*9000)+1000)::int::text, 4, '0');
    exit when not exists (select 1 from deposits where code = c);
  end loop;
  insert into deposits(user_id, code, amount) values (uid, c, p_amount) returning * into d;
  return d;
end $$;

create function mark_paid(p_deposit uuid, p_txn text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update deposits set status = 'verifying', claimed_txn = upper(nullif(trim(p_txn),''))
   where id = p_deposit and user_id = auth.uid() and status in ('pending','verifying') and expires_at > now();
  return try_match(p_deposit);                                  -- SMS may already be waiting in the inbox
end $$;

create function request_withdrawal(p_bank text, p_acc text, p_name text, p_amount numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); bal numeric; w uuid;
begin
  if uid is null then raise exception 'auth'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  select coalesce(sum(amount),0) into bal from ledger where user_id = uid;
  if p_amount <= 0 or p_amount > bal then raise exception 'insufficient_balance'; end if;
  insert into withdrawals(user_id, bank, account_no, account_name, amount)
    values (uid, p_bank, p_acc, p_name, p_amount) returning id into w;
  insert into ledger(user_id, kind, amount, ref_type, ref_id, idem_key)
    values (uid, 'withdrawal_hold', -p_amount, 'withdrawal', w, 'wd:' || w);
  return w;
end $$;

-- ---------- server-only functions (called from Edge Functions with the service role) ----------
create function credit_deposit(d_id uuid, s_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare d deposits; s sms_inbox;
begin
  select * into d from deposits where id = d_id for update;
  select * into s from sms_inbox where id = s_id for update;
  if d.status = 'credited' or s.matched_deposit is not null then return; end if;
  insert into ledger(user_id, kind, amount, ref_type, ref_id, idem_key)
    values (d.user_id, 'deposit', d.amount, 'deposit', d.id, 'dep:' || d.id);
  update deposits set status = 'credited' where id = d.id;
  update sms_inbox set matched_deposit = d.id where id = s.id;
end $$;

create function try_match(d_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare d deposits; s sms_inbox;
begin
  select * into d from deposits where id = d_id;
  if d.status not in ('pending','verifying') or d.expires_at < now() then return false; end if;
  select * into s from sms_inbox
   where matched_deposit is null and amount = d.amount
     and (code = d.code or (d.claimed_txn is not null and txn_id = d.claimed_txn))
   order by id limit 1;
  if s.id is null then return false; end if;
  perform credit_deposit(d.id, s.id);
  return true;
end $$;

-- called by the sms-webhook Edge Function after it parses the Telebirr SMS
create function process_sms(p_raw text, p_amount numeric, p_txn text, p_code text, p_phone text) returns text
language plpgsql security definer set search_path = public as $$
declare sid bigint; d uuid;
begin
  insert into sms_inbox(raw, amount, txn_id, code, phone) values (p_raw, p_amount, upper(p_txn), upper(p_code), p_phone)
    on conflict (txn_id) do nothing returning id into sid;
  if sid is null then return 'duplicate'; end if;
  select id into d from deposits
   where status in ('pending','verifying') and expires_at > now() and amount = p_amount
     and (code = upper(p_code) or claimed_txn = upper(p_txn)) limit 1;
  if d is not null and try_match(d) then return 'matched'; end if;
  return 'stored';
end $$;

-- Provably fair draw. Order = sha256(secret : entropy : number). The hash of the secret was published
-- before sales; the entropy (a public beacon such as drand) is fixed only at draw time, so nobody
-- (including the admin) can pick the winners in advance.
create function run_draw(p_raffle uuid, p_entropy text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r raffles; sec text; k int; res jsonb := '[]'; w record; i int := 0; pz jsonb; amt numeric; net numeric;
begin
  select * into r from raffles where id = p_raffle for update;
  if r.status not in ('open','closed') then raise exception 'bad_status'; end if;
  select seed_secret into sec from raffle_secrets where raffle_id = p_raffle;
  net := r.total_numbers * r.price * (1 - r.commission_pct / 100);
  k := case when r.type = 'item' then 1 else jsonb_array_length(r.prizes) end;
  if (select count(*) from tickets where raffle_id = p_raffle) < k then raise exception 'not_enough_tickets'; end if;
  for w in select number, user_id from tickets where raffle_id = p_raffle
           order by encode(digest(sec || ':' || p_entropy || ':' || number, 'sha256'), 'hex') limit k loop
    i := i + 1; amt := 0;
    if r.type = 'cash' then
      pz := r.prizes -> (i - 1);
      amt := case when pz->>'kind' = 'pct' then round(net * (pz->>'value')::numeric / 100, 2) else (pz->>'value')::numeric end;
      insert into ledger(user_id, kind, amount, ref_type, ref_id, idem_key)
        values (w.user_id, 'prize', amt, 'raffle', p_raffle, 'prize:' || p_raffle || ':' || i);
    end if;
    res := res || jsonb_build_object('rank', i, 'number', w.number, 'user_id', w.user_id, 'prize', amt, 'item', r.item_name);
  end loop;
  insert into draws(raffle_id, entropy, seed_secret, results) values (p_raffle, p_entropy, sec, res);
  update raffles set status = 'drawn' where id = p_raffle;
  insert into audit_log(actor, action, detail) values (auth.uid(), 'draw', jsonb_build_object('raffle', p_raffle));
  return res;
end $$;

revoke all on function credit_deposit, try_match, process_sms, run_draw from public, anon, authenticated;
grant execute on function credit_deposit, try_match, process_sms, run_draw to service_role;
grant execute on function buy_numbers, create_deposit, mark_paid, request_withdrawal to authenticated;

-- ---------- Row Level Security ----------
alter table profiles    enable row level security;
alter table raffles     enable row level security;
alter table tickets     enable row level security;
alter table ledger      enable row level security;
alter table deposits    enable row level security;
alter table sms_inbox   enable row level security;
alter table withdrawals enable row level security;
alter table draws       enable row level security;
alter table audit_log   enable row level security;
alter table settings    enable row level security;

create policy "own profile"      on profiles for select using (id = auth.uid() or is_admin());
create policy "edit own profile" on profiles for update using (id = auth.uid());
revoke update on profiles from authenticated;
grant  update (name, phone) on profiles to authenticated;      -- players can never make themselves admin

create policy "see raffles"   on raffles for select using (status <> 'draft' or is_admin());
create policy "admin raffles" on raffles for all    using (is_admin()) with check (is_admin());

create policy "own tickets"   on tickets     for select using (user_id = auth.uid() or is_admin());
create policy "own ledger"    on ledger      for select using (user_id = auth.uid() or is_admin());
create policy "own deposits"  on deposits    for select using (user_id = auth.uid() or is_admin());
create policy "own withdraws" on withdrawals for select using (user_id = auth.uid() or is_admin());
create policy "admin approve" on withdrawals for update using (is_admin());
create policy "see draws"     on draws       for select using (true);
create policy "admin sms"     on sms_inbox   for select using (is_admin());
create policy "admin audit"   on audit_log   for select using (is_admin());
create policy "read settings" on settings    for select using (true);
create policy "admin settings" on settings   for all using (is_admin()) with check (is_admin());

-- ---------- Realtime (live tiles and live draw) ----------
alter publication supabase_realtime add table tickets, draws, raffles;

-- ---------- Cron (enable pg_cron in Supabase) ----------
-- select cron.schedule('expire-deposits', '* * * * *',
--   $$ update deposits set status='expired' where status in ('pending','verifying') and expires_at < now() $$);
