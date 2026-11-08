# Phase 6 plan: plans, billing and administration

- **Status:** Accepted 2026-11-08 under the standing instruction to build every phase; decisions taken as recommended (table at the end). Pricing itself is not decided: nothing here names a price.
- **Progress:** Built 2026-11-08: 6.1 (plans and limits), 6.2 (Stripe checkout, portal and webhooks), 6.3 (administration), 6.4 (the pages), 6.5 (review, [docs/reviews/phase-6.md](../reviews/phase-6.md)). Design in [ADR 0015](../adr/0015-plans-and-billing.md).
- **Date:** 2026-11-08
- **Builds on:** Phases 2 to 5.

## Goal

Replace "temporary limits until plans exist" with plans: a built-in free
plan with today's limits, paid plans the installation configures and sells
through Stripe, limits that follow the plan everywhere, and a way for
administrators to look accounts up and grant plans by hand. All without
inventing a price.

## What Phase 6 delivers

- **Plan limits in one place**, read by profiles, proxies, Drive and the cloud browser; the free plan keeps the limits that applied before.
- **Stripe**: checkout and the billing portal as Stripe-hosted pages behind "confirm it's you"; webhooks verified and applied once; the subscription mirrored and the plan set from it.
- **Usage**: profiles, proxies, Drive bytes and files, browsing minutes this month (live sessions counted to now); a monthly browsing cap where a plan has one.
- **The Account page's Plan section**: the plan, its limits against usage, renewal or end date, the way to a bigger plan or to Stripe's portal, or an honest note that paid plans aren't set up.
- **Administration**: `ADMIN_EMAILS`, an Admin page (accounts, search, one account's details, a plan set by hand with a reason), every change recorded in the account's security history.

## Boundaries

- **No prices on the public site.** The Pricing page keeps its "no prices yet" content; prices appear only in the signed-in app, from Stripe, once an installation offers plans.
- **No per-session enforcement of the browsing cap** (checked at start, not mid-session).
- **No team accounts, seats or invoices of Brawzer's own**; Stripe's portal shows invoices.
- **Administration is read-mostly**: no impersonation, no deletion, nothing beyond the plan.

## Milestones

| #   | Milestone      | Delivered                                                                                                                                                                                                                                                       |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | Plans          | `@brawzer/contracts` `billing.ts`; `users.plan_code/plan_source/plan_note`; `BillingService.limitsFor` and usage; profiles, proxies, Drive and browser limits read from it; the monthly cap at session start                                                    |
| 6.2 | Stripe         | `stripe` 23.1.0; `BILLING_PLANS`, `STRIPE_*`; checkout, portal, `/billing/webhook` with the raw body, `subscriptions` and `billing_events`; security history entries                                                                                            |
| 6.3 | Administration | `users.role`, `ADMIN_EMAILS`, `AdminGuard` + recent sign-in, `/admin/accounts` (list, search, one, set plan with a reason)                                                                                                                                      |
| 6.4 | Pages          | Account → Plan (limits, usage meters, renewal, checkout and portal buttons or the honest note), the Admin page and its navigation entry for administrators only, security history copy                                                                          |
| 6.5 | Review         | Security review of webhooks, the admin surface and limit enforcement; tests: unit (plan configuration), integration against a fake Stripe (overview and prices, checkout behind step-up, webhook once and signature, limits following the plan, the cap, admin) |

## Decisions

| #   | Decision                              | Taken as                                                                                                                           |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Prices                                | Never in code or on the public site; read from Stripe Price objects for configured plans and shown in the signed-in app only       |
| 2   | Free plan                             | Built in, with the limits that applied before Phase 6, so nothing changes for existing accounts                                    |
| 3   | Where the plan in force lives         | On the user row, written by webhooks and administrators, read by every limit check                                                 |
| 4   | Which subscription statuses grant     | `active`, `trialing`, `past_due`; everything else is free                                                                          |
| 5   | Administrator grants vs subscriptions | A grant outranks Stripe until set back to free                                                                                     |
| 6   | Downgrades                            | Nothing is deleted; over-limit accounts can't add more until under the limit                                                       |
| 7   | Browsing cap                          | Calendar month, UTC, counted from Brawzer's session records; checked when a session starts                                         |
| 8   | Who is an administrator               | `ADMIN_EMAILS` in the installation's configuration, applied at account creation and at every start; never settable through the API |
| 9   | Public pricing page                   | Unchanged (prerendered, honest) until pricing is decided                                                                           |
