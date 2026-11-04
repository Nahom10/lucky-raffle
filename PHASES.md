# Implementation sequence

1. **Foundation — complete.** Schema, RLS, ledger guarantees, deposits, withdrawals, draw RPCs, and Realtime setup.
2. **Identity.** Add the Telegram authentication Edge Function, profile completion endpoint, and the browser session bootstrap.
3. **Money movement.** Implement the Telebirr deposit instruction flow, signed SMS webhook parser, deposits screen, and an admin withdrawal queue.
4. **Player experience.** Build active raffle cards, number picker, wallet balance, ticket history, and public masked-ticket board.
5. **Administration and draws.** Build raffle publishing, seed commitment creation, closings, entropy capture, draw execution, and public verification UI.
6. **Release hardening.** Add automated integration tests, rate limits, monitoring/audit tooling, deployment instructions, backups, and operational runbooks.

Each phase should be merged only after its acceptance criteria pass and before the next phase begins.
