# ADR 0015: Plans, billing and administration

- **Status:** Accepted
- **Date:** 2026-11-08
- **Builds on:** [ADR 0008](0008-secrets-and-step-up.md) (step-up), [ADR 0005](0005-session-model.md)

## Context

Every limit in Brawzer was a temporary constant "until plans exist", the
Account page said plans weren't available, and the public Pricing page said,
truthfully, that there were no prices. Prices are a business decision that
hasn't been made, and the site must never invent one. Brawzer also had no
way to look an account up or to grant one a plan by hand.

## Decision

### Plans are configuration; prices come from Stripe

A plan is a code, a name and a set of limits (profiles, proxies, Drive
bytes, files and folders, browsing minutes per month, live sessions). The
**free plan is built in** with the limits that applied before, so existing
accounts change nothing. **Paid plans come from `BILLING_PLANS`**, each tied
to a Stripe Price id; the only prices ever shown are read from those Price
objects at request time (cached briefly). Without a Stripe key, only the
free plan exists, and the Account page says paid plans aren't set up. The
public Pricing page stays as it was until pricing is decided: it is
prerendered and must not show figures that depend on an installation.

### The plan in force lives on the account

`users.plan_code`, `plan_source` (`free`, `stripe`, `admin`) and
`plan_note` are what every limit check reads, through one
`BillingService.limitsFor`. Stripe's subscription is mirrored into
`subscriptions` by webhooks (signature verified against the raw body, every
event id recorded so a redelivery is applied once) and sets the plan while
the subscription is `active`, `trialing` or `past_due`; anything else means
free. An **administrator's grant outranks Stripe** until it is set back to
free, which hands control to whatever the subscription says.

Over-limit accounts after a downgrade keep what they have and can't add
more; nothing is deleted.

### Paying is Stripe's pages

Checkout and the billing portal are Stripe-hosted sessions; the API only
creates them and returns their URLs, behind "confirm it's you". Brawzer
never sees card data. Usage (profiles, proxies, Drive, browsing minutes
this month) is computed from Brawzer's own records.

### Administrators

`ADMIN_EMAILS` names administrators; their accounts get the role when
created and at every start. Administrators see an Admin page: accounts
listed and searched by email, one account's plan, limits, usage,
subscription and signed-in device count, and a plan set by hand with a
reason. Every admin route needs a recent sign-in; a plan change is recorded
in the target account's security history with the reason, so the person can
see it.

## Consequences

- Nothing in the code names a price, and no price appears on the public site; the honest "no prices yet" stays until a decision exists.
- A missing plan in `BILLING_PLANS` (removed from the configuration) reads as free at every limit check; Stripe keeps billing until the subscription is cancelled there.
- The monthly browsing cap counts live sessions to "now", so the Account page is right mid-session; the check happens when a session starts, not during one.
- Stripe's test mode works end to end with `STRIPE_API_BASE` pointed at a fake in tests; production requires a live key and refuses the fake.
- Administration is deliberately small: no user impersonation, no deletion, no edits to anything but the plan. Each addition is a security decision of its own.
