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
3. Add the merchant payment account to the public `settings` table. Run this once in the Supabase SQL Editor, replacing the sample values with the account that receives player deposits:

   ```sql
   insert into public.settings (key, value)
   values ('merchant_payment', jsonb_build_object(
     'provider', 'Telebirr',
     'account_name', 'Your registered account name',
     'account_no', 'Your Telebirr account number'
   ))
   on conflict (key) do update set value = excluded.value;
   ```

4. Configure the SMS-forwarder on the merchant phone that receives the payment confirmations. Its HTTP endpoint is `https://<project-ref>.supabase.co/functions/v1/sms-webhook`. Use `POST`, JSON body, and header `x-raffle-webhook-secret: <RAFFLE_SMS_WEBHOOK_SECRET>`. Send the raw SMS as `raw` (or `message`) and, when the app can map fields, also send `amount` and `txnId`. The endpoint recognises common JSON field names and attempts to parse a Telebirr-style receipt. A query parameter `?secret=<RAFFLE_SMS_WEBHOOK_SECRET>` is available only for forwarders that cannot send headers.

   Example JSON body:

   ```json
   {"raw":"<the full Telebirr SMS>","amount":50,"txnId":"<receipt transaction id>","code":"LR1234","phone":"<sender>"}
   ```

   Do not forward unrelated messages. Use the payment reference shown in the Mini App when Telebirr supports a payment note; it allows a receipt to be credited without the player first entering its transaction ID.

5. Create a small test raffle, deposit, ticket purchase, rejected withdrawal, and draw before opening public sales.
6. For every raffle, publish the `seed_hash` before changing status to `open`. Save its public entropy and revealed seed in the draw record.
7. Restrict staff access to the Supabase dashboard and rotate the webhook secret after any suspected disclosure.
