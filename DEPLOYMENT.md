# Lucky Raffle deployment and operations

## Database

Apply `supabase/migrations/001_init.sql` and then `supabase/migrations/002_operations.sql` to a new Supabase project.

## Edge Functions

Deploy the functions with JWT gateway verification disabled because `telegram-auth` issues the application JWT after it validates Telegram `initData`; every privileged function performs its own signature and role checks.

```bash
supabase functions deploy telegram-auth --no-verify-jwt
supabase functions deploy sms-webhook --no-verify-jwt
supabase functions deploy raffle-admin --no-verify-jwt
supabase functions deploy telegram-bot-webhook --no-verify-jwt
supabase secrets set TELEGRAM_BOT_TOKEN=... RAFFLE_JWT_SECRET=... RAFFLE_SMS_WEBHOOK_SECRET=...
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions by Supabase. Never publish the service-role key. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` only in the Mini App host.

## Release checklist

1. Deploy the Mini App to an HTTPS URL, then set `RAFFLE_MINI_APP_URL` and `RAFFLE_TELEGRAM_WEBHOOK_SECRET` as Edge Function secrets.
2. Register Telegram's webhook at `https://<project-ref>.supabase.co/functions/v1/telegram-bot-webhook`, supplying that same secret token. The bot's `/start` flow requests the user's own contact and then sends the Mini App button.
3. Send only parsed, trusted Telebirr receipt events to `sms-webhook`; use the `x-raffle-webhook-secret` header.
4. Create a small test raffle, deposit, ticket purchase, rejected withdrawal, and draw before opening public sales.
5. For every raffle, publish the `seed_hash` before changing status to `open`. Save its public entropy and revealed seed in the draw record.
6. Restrict staff access to the Supabase dashboard and rotate the webhook secret after any suspected disclosure.
