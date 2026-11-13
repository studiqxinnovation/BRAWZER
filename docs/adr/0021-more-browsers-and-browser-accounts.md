# ADR 0021: More browsers at once, and the browsers' own accounts

- **Status:** Accepted
- **Date:** 2026-11-10
- **Builds on:** [ADR 0012](0012-cloud-browser-runtime-isolation.md), [ADR 0013](0013-profile-data-and-drive-hand-off.md), [ADR 0014](0014-egress-service.md), [ADR 0017](0017-bee-browser-and-firefox.md)

## Context

Brawzer offered two engines, Bee Browser and Firefox, one session at a time.
People asked for the browsers they already use, Chrome above all, side by
side, and for the passwords those browsers keep for them. Those passwords
live in the browsers' own password managers, synced through Google's,
Microsoft's or Mozilla's accounts, which ADR 0017's policies switch off.

Two facts shape the answer. The engines run without a window, so nothing the
browser draws outside the page (its save-password bubble, its sign-in
pop-ups, its autofill suggestions) ever reaches the stream. And Chrome and
Edge are their makers' products, under their makers' terms.

## Decision

### Five browsers, one runtime image

| Browser        | What it is                                                                     | Driven by                  |
| -------------- | ------------------------------------------------------------------------------ | -------------------------- |
| Bee Browser    | Debian's Chromium with Brawzer's start page and name                           | CDP over a pipe            |
| Google Chrome  | `google-chrome-stable` from Google's signed repository                         | CDP over a pipe            |
| Firefox        | Debian's Firefox ESR                                                           | WebDriver BiDi on loopback |
| Microsoft Edge | `microsoft-edge-stable` from Microsoft's signed repository, x86-64 images only | CDP over a pipe            |
| Chromium       | Debian's Chromium as it is                                                     | CDP over a pipe            |

Both vendor keys are checked against pinned fingerprints before apt trusts
them. Every browser runs in the same hardened container, behind the same
egress, under the same managed policies (Edge reads them from its own path,
with its own extras switched off as well). A profile keeps to the browser it
was made with; data never moves between browsers. The engine watch checks
Chrome and Edge as it checks Debian's packages.

### What is offered

`BROWSER_ENGINES` lists the browsers an installation offers, in the order
the launcher shows them. Microsoft ships Edge for x86-64 Linux only, so the
API offers it only when every runtime host's image is x86-64, asking the
hosts' engines every 5 minutes and leaving Edge out while none can be asked.
A browser that can't start is never shown. Operators take Chrome or Edge out
where their makers' terms for hosting them aren't met.

### What websites are told

A windowless Chromium calls itself `HeadlessChrome`. That describes how
Brawzer runs the browser, not what it is, and sites (Google's sign-in among
them) treat it as automation. The agent sets the user agent and brand hints
to the real browser: Chrome as Chrome, Edge as Edge, Chromium as Chromium,
and Bee as Chromium with `Bee/` after it.

### Several browsers at once

An account runs as many sessions as its plan allows (three on the free
plan), a profile in one at a time. The Browser page is a desktop: each
browser's own logo as an app icon (taken from the browser's own files), a
click opening it with its first free profile, a menu (or a right-click) for
another profile or a temporary session, and a taskbar of the browsers
running now. A switcher in the browser's bar moves between them.

### The browsers' own accounts, only on purpose

A profile has "Browser account and saved passwords", off by default. It can
be on only for a profile that keeps its data, and changing it needs a sign-in
or confirmation from the last 10 minutes. With it on, and only then:

- The agent writes that session's policies with the password manager,
  sign-in and sync allowed, and the engine's own password and account pages
  (and no other internal page) allowed as tabs. The image points every
  engine's managed-policy path into the session's scratch space; the agent
  writes the policies there before the engine starts, read-only, and starts
  no engine if it can't.
- For Chrome, the egress lets Google's sync service (`clients4.google.com`)
  through; it refuses it otherwise, with the rest of the engines' background
  services.
- "Saved passwords" in the browser's menu opens the browser's own passwords
  page, or its account's sign-in (Google for Chrome, Microsoft for Edge,
  Mozilla for Firefox). Bee and Chromium have no account to sign in to:
  Google's sync is for Google's own Chrome.

Saved passwords stay in the profile's data directory, archived and encrypted
with it like its cookies (ADR 0013). Signing in happens on the provider's own
pages in the streamed browser; Brawzer never sees the account's password.

The same panel opens password managers that have a website (Google Password
Manager, Bitwarden, 1Password, Proton Pass) in a new tab, in any session.

## Consequences

- People can reach their saved passwords from any device without them ever
  being on that device. Filling them in from the browser's own suggestion
  pop-up isn't possible, since a windowless browser doesn't draw it; the
  passwords page lists every saved password to copy from.
- An account provider may refuse a sign-in it judges risky, from a data
  centre's address for instance, or ask to confirm it. Brawzer can't promise
  otherwise; a profile with a residential proxy looks like an ordinary home
  connection.
- Turning a browser's account on lets that browser's maker see the profile's
  synced data under its own terms, as on a person's own computer. The switch
  says so, and the privacy notice too.
- The runtime image grows by Chrome and, on x86-64, Edge. Each is updated by
  rebuilding the image, never by the browser itself.
- Chrome and Edge are hosted under Google's and Microsoft's terms; operators
  own that decision through `BROWSER_ENGINES`.
