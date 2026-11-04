# Lucky Raffle deployment and operations

## Database

Apply `supabase/migrations/001_init.sql` and then `supabase/migrations/002_operations.sql` to a new Supabase project.

## Edge Functions

Deploy the functions with JWT gateway verification disabled because `telegram-auth` issues the application JWT after it validates Telegram `initData`; every privileged function performs its own signature and role checks.

```bash
supabase functions deploy telegram-auth --no-verify-jwt
supabase functions deploy sms-webhook --no-verify-jwt
supabase functions deploy raffle-admin --no-verify-jwt
supabase secrets set TELEGRAM_BOT_TOKEN=... SUPABASE_JWT_SECRET=... RAFFLE_SMS_WEBHOOK_SECRET=...
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions by Supabase. Never publish the service-role key. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` only in the Mini App host.

## Release checklist

1. Set an HTTPS Mini App URL in BotFather and configure its `/start` button.
2. Send only parsed, trusted Telebirr receipt events to `sms-webhook`; use the `x-raffle-webhook-secret` header.
3. Create a small test raffle, deposit, ticket purchase, rejected withdrawal, and draw before opening public sales.
4. For every raffle, publish the `seed_hash` before changing status to `open`. Save its public entropy and revealed seed in the draw record.
5. Restrict staff access to the Supabase dashboard and rotate the webhook secret after any suspected disclosure.
