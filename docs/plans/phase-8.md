# Phase 8: the finishing ideas

Twenty-four additions proposed after Phase 7 and accepted as a set on
2026-11-08 ("build all"), each contained, each closing something a review or
plan already named. They are built in value order, one commit each, on the
`phase-8-finishing` branch, and this page tracks them. The phase's review is [docs/reviews/phase-8.md](../reviews/phase-8.md).

| #   | Idea                                                       | Status                                                                                                               |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 10  | Isolation checks as a CI job                               | **Done** 2026-11-08: `apps/api/test/isolation.integration.test.ts`; found and closed a DNS path (ADR 0014)           |
| 1   | Brawzer-drawn error pages                                  | **Done** 2026-11-08: drawn by Brawzer over the viewport, both engines, with Brawzer's refusal codes                  |
| 2   | Bookmarks and history as Brawzer records                   | **Done** 2026-11-08: per-profile history and bookmarks, encrypted, searchable, forgettable (ADR 0020)                |
| 5   | Find in page, zoom, reader mode                            | **Done** 2026-11-08: both engines, from the menu and Alt shortcuts                                                   |
| 4   | Clipboard with intent                                      | **Done** 2026-11-08: deliberate copy and paste, text only, each use recorded                                         |
| 9   | Private-address browsing through a saved proxy, on purpose | **Done** 2026-11-08: a per-profile switch, off by default, loopback still refused                                    |
| 8   | Per-account destination allow-lists and block-lists        | **Done** 2026-11-08: Site rules page; applied by the egress before anything else                                     |
| 11  | Passkey-only phone approval                                | **Done** 2026-11-08: approving needs a passkey whenever the account has one                                          |
| 13  | A key re-wrap job                                          | **Done** 2026-11-08: on the maintenance cadence and from the Admin API                                               |
| 14  | Warm pool                                                  | **Done** 2026-11-08: `BROWSER_WARM_POOL` pairs waiting per API instance                                              |
| 15  | A scheduler across runtime hosts                           | **Done** 2026-11-08: `RUNTIME_HOSTS`, the host with the most room, remembered per session                            |
| 16  | Relay back-pressure for downloads                          | **Done** 2026-11-08: a bounded buffer per transfer; the agent pauses while Drive catches up                          |
| 17  | Metrics                                                    | **Done** 2026-11-08: `GET /api/metrics`, Prometheus text, behind a token                                             |
| 18  | Image rebuild on upstream advisories                       | **Done** 2026-11-08: a daily check against Debian starts the release workflow                                        |
| 20  | Usage emails and in-app nudges                             | **Done** 2026-11-09: hourly emails at 80% and 100%, warnings on Home                                                 |
| 21  | Trials and promotion codes                                 | **Done** 2026-11-09: `trialDays` per plan, once per account; promotion codes at checkout                             |
| 22  | Admin: sessions and runtime view                           | **Done** 2026-11-09: hosts, warm pool, live sessions, end one                                                        |
| 23  | An operator CLI                                            | **Done** 2026-11-09: `pnpm brawzer`, `node dist/cli/main.js` in production                                           |
| 24  | Load test for the stream                                   | **Done** 2026-11-09: `infra/bench/stream-load.mjs`; bandwidth, not CPU, sets capacity                                |
| 3   | Session hand-off between devices                           | **Done** 2026-11-08: open tabs kept per profile; “Continue where you left off” and “Continue on another device”      |
| 6   | Pop-out work mode                                          | **Done** 2026-11-08: “Open in its own window”, and bringing a session back                                           |
| 12  | Report a page                                              | **Done** 2026-11-08: a note to the administrators, the address and a picture only if included; screenshots in Drive  |
| 19  | Team accounts                                              | **Done** 2026-11-08: teams on the owner's plan, invitations by address, shared proxies and a shared Drive (ADR 0019) |
| 7   | Sound, then WebRTC (Phase 3b)                              | **Sound done** 2026-11-08 (ADR 0006 addendum); WebRTC video still later                                              |

