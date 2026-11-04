-- Reduce the minimum deposit consistently in the database and player RPC.
alter table public.deposits drop constraint if exists deposits_amount_check;
alter table public.deposits add constraint deposits_amount_check check (amount >= 10);

create or replace function public.create_deposit(p_amount numeric) returns public.deposits
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); d public.deposits; c text;
begin
  if uid is null then raise exception 'auth'; end if;
  if p_amount < 10 then raise exception 'min_amount'; end if;
  if (select count(*) from public.deposits where user_id = uid and status in ('pending','verifying') and expires_at > now()) >= 3
    then raise exception 'too_many_open'; end if;
  loop
    c := 'LR' || lpad((floor(random()*9000)+1000)::int::text, 4, '0');
    exit when not exists (select 1 from public.deposits where code = c);
  end loop;
  insert into public.deposits(user_id, code, amount) values (uid, c, p_amount) returning * into d;
  return d;
end $$;
