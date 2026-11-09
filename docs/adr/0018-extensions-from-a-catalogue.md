# ADR 0018: Extensions from a reviewed catalogue

- **Status:** Accepted
- **Date:** 2026-11-08
- **Builds on:** [ADR 0003](0003-supply-chain-policy.md), [ADR 0012](0012-cloud-browser-runtime-isolation.md), [ADR 0017](0017-bee-browser-and-firefox.md)

## Context

The Extensions page was a planned module waiting for "a reviewed extension
catalogue" and "installs into a profile's kept data". An extension runs
with the page's powers and more; letting people install anything from a
store would make the cloud browser run code Brawzer never looked at, on
Brawzer's servers, with the session's network. The engines' policies
therefore blocked extensions entirely.

## Decision

### A catalogue, not a store

Brawzer ships a short list of open-source extensions it has reviewed
(`EXTENSION_CATALOGUE` in `@brawzer/contracts`): for each, the project's
own release asset, pinned to a version at least seven days old and to its
SHA-256, as ADR 0003 asks of every dependency. The runtime image fetches
every build at image build time, checks the hash, unpacks Chromium zips and
keeps Firefox's signed xpi files, and writes an index with each build's
path. Adding an entry is a code change with
a review; nothing is fetched at session time; no store is reachable (the
egress refuses the engines' update services and the policy blocks the web
store's address).

The first entries: uBlock Origin Lite (Chromium and Firefox), uBlock Origin
(Firefox; Chromium no longer runs its extension model) and Dark Reader.

### Installed per profile, at session start

A profile lists the catalogue entries it wants (`extensions`, slugs). At
session start the API passes those the profile's engine can run to the
runtime, and the agent installs them before the first page: Bee over the
DevTools pipe (`Extensions.loadUnpacked`, which the launch flag
`--enable-unsafe-extension-debugging` permits on the pipe only), Firefox
over WebDriver BiDi (`webExtension.install`). Chromium writes an unpacked
extension's indexed rules into the extension's own directory, and the
image is read-only, so the agent loads a copy from the session's scratch
space at a path that is the same every session: the extension's id, and the
settings it keeps in the profile, stay the same. Because every session
installs afresh, tabs an extension opens while being installed (Dark
Reader's help page, for one) are closed before the session reports ready. The welcome message names
what was loaded, so the page and the tests can tell. A temporary session
has no extensions. Profiles with extensions start cold: the warm pool
serves plain sessions only.

### What the policies still forbid

Chromium's managed policy no longer blocks every extension (that also
disabled unpacked loading, which the agent needs) but allows none from any
install source and keeps the web store's address blocked; the only way an
extension gets in is the agent's pipe. Firefox's policy allows exactly the
catalogue's add-on ids and blocks the rest. Extension pages
(`chrome-extension://…`) stay unreachable from the address bar.

## Consequences

- The Extensions page lists the catalogue with a switch per profile, says
  which engine runs what, and that extensions run in the cloud browser,
  never on the computer in use.
- The runtime image grows by the catalogue (about 25 MB) and the build
  needs the network to fetch it.
- An extension's own network traffic (filter list updates) goes through
  the session's egress like a page's.
