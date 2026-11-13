# Phase 11: the admin console

The owner's prototype (`brawzer-admin.html`, 12 November 2026) is a staff
console for a company running Brawzer: six roles, forty pages, a customer
360 view, support, billing, sales, the fleet, security and compliance, and
an audit log of every staff action. Brawzer copies it the way it copied the
desktop: the layout, the pages, the words and the behaviour as they are,
except the logo (Brawzer's mark) and anything that only looks like a
feature. Every number on it is measured from Brawzer's own data. The
prototype's sample data, its pretend AI, its co-browsing simulation and its
made-up regions are not copied; where a page needs something Brawzer
doesn't have, this plan says so and the page isn't there, rather than
there and hollow.

Rules that hold throughout: Brawzer's mark (never the prototype's icon),
the Apple font stack, Apple-style glyph tiles and never an emoji (the
prototype's pin and star characters become glyphs), honest copy, no dead
buttons, nothing on the device.

## Milestones

| #    | Milestone                                                                                                                              | Status  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 11.1 | The console: shell, staff roles and permissions, the audit log, company overview, customers and the customer 360, organisations, team  | Done    |
| 11.2 | Customer care: support tickets (a Help app for customers, the inbox for staff), account recovery, announcements, incidents and status  | Done    |
| 11.3 | Billing: subscriptions, invoices and refunds through Stripe, coupons, finance reports, approvals                                       | Done    |
| 11.4 | Technical: fleet and runtime hosts, live sessions, browser images, the extension catalogue, network, queues and health                 | Done    |
| 11.5 | Security and compliance: threats and sign-ins, blocked addresses, abuse reports and suspension, privacy and legal requests, compliance | Planned |

## The prototype's pages, and what each one is here

| Prototype page            | Here                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company overview          | 11.1. MRR and paying accounts from subscriptions and Stripe prices, sign-ups, live sessions, what needs the founder, departments, recent staff activity.                           |
| Growth & retention        | 11.1. Sign-ups and activated accounts by month, sign-up to paid, retention by sign-up month, all from the database.                                                                |
| Unit economics            | Not built: Brawzer doesn't know what its hosting costs. Revenue per plan is on Growth.                                                                                             |
| Approvals                 | 11.3, with refunds and recovery releases, which are the things that need a second person.                                                                                          |
| Team & access             | 11.1. Staff and their roles, two-factor state, last sign-in, invite by email, change role, remove; the permission matrix.                                                          |
| Plans & settings          | 11.1. Plans as the installation configures them (read-only: prices live in Stripe), connected services as configured. Prices aren't edited here.                                   |
| Customers, Customer 360   | 11.1. Every tab backed by the account's own records; personal details masked until revealed with a reason.                                                                         |
| Organisations             | 11.1. Teams: members, roles, invitations, the owner's plan. Policies (extensions, regions, downloads, clipboard): not built, Brawzer has no organisation policies yet.             |
| Support inbox, Help       | 11.2, built. Customers write from Help (desktop app and `/app/help`), staff reply from the inbox, replies go by email; notes stay inside. Live chat: not built (no realtime chat). |
| Account recovery          | 11.2. Real cases with identity checks, the 48-hour wait, a second approver, and a release that removes the lost sign-in methods.                                                   |
| In-app announcements      | 11.2. Banners every desktop shows, by audience.                                                                                                                                    |
| Help centre & replies     | 11.2, built as Saved replies. Help centre articles: not built, Brawzer has no help centre.                                                                                         |
| Support performance       | 11.2, built, from the requests: open, past target, first-reply median, ratings, low ratings to follow up, by topic and by staff member.                                            |
| Proactive help            | Not built for now: the emails it describes come in 11.2 as part of tickets where they make sense.                                                                                  |
| Subscriptions, Invoices   | 11.3, through Stripe: invoices listed and refunded with Stripe's own records. Without Stripe, the pages say so.                                                                    |
| Coupons                   | 11.3, Stripe promotion codes.                                                                                                                                                      |
| Finance reports           | 11.3, revenue movements from subscriptions.                                                                                                                                        |
| Payment recovery, offers  | Not built: Stripe runs the retries; cancellation offers are a product decision for later.                                                                                          |
| Pipeline, renewals        | Not built in this phase: Brawzer has no CRM. Renewals show on Organisations from their subscriptions.                                                                              |
| Trials to convert         | 11.3, free accounts by usage.                                                                                                                                                      |
| Fleet & regions           | 11.4, the runtime hosts the API knows and their capacity. One region: the installation's.                                                                                          |
| Live sessions             | 11.4, every running cloud browser and who holds it, ended with a reason.                                                                                                           |
| Browser images            | 11.4, the engine versions in the images. Rollout percentages: not built, images deploy by digest.                                                                                  |
| Extension catalogue       | 11.4, moderation of the catalogue (allowed, review, blocked), enforced when a profile installs one.                                                                                |
| Proxy & Shield            | 11.4, the saved proxies and their test results; site rules. Exit addresses and block-list reputation: not built, Brawzer has no address pool.                                      |
| Queues & health           | 11.4, from the health checks: database, Valkey, store, scanner, key service, email.                                                                                                |
| Incidents & status        | 11.2, incidents with updates and an in-app banner.                                                                                                                                 |
| Releases & flags          | Not built: deployments are by digest, and nothing reads feature flags.                                                                                                             |
| Autoscaling, on-call      | Not built: no provider API, no paging service.                                                                                                                                     |
| Threats & sign-ins        | 11.5, from the security events; blocked addresses enforced at sign-in; staff sign-ins.                                                                                             |
| Abuse reports             | 11.5, logged reports, with suspension that refuses sign-in and ends sessions, and a legal hold.                                                                                    |
| Vulnerabilities & keys    | Not built: the runbook holds rotation; a tracker without enforcement would be a spreadsheet.                                                                                       |
| Bot detection, risk rules | Not built: no risk engine. New-device detection exists and shows on the account.                                                                                                   |
| Privacy requests          | 11.5, requests a customer makes from their account page, with the one-month deadline, export and deletion carried out here.                                                        |
| Legal requests & holds    | 11.5, a hold stops deletion.                                                                                                                                                       |
| Compliance, data map      | 11.5, checklists kept here; the data map from what the installation actually configures.                                                                                           |
| Audit log                 | 11.1. Every staff action, including page views refused by permissions, never edited or deleted.                                                                                    |
| Goals, weekly email       | 11.5, goals kept here; the weekly founder email through Resend.                                                                                                                    |
| Investor view             | Not built: a public page of company figures is a decision for later.                                                                                                               |

## 11.1 The console

- **Where**: `/admin`, its own shell (the prototype's sidebar, top bar, search and alerts), separate from the desktop. The old Admin page under the app links here.
- **Roles**: `users.role` grows from user/admin to user, admin (the founder), care, billing, sales, technical and security. `ADMIN_EMAILS` still makes founders. A founder gives roles from Team & access. In production, staff pages need a passkey or an authenticator app on the staff member's own account, as the prototype's console security says; without one, the console says what to set up.
- **Permissions**: one table in the contracts, read by the API's guard and by the pages, so a button a role can't use is disabled and the API refuses it anyway. Limits (refunds, credit) belong to 11.3.
- **The audit log**: `staff_actions`: who, role, action, target, detail, address, when. Written by every mutation and by every refused page.
- **Customers**: accounts with plan, status (active, past due, locked, suspended, unverified), last active, account check. The 360 view's tabs read the account's own records: sign-in methods, devices (its sessions), sign-in history, subscription and usage, cloud browsers and profiles, Drive and its Trash, activity, privacy. Personal details (the address) are masked until revealed with a reason, as the prototype has it; a founder sees them.
- **Suspension**: a suspended account can't sign in and its sessions end; its data is kept.
- **Organisations**: teams.
- **Honest omissions on this milestone**: no health score (an invented number), no names (accounts have addresses), no NPS.
- **Built as**: API `/api/v1/console/*` (`apps/api/src/admin`: `StaffGuard` with `@Permission`, `StaffAuditService`, `CustomersService`, `CompanyService`, `ConsoleController`); contracts `staff.ts`; web route group `(admin)` with `AdminGate` (server, in Suspense) and the console's own shell and CSS under `.adm`. The front door `/admin` sends each role to its first page. Pill, delta and avatar colours were darkened from the prototype's so every text meets 4.5:1.
- **Tests**: `apps/web/e2e/admin-console.spec.ts` (founder's overview, customers, 360 view, notes, audit; care's masked addresses, reveal with a reason, refused page logged; invite a role, suspend and lift with sign-in refused in between; a customer gets 404 and 403). Pages checked with axe.

## 11.2 Customer care

- **Support requests** (`support_tickets`, `support_messages`): a customer writes from Help (the desktop app, or `/app/help`), choosing what it is about. Brawzer’s team sees it in the console’s Support inbox, sorted by what is closest to missing its response target (urgent 1 h, high 4 h, normal 8 h, low 24 h: Brawzer’s own targets, in the contracts). A reply goes to the customer in Help and by email; an internal note stays with staff. Status, priority, category and assignee change from the conversation, and every change is audited against the customer’s account. A customer’s reply reopens a solved request. Once solved, the customer rates it; 3 or less reopens it for a follow-up. Founders are emailed when a request comes in (`ADMIN_NOTIFICATIONS`).
- **Saved replies** (`support_saved_replies`): the team’s shared wording, inserted into a reply from the inbox and changed before sending.
- **Support performance**: every figure from the requests: open and waiting, past target, first-reply median and the share within target over 7 days, ratings, low ratings and whether anyone followed up, by topic and by staff member, 14 days of opened and solved.
- **Honest omissions**: no live chat (no realtime channel), no help centre articles, no satisfaction survey beyond the rating, no email-in (requests start in Help, where the person is already signed in).
- **Tests**: `apps/api/test/support.integration.test.ts` (the whole journey with emails, masking, permissions, audit) and `apps/web/e2e/support.spec.ts` (Help to inbox to rating, saved replies), both with the console’s axe checks.
- **Announcements** (`announcements`, `announcement_views`): a banner for everyone, for organisations’ members or for one plan’s accounts, with an optional link to a Brawzer page and an end date. Every signed-in page shows the live ones; dismissing is kept on the account. Views and clicks are counted per account. Permission `announce` (founder, care, technical).
- **Incidents and status** (`incidents`, `incident_updates`): declared with a severity, the parts affected and a first update; updates change the status; resolving records the time and turns the incident’s banner off. The public page `/status` (API `GET /status`, no sign-in) shows each part’s state from the API’s own health checks (database, cache, store, scanner, runtime) plus open public incidents, the last 7 days of resolved ones, and maintenance banners. Nothing personal leaves: no owners, no authors. Permission `incident` (founder, technical); care reads.
- **Honest omissions**: one region (the installation’s), so no per-region states; no “email affected customers” (banners and the status page carry the word, and email to everyone would be spam); maintenance is an announcement of kind Maintenance, not a scheduler.
- **Tests**: `apps/api/test/care.integration.test.ts` and `apps/web/e2e/care.spec.ts`.
- **Account recovery** (`recovery_cases`, token purposes `recovery_confirm` and `recovery_cancel`, events `recovery.*`): from the sign-in page (“Lost your passkey or authenticator?”) or started by staff for a customer who asked another way. The owner confirms from their email, which starts the 48-hour wait and sends a cancel link that works for 7 days (cancelling marks the case “possible takeover” and tells the founders). Brawzer records whether the confirming device had signed in before; staff record invoice, card and identity-document checks, each worth points. One member of staff marks the checks complete; a different one with `recoveryApprove` releases, early only with a reason that the audit log keeps as EARLY. Releasing removes every passkey, turns the authenticator off, signs out every device and emails a 30-minute password link. The answer to “recover this address” never says whether an account exists.
- **Tests**: `apps/api/test/recovery.integration.test.ts`, `apps/web/e2e/recovery.spec.ts`.

## 11.3 Billing

- **Subscriptions**: Brawzer’s own `subscriptions` rows (what Stripe’s webhooks said): paying, failing, trials, cancelling, with monthly revenue from the plan’s price and the revenue at risk. Paid plans set by hand are counted apart, since Stripe doesn’t bill them.
- **Invoices & refunds**: read live from Stripe (`GET /v1/invoices`), one page at a time, each tied back to the account by its Stripe customer. A refund goes to Stripe at once when it is within the role’s limit (care 50, billing 500, in the price’s currency; founders unlimited) and otherwise becomes an approval. Over what is still refundable is refused.
- **Coupons**: Stripe coupons with promotion codes, listed, made and turned on or off here. Over 15% off from anyone but a founder becomes an approval.
- **Approvals** (`approvals`): the four-eyes rule. Approving carries the request out in Stripe; nobody decides their own; every decision is audited.
- **Finance**: twelve months of MRR movements from the `billing.subscription_*` events (which now record the previous plan, so upgrades and downgrades have values; older changes are counted, not valued), with start and end MRR from the subscriptions in force. CSV download. Tax, fees and cash stay in Stripe’s reports.
- **Accounts likely to upgrade**: free accounts by browsing minutes over 30 days, Drive use, live sessions and last activity. No score, no automatic offers.
- **Honest omissions**: no payment retries from here (Stripe runs them), no credits or balances, no cancellation offers, no CRM pipeline, no VAT report.
- **Tests**: `apps/api/test/billing-console.integration.test.ts` against the Stripe double (which now answers invoices, refunds, coupons and promotion codes) and `apps/web/e2e/money.spec.ts`.

## 11.4 Technical

- **Fleet**: `GET /console/tech/fleet` joins the existing admin runtime view (hosts, health, live, capacity, warm pool) with Docker’s container list per host and 24-hour figures from `browser_sessions`: started, ended, never started, median seconds to first frame.
- **Live sessions**: machine facts only (account handle, engine, host, profile, timings, viewers from this instance’s stream relays, proxy, extension count); End with a reason, audited; refreshes every 30 seconds.
- **Browser images**: the configured runtime and egress images, the API version, engines offered (`BROWSER_ENGINES`) with live sessions and profiles per engine.
- **Extension catalogue** (`extension_policies`): the catalogue from the contracts with installs counted from profiles; allowed, under review or blocked. Blocking (permission `extModerate`: founder, technical, security) needs a reason, removes the slug from every profile, emails each affected account, and `ProfilesService.update` refuses blocked slugs with the reason.
- **Proxy & Shield**: counts of saved proxies by protocol and test state, the latest failed tests (protocol, reached, signed in, reason only), live sessions through a proxy, site rule counts.
- **Queues & health**: the health probes, retention’s last run (`RetentionService.lastRunAt`), warm pool, starts, and open requests, reports and quarantined files.
- **Honest omissions**: no host CPU or memory, no per-session frame rate or latency, no browser version read at run time, no rollout percentages, no job queue, no exit-address pool or block lists.
- **Tests**: `apps/api/test/tech-console.integration.test.ts` and `apps/web/e2e/tech.spec.ts`.