## 10. Isolation checks as a CI job

The by-hand checks from the Phase 3 and 5 reviews, as an integration test
that runs in the same CI job as the other browser tests (it needs the local
engine and the images). For each engine it starts a real session and, from
the engine's own user inside the container, checks: a read-only root and a
`noexec` scratch space; no capabilities and `NoNewPrivs`; the runtime shares
the egress sidecar's network namespace; the sidecar's ruleset (output
policy drop, only the egress user out, private ranges dropped, DNS dropped
ahead of the container engine's NAT); no direct route out and no name
resolution; through the filtering proxy, private addresses, loopback (the
agent, the engine's port), the cloud metadata address and the vendor's
services all answer "Blocked by Brawzer", while Brawzer's start page and the
test site are served; and no debugging port is open to a page. The container
checks read the engine's own view of the session (`docker inspect`).

The test runs with private ranges refused at the network level, as in
production, which the harness asks for with `PROXY_TEST_ALLOW_PRIVATE=false`.

## 1. Brawzer-drawn error pages

A failed navigation used to stream the engine's own error page, the one
piece of engine chrome a person still saw. Now each engine reports the
failure as data on the tab (`error: { url, code }`): Bee from the frame's
unreachable address and the code its error page names, Firefox from
`about:neterror`'s parameters. The web app draws the page over the viewport in
Brawzer's style, sorted into what the code means (no such website, refused by
Brawzer, not answering, too slow, certificate, redirect loop, bad address),
naming the host and never the engine, with "Try again", "Copy the address"
and, for a name that doesn't exist, "Search for it". The engine's code is
shown small for anyone who needs it.

Over HTTPS every refusal by the proxy looks the same to an engine (a failed
tunnel), so the egress now says why in a header on its 403, the agent's proxy
notes the reason per `host:port` for a few seconds, and a tunnel failure for
that address gets Brawzer's own code instead: `BRAWZER_REFUSED_ADDRESS`
(private or internal), `BRAWZER_REFUSED_PORT`, `BRAWZER_REFUSED_ENGINE` (the
engine's own services) or `BRAWZER_REFUSED_UNRESOLVED` (no such name, with
"Search for it"). Checked in the browser integration journeys (both engines)
and the e2e journey, with the accessibility audit.

## 5. Find in page, zoom, reader view

Three tools people reach for, drawn by Brawzer and run inside the page by
either engine through one set of scripts (`apps/runtime-agent/src/page-tools.ts`):

- **Find in page** (Alt+F, or the menu): a bar under the address; each
  keystroke asks the engine for the first match and Enter or the arrows step
  through them, with "3 of 14" from the engine's count. Matches are found in
  the page's visible text nodes, selected and scrolled into view; closing the
  bar clears the selection.
- **Zoom** (Alt+plus, Alt+minus, Alt+0, or the menu): layout zoom on the
  page's root element along the usual steps (50% to 300%), kept per tab and
  re-applied as the tab loads pages; the address bar shows the percentage,
  and clicking it resets.
- **Reader view** (Alt+Shift+R, or the menu): Mozilla's Readability (0.6.0,
  Apache-2.0, via the catalog) extracts the article from a copy of the
  document inside the page, and Brawzer's own reading layout replaces the
  page: scripts, frames, forms, styles and inline handlers never make it
  across. A page without an article says so; leaving reader view reloads the
  page. The tab reports `zoom` and `reader` in its state.

Checked in both integration journeys (the test site gained an article page)
and the e2e journey.

## 4. Clipboard with intent

Copy and paste between the page and the local computer stay off by default:
nothing crosses on its own. Two deliberate actions carry text, and only
text: **Copy selection to this computer** (Alt+C, or the menu) asks the
engine for the page's selected text (a field's selection when a field has
focus) and, after a confirmation that says plainly that the clipboard of the
computer in use is where it goes (asked once per session), writes it to the
local clipboard; **Paste from this computer** (Alt+V, or the menu) reads the
local clipboard and types it into the page's focused field (Chromium's
insert-text input, Firefox's `insertText` command with a typed fallback).
Each transfer is capped at 64 KiB and recorded in the security history as a
count of characters, never the text: `browser.clipboard_copied` and
`browser.clipboard_pasted`, written by the relay on the way through.
Checked in both integration journeys and the e2e journey.

