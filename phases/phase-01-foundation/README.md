# Phase 1 — Supabase foundation

## Outcome

The database can hold raffle definitions, ticket ownership, an append-only wallet ledger, deposits, SMS receipts, withdrawal requests, fair-draw disclosures, settings, and an audit trail.

## Delivered

- Initial raffle tables, enum types, indexes, views, RLS policies, and Realtime publication.
- Player RPCs for buying numbers, creating/claiming deposits, and placing withdrawal holds.
- Service-role RPCs for matching Telebirr SMS receipts and completing a seeded, publicly verifiable draw.
- Idempotency keys for money movements and uniqueness controls for ticket numbers and receipt transaction IDs.
- Compatibility with the existing delivery application admin JWT function through `raffle_is_admin()`.

## Acceptance criteria

1. Apply `001_init.sql` and `002_operations.sql` in sequence.
2. Confirm `is_admin()` works for a profile with `is_admin = true`.
3. With a service-role client, create a draft raffle, its seed secret, and an open raffle.
4. With an authenticated player that has a completed profile and a positive ledger balance, call `buy_numbers` once; the matching ticket and purchase ledger row must be committed atomically.
5. Call `process_sms` twice with the same receipt transaction ID; the second call must return `duplicate` and never credit the wallet twice.

## Phase 2 contract

Phase 2 will provide a dedicated Telegram-to-Supabase-auth bridge that creates `auth.users` records and then upserts `profiles`. It must be service-role-only, verify Telegram `initData` server-side, and never send privileged Supabase credentials to the browser.
