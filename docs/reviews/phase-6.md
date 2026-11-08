# Phase 6 review: plans, billing and administration

Reviewed 2026-11-08 at the end of milestone 6.5. Plan:
[docs/plans/phase-6.md](../plans/phase-6.md); design:
[ADR 0015](../adr/0015-plans-and-billing.md).

## What was built

| Milestone | Delivered                                                                                                                                                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1       | Plans in `@brawzer/contracts` (`billing.ts`), the free plan with the former limits, `BILLING_PLANS` for paid plans, `users.plan_code/plan_source/plan_note`, `BillingService.limitsFor` and usage; profiles, proxies, Drive and the cloud browser read their limits from the plan; the monthly cap |
| 6.2       | Stripe: customer per account, checkout and portal sessions behind "confirm it's you", the webhook on the raw body with every event applied once, `subscriptions` and `billing_events`, the plan set from the subscription's status, history entries                                                |
| 6.3       | Administration: `users.role`, `ADMIN_EMAILS` (at creation and at start), `AdminGuard` plus a recent sign-in, accounts listed and searched, one account's details, a plan set by hand with a reason                                                                                                 |
| 6.4       | The Account page's Plan section (limits against usage with meters, renewal, checkout, portal, or the note that paid plans aren't set up), the Admin page, its navigation entry for administrators only, history copy                                                                               |

## Security review

1. **Webhooks.** Verified with Stripe's signature over the raw body (Nest's `rawBody`), with the secret required whenever a key is set; a forged signature gets 401 (integration test). Every event id is recorded first, so a redelivery is applied once (integration test). Only subscription and checkout events change anything; the customer must already be the account's (created by the account's own checkout), so a foreign subscription can't be attached. The route has no session and no CSRF, by nature; it is outside Nest's routing and rate limiting.
2. **Who pays for what.** Checkout and the portal need a session and a recent sign-in, and only ever create Stripe-hosted sessions for the account's own customer; the plan code must be configured. Card data never reaches Brawzer. _Remaining:_ the success and cancel URLs are plain redirects; the plan appears when the webhook lands, not on return.
3. **Limits.** One reader (`limitsFor`) for every module; the former constants remain only as the free plan's values. Downgrades delete nothing. The monthly browsing cap is checked at start; a session already running isn't cut (documented).
4. **Administration.** The role comes only from configuration, never from a request; `AdminGuard` is a plain 403 for everyone else, and the Admin page is a 404 for them. Every admin route needs a recent sign-in. A plan set by hand carries a reason, outranks Stripe until set back, and is written to the target's security history (so the person sees it) with the reason. _Remaining:_ no audit log beyond the security history; no two-person rule; administrators see email addresses, plans and usage, nothing more.
5. **Prices.** None in code; none on the public site; read from Stripe for configured plans and cached ten minutes. A misconfigured price id logs a warning and the plan shows without a price rather than with a wrong one.
6. **Production checks.** A Stripe key must be live, the webhook secret must be set with it, and the fake Stripe base is refused.

## Verification

| Check             | Result                                                                                                                                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests        | contracts (plan shapes), API (plan configuration parsing, config rules for Stripe and administrators)                                                                                                                                                                                                                       |
| Integration tests | `apps/api/test/billing.integration.test.ts` against a fake Stripe: the free plan and today's limits, paid plans with Stripe's prices, the unavailable case, checkout behind step-up, the subscription applied once with a verified signature and the plan's limits following, cancellation, the monthly cap, administration |
| Browser tests     | The Account page's Plan section (limits, usage, the honest note) and no Admin entry for ordinary accounts; accessibility checks                                                                                                                                                                                             |
| Lint, types       | clean                                                                                                                                                                                                                                                                                                                       |