## 9. Private-address browsing through a saved proxy, on purpose

People with a legitimate reason to reach a company intranet through their
own proxy couldn't: the egress refused private targets even when the proxy
would do the resolving and connecting on its own network. A profile with a
proxy now has a switch, **Reach private addresses through the proxy**, off
by default and needing "confirm it's you" to change. With it on, both
filters (the agent's cheap first check and the egress rules) hand private
and internal addresses to the proxy unresolved instead of refusing them;
nothing in Brawzer connects to those addresses, and loopback (`127.*`,
`::1`, `localhost`) stays refused on both hops, since that is the session's
own container. Without a proxy the switch has no effect. The session's
containers get `EGRESS_PRIVATE_VIA_UPSTREAM` and `BRAWZER_PRIVATE_VIA_EGRESS`
only for such profiles. Checked in the egress and agent rule tests, the
proxy integration journey (refused, then through the proxy, loopback still
refused) and the proxies e2e journey.

## 8. Per-account destination allow-lists and block-lists

A **Site rules** page under Protect. Two lists: blocked sites, which never
open, and allowed sites, which once any exist are the only sites that open
(a child's profile, a work-only computer). A rule is a host as a resolver
reads it (lower-cased, international names to ASCII, a leading `www.` or
`*.` dropped, no schemes or paths), covering the host and everything under
it; an IP address is a host too. Up to 200 per account, listed in the data
export, deleted with the account.

Every session's egress receives the account's rules at start
(`EGRESS_SITE_RULES`) and applies them before anything else in its decision,
on the host as asked for: HTTP pages get the "Blocked by Brawzer" page with
the reason, HTTPS tunnels are refused with `policy` as the reason, which the
agent carries to the error page as `BRAWZER_REFUSED_POLICY` ("Your site rules
stopped this"). The engine sees a refusal, never the list. Checked in the
egress rule tests, the site rules API test (normalisation, limits, export,
another account), the proxy journey (a subdomain of a blocked host refused
at the egress, another host through the proxy) and the e2e page journey.

## 11. Passkey-only phone approval

Approving a sign-in from the phone used "confirm it's you", which accepts a
password: the one place a password could still be typed on a phone. A
session now remembers how its owner last proved who they are (`password`
or `passkey`, and the sign-in's own method at first). Approving a phone
request needs a passkey confirmation from the last ten minutes whenever the
account has a passkey; the API answers `reauthentication_required` with the
detail `method: passkey`, and the confirmation dialog then offers the
passkey alone, with the reason stated. An account with no passkey can still
approve with its password, and the approval page says a passkey would make
that unnecessary. Checked in the phone sign-in integration test (a password
confirmation refused, a passkey confirmation accepted, no passkey falls back).

## 13. A key re-wrap job

The runbook said rotation re-wraps rows when they are next written, which
could take months. Now the key providers can say whether a wrapped data key
still uses the current key (locally: the first key in `ENCRYPTION_KEYS`;
Transit: the key's latest version, read from the ciphertext's `vault:vN:`
prefix against the key's `latest_version`) and re-wrap it (locally by
unwrapping and wrapping again; Transit through its `rewrap` call, so the
data key never leaves the key service). A maintenance job walks every sealed
column (proxy credentials, TOTP secrets, Drive file keys, profile data keys,
session agent secrets) in batches under its own advisory lock and updates a
row only if it is still as read, so a concurrent write wins. It runs with the
retention cadence and from `POST /admin/maintenance/rewrap`, reporting rows
per table and rows it had to leave. Checked in the secret box unit tests and
an integration test that seals under one key, rotates, re-wraps through the
Admin API and opens the secret with the new key alone.

## 14. Warm pool

A session took a few seconds to start cold: two containers created and
started, the sidecar's firewall applied, the agent's readiness awaited. With
`BROWSER_WARM_POOL=n`, each API instance keeps `n` egress-plus-runtime pairs
started and waiting at the agent's "waiting" state (before any profile data
or engine start), each with a session id reserved for it and its own secret,
and labelled with when it was made. A session that needs nothing special
(Bee, no proxy, no site rules) claims a pair, checked once more to be
healthy and fresh, and the session row is made with the reserved id; the
start then only restores the profile's data and starts the engine. Anything
else starts cold as before, and the pool refills in the background. Pairs
belong to the instance that made them: it discards them on shutdown, and
reconciliation on any instance leaves pooled pairs alone for an hour. Pooled
pairs hold the runtime's memory limit while they wait, so the default is 0
and the runbook says what one costs. Checked in an integration test that
waits for a pair, starts a session within a few seconds on that pair's
container, and sees the pool refill.

## 15. A scheduler across runtime hosts

The orchestrator took one engine endpoint. `RUNTIME_HOSTS` now lists
several: a name, an engine (a socket path or `tcp://host:port`, every TCP
engine reached with the same client certificate, which production
requires), where the API reaches the agent ports, and a capacity. Without it
`DOCKER_HOST` is the one host, named "local". Each host gets its own engine
client and a cached health (asked at most every half minute). Placement is
small on purpose: under the capacity lock, the live sessions per host are
counted and the healthy host with the most room takes the session, ties in
turn; when every healthy host is full, or none is healthy, starting answers
503 with Retry-After, as the global limit does. The session row remembers
its host, so stopping, packing, reaping and reconciling go to the right
engine; a row without a host (older) means the primary. The warm pool
spreads its pairs over the reachable hosts in turn, and this instance's
proxy tester runs on the primary. Checked in the config tests and an
integration test with two hosts of capacity one on this machine's engine
and one host nobody answers on.

## 16. Relay back-pressure for downloads

The relay wrote every chunk of a download into the stream that Drive's
upload reads (scanning and encrypting as it goes), whatever the upload's
pace: a slow scan or store meant the whole file waiting in the API's
memory. The stream now has a 2 MiB buffer per transfer, and when a write
reports it full the agent's socket is paused until the stream drains; it
stays paused while any transfer in flight is full, and every end (saved,
failed, the stream closing) releases it. The agent already sent one chunk
at a time and waited for it to leave, so pausing the socket is all it takes
to hold the download at the source. Pauses are counted for the metrics.
Checked in a unit test of the pacing and an integration test that downloads
24 MiB through a session into Drive, whole.

## 17. Metrics

The API logged the right lines but nothing counted them. A small registry
(no library: counters, summaries and gauges read at scrape time) serves
`GET /api/metrics` in Prometheus's text format, behind `METRICS_TOKEN`
(required in production; open in development). What it carries is what the
runbook's "watch" section asks for: live sessions per runtime host against
each host's capacity and health, session starts (cold or warm) and failures,
ends by reason, pages watching, frames relayed and dropped, downloads and
printed pages by outcome, download pauses, scan time and scanner outages,
Stripe webhooks by result, warm pairs waiting, when maintenance last ran,
and the running version. Nothing names a person, an address or a page.
Checked in the registry's unit test and an integration test with and
without the token.

## 18. Image rebuild on upstream advisories

The runtime image takes both engines from Debian's archive (`chromium` and
`firefox-esr`), and the release workflow rebuilt
it each Monday, so an engine security release could wait up to a week. The
"Engine watch" workflow (`.github/workflows/engine-watch.yml`) runs daily:
it pulls the `nightly` runtime image and asks the image's own package
manager, with the security archive in its sources, for the installed and
the candidate version of each engine. When either is behind, it starts the
release workflow, so the release reaches `nightly` within a day. The
comparison is `infra/scripts/engine-versions.mjs`, which runs locally too
and exits 3 when a rebuild is due. Rolling the new images onto hosts stays
an operator's step (the runbook's "Weekly rebuilds").

## Also built: sound, and extensions

Asked for directly on 2026-11-08, from the two "Development state" notes
still in the app.

- **Sound** (the Browser page): a PulseAudio server per session, captured
  and streamed beside the frames, played on the page with a speaker control
  in the status bar ([ADR 0006](../adr/0006-browser-streaming.md), addendum).
  The 3b spike's audio finding turned out to be the probe's own mistake.
- **Extensions** (the Extensions page): a reviewed catalogue of
  open-source extensions pinned by version and hash, fetched into the
  runtime image at build, chosen per profile and installed by the agent at
  session start ([ADR 0018](../adr/0018-extensions-from-a-catalogue.md)).
  Building it found and fixed a race in the Firefox engine: a load event
  that arrived after the title was read never told the viewer the page
  had finished.

## 20. Usage emails and in-app nudges

One rule decides when usage deserves a word (`usageWarnings` in
`@brawzer/contracts`): 80% or more of this month's browsing hours on a plan
that caps them, of Drive storage, or of Drive's file limit. Profiles and
proxies aren't in it: their limits only stop the next one being added, and
say so then. An hourly job, one instance at a time, emails at 80% and at
100%, each once: per month for hours, per crossing for Drive (the record
goes when usage falls back under 80%, so filling up again is news again).
Home shows the same warnings with a link to the plan, and its stale
"cloud browser isn't available" note became a card that starts the browser
or returns to a running session; the Profiles page's stale extensions note
became a pointer to the Extensions page. Checked in the rule's unit test,
an integration test that crosses each line and checks every email is sent
once, and the navigation e2e. Usage emails are service messages about the
account, like the security ones; there is no setting to turn them off.

## 21. Trials and promotion codes

A paid plan in `BILLING_PLANS` may name `trialDays` (1 to 90). Checkout then
asks Stripe for its own trial (`trial_period_days`), but only for an
account's first subscription: one that has had a subscription before pays
from day one, so a trial can't be taken twice by cancelling. The billing
overview says whether the account is still eligible, and the Account page
offers "Try Plus free for 14 days" then, with a line saying Stripe charges
nothing before the trial ends. Promotion codes were already accepted at
checkout; they are made in Stripe's dashboard, and no code or price appears
in Brawzer. Checked in the billing integration test (the trial in the first
checkout, none in a checkout after a cancelled subscription).

## 22. Admin: sessions and runtime view

The Admin page gained a Cloud browser section: each runtime host with its
health and live sessions against its capacity, the warm pool's waiting pairs
on this instance, and every live session with its account, engine, host,
start time, whether it goes through a proxy and how many extensions it
runs; never what it browses. An administrator can end a session, which
ends as a sign-out would (profile data saved, containers removed) with the
new end reason `admin`, shown in the owner's security history as "ended by
Brawzer's administrators". Both routes sit behind the administrator and
confirm-it's-you guards. Checked in an integration test (403 for others,
the session listed, ended, gone, and named in the owner's history).

## 23. An operator CLI

The runbook's application steps, one command each, run in the API's own
process context with its configuration (`apps/api/src/cli`): live sessions
and hosts, ending a session, finding an account, granting a plan with a
reason (recorded in the owner's history like the Admin page's), re-wrapping
secrets, sending due usage emails, and retention. In production it runs
inside the API container (`node dist/cli/main.js`); locally
`pnpm brawzer <command>`. It starts no warm pool of its own. Certificates
stay a shell script. Checked in an integration test that drives the same
command function against the test app.

## 24. Load test for the stream

`infra/bench/stream-load.mjs --sessions N --seconds S [--engine bee|firefox]`
starts N runtime containers with the orchestrator's hardening (read-only
root, no capabilities, the session seccomp profile, 2 GB and 2 CPUs each),
opens each agent's stream as a viewer would, acknowledging every frame,
scrolls a long test page (`/long` on the test site) in every session at once
at 30 wheel steps a second, and reports frame rate, bandwidth, frame size,
CPU and memory per session. It is the figure the hosting choice needs: run
it on a candidate runtime host. Measured here on 2026-11-09, on a developer
machine (Apple silicon, Docker Desktop with 14 CPUs and 8 GB), 1280×800:

