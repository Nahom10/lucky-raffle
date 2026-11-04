-- Bot-first registration: phone numbers are received only from Telegram's
-- request_contact keyboard button and matched to the account's Telegram ID.
create table telegram_contacts (
  telegram_id bigint primary key,
  phone text not null,
  name text not null,
  username text,
  shared_at timestamptz not null default now()
);

alter table telegram_contacts enable row level security;
