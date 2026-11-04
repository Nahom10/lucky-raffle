# Lucky Raffle

Standalone Telegram Mini App for Lucky Raffle.

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Supabase foundation: raffle domain, wallet ledger, deposit and draw database rules | Complete |
| 2 | Telegram authentication bridge and player profile onboarding | Complete |
| 3 | Wallet deposits, SMS receipt webhook, and withdrawal requests | Complete |
| 4 | Player raffle discovery, ticket purchase, and live ticket tiles | Complete |
| 5 | Admin raffle creation, draw controls, and provably-fair result display | Complete |
| 6 | Realtime setup, release controls, deployment, and operations hardening | Complete (deployment requires credentials) |

## Phase 1 deliverable

The standalone migrations are in [`supabase/migrations`](supabase/migrations). Apply them in numeric order. Migration `004_minimum_deposit_10_etb.sql` lowers the minimum player deposit to 10 ETB.

The first administrator is created by setting their profile's `is_admin` flag using the Supabase dashboard or service role after their first Telegram login.

See [the Phase 1 notes](phases/phase-01-foundation/README.md) for the acceptance criteria and the next-phase contract.