| Engine  | Sessions | Frames/s each | Bandwidth each | CPU each (of one core) | Memory each |
| ------- | -------- | ------------- | -------------- | ---------------------- | ----------- |
| Bee     | 1        | 32            | 16.8 Mbit/s    | 50%                    | 275 MB      |
| Bee     | 4        | 32            | 16.7 Mbit/s    | 43%                    | 272 MB      |
| Bee     | 8        | 32            | 16.8 Mbit/s    | 60%                    | 272 MB      |
| Firefox | 2        | 12            | 7.1 Mbit/s     | 39%                    | 660 MB      |

What it means: on this machine the frame rate held at eight sessions, and
each Bee session needed about half a core and under 300 MB, well inside the
2 GB and 2 CPU limits. Bandwidth is the cost that grows fastest: about
17 Mbit/s per session while scrolling a busy page (65 KB per frame at 32
frames a second), so 8 sessions want about 134 Mbit/s from the host and the
viewers. Frame acknowledgements already slow a session down for a slow
viewer instead of queueing; adapting JPEG quality to the viewer's link is
the next lever if hosts or viewers are short of bandwidth. Firefox's BiDi
screenshots run at about 12 frames a second and use more memory, as ADR
0017 expected. An idle page sends next to nothing.

## 6. Pop-out work mode

