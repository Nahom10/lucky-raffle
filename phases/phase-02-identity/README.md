# Phase 2 — Identity

Delivered by `supabase/functions/telegram-auth`. It verifies Telegram `initData`, creates an `auth.users` and `profiles` record on first use, rejects banned accounts, and issues a short-lived database JWT. No privileged key reaches the browser.
