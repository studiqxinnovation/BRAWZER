# Phase 8 review: the finishing ideas

Reviewed 2026-11-10, after the last of the twenty-four ideas. Plan:
[docs/plans/phase-8.md](../plans/phase-8.md); designs:
[ADR 0017](../adr/0017-bee-browser-and-firefox.md),
[ADR 0018](../adr/0018-extensions-from-a-catalogue.md),
[ADR 0019](../adr/0019-team-accounts.md),
[ADR 0020](../adr/0020-history-bookmarks-and-open-tabs.md) and addenda to
ADRs 0006, 0008, 0013, 0014, 0015 and 0016.

## What was built

| Area                  | Delivered                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolation and the web | Isolation checks in CI (and the DNS path they found closed), Brawzer-drawn error pages, site rules, private addresses through a proxy on purpose                                   |
| In the browser        | Find, zoom and reader view; clipboard with intent; sound; reviewed extensions; pop-out window; report a page and screenshots to Drive; history and bookmarks; continuing elsewhere |
| Accounts and money    | Passkey-only phone approval, trials and promotion codes, usage notices, team accounts with shared proxies and Drive                                                                |
| Running it            | Key re-wrap job, warm pool, runtime host scheduler, relay back-pressure, metrics, engine watch, the Admin runtime view, the operator CLI, the stream load test                     |
| The site              | A new home page: a 3D stage, motion that stops for "reduce motion", the same honest copy                                                                                           |

## Security review

1. **Cross-site writes.** Every new route that changes state (teams, reports, history, bookmarks, hand-off, team proxies and Drive) goes through the global check that a write comes from Brawzer's own origin, with SameSite cookies; the stream relay checks the origin too. Sensitive steps keep confirm-it's-you: handing a team over or deleting it, the data download (which now carries history), and every Admin route.
2. **Teams: who can do what.** Roles are read again under the team's row lock before every change, so a role changed meanwhile is honoured; seats are counted under the same lock for invitations and joins. Invitations are rows taken up by the verified account with the address, never a token in the email. Removed or departed members lose the team's proxies, Drive and any session browsing through a team proxy at once; download tickets check access when redeemed. _Found and fixed in this review:_ inviting the same address again re-sent the email, so one account could mail one address up to 30 times an hour; an address now gets at most three invitation emails a day, whoever sends them (integration test). _Remaining:_ members see each other's email addresses and the host and port of the team's proxies, by design; never the proxies' passwords.
3. **Shared things stay readable, and only to the team.** A team proxy's credentials and a team file's key are sealed to the team, not to whoever added them (integration tests read both after that person leaves). Personal and team rows never mix: a file can't move between spaces, and usage, limits and the data download count personal rows only.
4. **History and bookmarks.** Encrypted per profile with the profile's own key, found by a keyed digest; readable only by the profile's owner; never in logs, metrics, the security history or Admin. _Found and fixed in this review:_ a page (or an engine gone wrong) could navigate as fast as it liked and each navigation was a database write; a stream now records at most 60 visits a minute (unit test), and unwrapped keys leave memory when their ten minutes are up instead of when something replaces them. _Remaining:_ search decrypts up to 5000 entries in the API's memory per request; a compromised engine can add entries to its own profile's history, and saved tabs it left would reopen in that same profile (http and https only), never in another.
5. **Report a page.** Only what the person includes is sent; the picture is made in their browser, sealed at rest, shown to administrators on request with each opening logged, and deleted on closing or after 30 days. _Remaining:_ a report's message and address are stored in the clear for administrators to read, unlike history.
6. **Secrets at rest.** The re-wrap job covers every sealed column added in this phase (report pictures, profile history keys); team-sealed contexts are unaffected by re-wrapping, which changes only the key's wrapping.
7. **Operations surfaces.** `/api/metrics` needs `METRICS_TOKEN` in production and compares it in constant time; the CLI runs inside the API image with the database credentials and no listener; the Admin runtime view shows who and where, never what a session browses.
8. **Forms before the page's script runs.** _Found and fixed in this review_ (the signed-in pages' accessibility audit caught it under load): where a form gave a field's label and input their own ids, the server's markup linked the label to an id the input didn't carry until the script ran, so for that moment, or without script, the Team, Site rules and bookmark forms had unlabelled fields. Those forms now let the field link them, which it does in the server's markup too, and the UI kit says so beside `FieldLabel`.
9. **The new home page** loads nothing from elsewhere (system fonts, first-party styles and scripts under the existing nonce policy), hides all decoration from assistive technology and stops moving when less motion is asked for.

## Verification

| Check             | Result                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests        | 13 of 13 workspace tasks pass, including history encryption and the visit budget                                                                                                          |
| Integration tests | 29 files, 172 tests pass, including teams (roles, seats, the per-address limit, proxies, Drive), history, reports and real sessions through team proxies and continued elsewhere          |
| End to end        | 169 pass and 9 are skipped by design, desktop and phone: every page's accessibility audit in light and dark, the browser journeys, teams, Admin, the home page's motion and its stillness |
| CI                | every job green on the branch                                                                                                                                                             |