"Open in its own window" in the "…" menu opens the session in a window with
nothing but the browser's chrome (a `(window)` route group outside the app's
navigation, keeping the signed-in rules: idle sign-out and confirm-it's-you).
The window takes the stream, since a session has one viewer at a time.

That surfaced a real fault: a page whose stream another window or tab took
said "Session over" and that the profile's data had been saved, though the
session was running on. It now says "This session is open in another
window", with "Bring it back here", which takes the stream back; the pop-out
then says the same and offers to close itself. A blocked pop-up is
explained. Checked in the browser e2e journey (pop out, frames in the
window, the main page's message and accessibility, bring it back).

## 12. Report a page

"Report a problem with this page", in the "…" menu and on an error page
where Brawzer refused something, opens a short form: what happened (the page
doesn't work, Brawzer blocked something it shouldn't have, something else),
what went wrong in the person's words, "Include the page's address" (ticked,
and it can be left out), and "Attach a picture of what the page shows now"
(not ticked). The picture is made in the person's own browser from what the
viewport shows, as a JPEG under 600 KB, and is shown in the form before it
is sent; the server never captures a page. The engine is taken from the
session's record when the session is the sender's own.

A report is kept in `page_reports` with only what was sent; the picture is
sealed like other secrets (ADR 0008, and the re-wrap job covers it). The
Admin page lists open and closed reports; an administrator opens a picture
on request (each opening is logged) and closes a report, which deletes the
picture at once. The retention job deletes a picture after 30 days in any
case, and a closed report after 90. The sender's security history records
"A page was reported to Brawzer" and whether a picture went with it; the
report is in their data download. Reports are limited to 10 an hour per
account; `brawzer_page_reports_open` counts the open ones.

