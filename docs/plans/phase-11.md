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
| 11.2 | Customer care: support tickets (a Help app for customers, the inbox for staff), account recovery, announcements, incidents and status  | Planned |
| 11.3 | Billing: subscriptions, invoices and refunds through Stripe, coupons, finance reports, approvals                                       | Planned |
| 11.4 | Technical: fleet and runtime hosts, live sessions, browser images, the extension catalogue, network, queues and health                 | Planned |
| 11.5 | Security and compliance: threats and sign-ins, blocked addresses, abuse reports and suspension, privacy and legal requests, compliance | Planned |

## The prototype's pages, and what each one is here

| Prototype page            | Here                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company overview          | 11.1. MRR and paying accounts from subscriptions and Stripe prices, sign-ups, live sessions, what needs the founder, departments, recent staff activity.               |
| Growth & retention        | 11.1. Sign-ups and activated accounts by month, sign-up to paid, retention by sign-up month, all from the database.                                                    |
| Unit economics            | Not built: Brawzer doesn't know what its hosting costs. Revenue per plan is on Growth.                                                                                 |
| Approvals                 | 11.3, with refunds and recovery releases, which are the things that need a second person.                                                                              |
| Team & access             | 11.1. Staff and their roles, two-factor state, last sign-in, invite by email, change role, remove; the permission matrix.                                              |
| Plans & settings          | 11.1. Plans as the installation configures them (read-only: prices live in Stripe), connected services as configured. Prices aren't edited here.                       |
| Customers, Customer 360   | 11.1. Every tab backed by the account's own records; personal details masked until revealed with a reason.                                                             |
| Organisations             | 11.1. Teams: members, roles, invitations, the owner's plan. Policies (extensions, regions, downloads, clipboard): not built, Brawzer has no organisation policies yet. |
| Support inbox, Help       | 11.2. A real ticket system: customers write from a Help app, staff reply from the inbox, replies go by email. Live chat: not built (no realtime chat).                 |
| Account recovery          | 11.2. Real cases with identity checks, the 48-hour wait, a second approver, and a release that removes the lost sign-in methods.                                       |
| In-app announcements      | 11.2. Banners every desktop shows, by audience.                                                                                                                        |
| Help centre & replies     | 11.2 saved replies. Help centre articles: not built, Brawzer has no help centre.                                                                                       |
| Support performance       | 11.2, from the tickets.                                                                                                                                                |
| Proactive help            | Not built for now: the emails it describes come in 11.2 as part of tickets where they make sense.                                                                      |
| Subscriptions, Invoices   | 11.3, through Stripe: invoices listed and refunded with Stripe's own records. Without Stripe, the pages say so.                                                        |
| Coupons                   | 11.3, Stripe promotion codes.                                                                                                                                          |
| Finance reports           | 11.3, revenue movements from subscriptions.                                                                                                                            |
| Payment recovery, offers  | Not built: Stripe runs the retries; cancellation offers are a product decision for later.                                                                              |
| Pipeline, renewals        | Not built in this phase: Brawzer has no CRM. Renewals show on Organisations from their subscriptions.                                                                  |
| Trials to convert         | 11.3, free accounts by usage.                                                                                                                                          |
| Fleet & regions           | 11.4, the runtime hosts the API knows and their capacity. One region: the installation's.                                                                              |
| Live sessions             | 11.4, every running cloud browser and who holds it, ended with a reason.                                                                                               |
| Browser images            | 11.4, the engine versions in the images. Rollout percentages: not built, images deploy by digest.                                                                      |
| Extension catalogue       | 11.4, moderation of the catalogue (allowed, review, blocked), enforced when a profile installs one.                                                                    |
| Proxy & Shield            | 11.4, the saved proxies and their test results; site rules. Exit addresses and block-list reputation: not built, Brawzer has no address pool.                          |
| Queues & health           | 11.4, from the health checks: database, Valkey, store, scanner, key service, email.                                                                                    |
| Incidents & status        | 11.2, incidents with updates and an in-app banner.                                                                                                                     |
| Releases & flags          | Not built: deployments are by digest, and nothing reads feature flags.                                                                                                 |
| Autoscaling, on-call      | Not built: no provider API, no paging service.                                                                                                                         |
| Threats & sign-ins        | 11.5, from the security events; blocked addresses enforced at sign-in; staff sign-ins.                                                                                 |
| Abuse reports             | 11.5, logged reports, with suspension that refuses sign-in and ends sessions, and a legal hold.                                                                        |
| Vulnerabilities & keys    | Not built: the runbook holds rotation; a tracker without enforcement would be a spreadsheet.                                                                           |
| Bot detection, risk rules | Not built: no risk engine. New-device detection exists and shows on the account.                                                                                       |
| Privacy requests          | 11.5, requests a customer makes from their account page, with the one-month deadline, export and deletion carried out here.                                            |
| Legal requests & holds    | 11.5, a hold stops deletion.                                                                                                                                           |
| Compliance, data map      | 11.5, checklists kept here; the data map from what the installation actually configures.                                                                               |
| Audit log                 | 11.1. Every staff action, including page views refused by permissions, never edited or deleted.                                                                        |
| Goals, weekly email       | 11.5, goals kept here; the weekly founder email through Resend.                                                                                                        |
| Investor view             | Not built: a public page of company figures is a decision for later.                                                                                                   |

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