"Save a screenshot in Drive" saves the page as a PNG in Drive's top folder,
made the same way in the person's browser and uploaded like any file
(scanned, encrypted, in the security history as an upload).

Building this showed that the security history dropped some of each event's
recorded facts: clipboard entries read "0 characters", and plan names and
the "saved as a PDF" wording never showed. The API now passes those facts
through.

Checked by `apps/api/test/reports.integration.test.ts` (validation, sealing,
administrators only, closing, retention, the rate limit, the export), the
browser e2e journey (screenshot, report with a picture, accessibility) and
`apps/web/e2e/admin.spec.ts` (an administrator reads, opens the picture and
closes a report).

## 19. Team accounts

ADR 0019 records the design; it was built in three parts.

**Teams, invitations and the owner's plan.** A Team page (in the
navigation) starts a team, which its starter owns and pays for, and invites
people by email address as admins or members. The invitation is a row: the
verified account with that address sees it on its own Team page and joins
or declines there, so the email itself carries nothing usable. Invitations
last 7 days, hold a seat while they wait, and are deleted by the retention
job when they expire. Every member uses the owner's plan, because
`limitsFor`, which every module asks, answers with it (usage emails too). A
plan's new `teamMembers` limit sets the team's size: 3 on the free plan and
on any configured plan that doesn't say, so teams work on an installation
without paid plans. A member can't buy a plan of their own, and someone
paying for one can't join until it ends. The owner changes roles, removes
anyone, hands the team over (the new owner then pays) or deletes it, the
last two after confirming it's them; admins invite and remove members. An
owner can't delete their account while others are in the team.

**The team's proxies.** The owner and admins keep a list of proxies on the
Proxy page that every member can choose for their own profiles without
seeing a password. Credentials are sealed to the team, so they survive the
person who added them leaving.

**The team's Drive.** The Drive page and the cloud browser's file picker
switch between "My Drive" and the team's Drive. Everyone in the team opens,
adds, renames and moves files there; deleting is for whoever added a file,
the owner and admins, and the page offers it only to them. The team's
space has the owner's plan's Drive limits, counted separately from anyone's
own Drive, and its files' keys are bound to the team.

Leaving or being removed hands what the person added (proxies, files,
folders) to the owner, takes their profiles off the team's proxies and ends
a cloud browser session of theirs that browses through one. Deleting the
team deletes its proxies and its Drive, objects included, and nothing
anyone owns. Each change is in the security history of the person it
concerns, without anyone else's device or address; the data download names
the team.

Building it showed that usage emails took each account's own plan even in
a team; they now take the owner's.

Checked by `apps/api/test/teams.integration.test.ts` (invitations, seats,
roles, the plan, subscriptions, hand-over, deletion, account deletion,
proxies, the Drive space), a real session through a team proxy ended by
leaving in the browser integration test, and `apps/web/e2e/team.spec.ts`
(start, invite, join, the plan on the Account page, a team proxy, the
team's Drive, roles, removal, deletion, accessibility on desktop and
phone).

## 2 and 3. History, bookmarks, and continuing on another device

ADR 0020 records the design. Work on idea 2 had stopped earlier; on
2026-11-08 the account's owner asked for both ideas to be built, and they
were built together, as they share their records and their key.

**History and bookmarks.** Each profile keeps a history (one entry per
page, with its visits) and bookmarks, encrypted with the profile's own key
and found by a keyed digest of the address, so the database never holds an
address, title or host in the clear. The stream relay records a page once a
tab finishes loading it, only for profiles that keep their data, and never
Brawzer's start page or a temporary session. The cloud browser has a star
beside the address and a "History and bookmarks" panel in the "…" menu that
searches across sessions and opens a page in the current tab. Each profile
has a History page (from the Profiles page) to switch history off, search,
forget one page, clear it all, and rename or remove bookmarks. Pages not
visited for 90 days are forgotten, and each profile keeps at most 5000.
Clearing a profile's data clears its history; bookmarks stay. The data
download includes both; nothing else shows them.

**Continuing on another device.** While a session runs, its open tabs are
kept with the profile (encrypted the same way). The Browser page offers
"Continue where you left off" for 7 days, with the tabs it will reopen;
continuing reopens them, in their order, in the new session. "Continue on
another device" in the "…" menu ends the session on purpose (end reason
`handed_off`) and says what to do on the other device.

Checked by `apps/api/test/history.integration.test.ts` (encryption at
rest, search, forgetting, clearing, the switch, bookmarks, the data
download, retention), a real session in the browser integration test
(visits recorded as pages load, hand-off, the next session reopening the
tabs, a temporary session leaving nothing), unit tests of the encryption,
and the browser e2e journey (star, panel, hand-off to a second signed-in
browser, the History page, accessibility).
