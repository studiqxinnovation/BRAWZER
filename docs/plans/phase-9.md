# Phase 9: Brawzer as a cloud computer

On 2026-11-10 the person shared a prototype of Brawzer as a whole desktop
("this is what i want"): a sign-in screen, a Mac or Windows style desktop
with a dock or taskbar, the dashboard and the browsers as windows, a Start
menu and Launchpad, a Control Centre, a lock screen, and about thirty apps
(files, documents, study and business tools). This page decides what of it
Brawzer builds, in what order, and what it doesn't build, and tracks it. It
is built on the `phase-8-finishing` branch, one commit per milestone.

The prototype is the reference for the look and the behaviour. Brawzer's own
rules still hold: every control does something real, nothing an account
owns is kept on the device (a shared computer keeps nothing), and secrets
never reach the browser.

## Milestones

| #   | Milestone                                                                                     | Status              |
| --- | --------------------------------------------------------------------------------------------- | ------------------- |
| 9.1 | The desktop: windows, dock and taskbar, wallpapers, both styles                               | **Done** 2026-11-10 |
| 9.2 | The lock screen                                                                               | **Done** 2026-11-11 |
| 9.3 | Apps in windows, Launchpad and Start, Control Centre, the window switcher                     | **Done** 2026-11-11 |
| 9.4 | Apps that keep records: Assignments, Citations, Focus Timer, Exam Mode, Money, Invoices       | **Done** 2026-11-11 |
| 9.5 | Drive's apps: Files, Trash, Photos, PDF Viewer, Music, Notepad, Writer, Calc, Code, Templates | **Done** 2026-11-11 |
| 9.6 | App Store and web apps, Web Store, Passwords, Usage, Screenshot, Send to Phone, Terminal      | **Done** 2026-11-11 |
| 9.7 | Assistant and Study Notes                                                                     | **Done** 2026-11-11 |

## 9.1 The desktop

On a screen at least 64rem wide the signed-in app is a desktop:

- **The dashboard is a window.** The app's pages (Home, Browser, Drive and
  the rest) sit in a window with its title ("Brawzer — Drive"), back and
  forward, and a status bar saying whether the cloud is reachable and how
  many browsers of the plan's limit are open. It can be moved, resized,
  zoomed, snapped, closed to the desktop and brought back from the dock.
- **Each cloud browser is a window of its own.** Opening a browser from the
  dock, the taskbar, the Start menu, quick launch (⌘K), the menu bar, Home or
  the Browser page opens a window that streams that session. Several stream
  side by side. Each window is the existing pop-out page
  (`/app/browser/window`) in a frame, so it keeps its own stream, tabs,
  address bar and shortcuts. Closing a window ends its session, as closing
  the pop-out window does. Minimising keeps it running in the dock.
- **Moving and snapping.** Windows move by their title bar and resize from
  their corner. Dropped at the left or right edge they fill that half, and at
  the top edge the whole desktop. Zoom fills the desktop and goes back. New
  windows cascade by a title bar's height, so every window behind keeps its
  title and buttons in view.
- **Mac or Windows style.** Mac style has the menu bar, traffic lights and a
  dock that magnifies under the pointer, with minimised windows at its end.
  Windows style has the controls on the right and a taskbar with Start,
  search (quick launch), the browsers, the theme, the clock and "Show the
  desktop". The default follows the device's own system.
- **Wallpapers and the desktop's menu.** Eight wallpapers, chosen from View or
  the desktop's right-click menu, which also hides or shows Brawzer, opens a
  browser, shows the desktop, switches style and theme, and turns on the
  classic layout.
- **The classic layout.** "Use the classic layout" turns the desktop off and
  the app is pages again, as before; on phones it always is.
- **Kept per tab.** The style, the wallpaper and the classic layout are kept
  in `sessionStorage`, like the theme, and set before first paint. Browser
  windows that were open come back (minimised) from the server's list of
  running sessions, not from the device.
- **Framing, only for a browser window.** The app was never framed
  (`frame-ancestors 'none'`, `X-Frame-Options: DENY`). Only
  `/app/browser/window` now allows framing, by Brawzer's own origin
  (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`); a window tells
  the desktop it's done with a message the desktop accepts only from its own
  origin. `e2e/csp.spec.ts` checks every other page still refuses framing.

Tests: `e2e/desktop.spec.ts` (the dashboard window, the dock, moving and
zooming, wallpapers, both styles, the classic layout, phones, and a real
browser opening from the dock in a window that streams, minimises, snaps and
closes), `e2e/home.spec.ts` (a browser opened from Home opens in a window),
with axe audits of each state. `e2e/browser.spec.ts` drives the Browser page
itself and runs in the classic layout.

## 9.2 The lock screen

"Lock screen" (File in the menu bar, the desktop's right-click menu, Start in
Windows style) locks the sign-in on the server, not just the page:

- **The server holds the lock.** `POST /auth/session/lock` sets the sign-in's
  `locked_at`. Until its owner confirms it's them, every route answers 423
  `session_locked`, except reading who is signed in, confirming (password,
  with the authenticator's code when the account has one, or a passkey),
  locking again and signing out. Confirming is what unlocks; wrong passwords
  count towards the same lockout as any confirmation. Other devices of the
  account aren't affected.
- **Nothing counts as activity while locked**, so a locked shared computer
  still signs out after its 30 idle minutes, on the server and in the page.
- **Streams stop.** The relay closes a locked sign-in's streams at once
  (close code 4006) on the instance that locked it, and within its 10-second
  check on any other. No new stream ticket is issued while locked. The cloud
  browsers wait, for up to their 15 minutes without a viewer, and stream
  again on unlocking.
- **Every tab follows.** Locking and unlocking reach the account's other tabs
  and the desktop's windows over the session channel, and any 423 answer
  shows the lock screen. Behind it the page is `inert`. A page loaded while
  locked is sent only the lock screen, and unlocking loads it again; locked in
  place, unlocking leaves the desktop as it was and reads its data again.
- **"Wipe" is signing out**, which the lock screen offers: it ends the
  sign-in's cloud browsers and clears the site's storage (`Clear-Site-Data`).
- The security history records "Locked Brawzer" and "Unlocked Brawzer".

Tests: `test/auth.integration.test.ts` (what a locked session may do, no
activity, unlocking, signing out, the idle end),
`test/browser.integration.test.ts` (the stream closes on lock, no ticket while
locked, the same browser streams after unlocking), `e2e/lock.spec.ts` (the
menu bar, a reload while locked, a wrong and a right password, every tab
locking together, signing out from the lock screen, a desktop window's stream
stopping and coming back), with axe audits.

## 9.3 Apps in windows

The desktop's windows are one list: cloud browsers and apps. Apps come from
a registry (name, icon on a coloured tile, category, size, one window or
many) and load when first opened. The dock and taskbar show the account's
pinned apps, the web apps installed from the App Store, open apps and
minimised windows. Launchpad (Mac style, the whole screen) and Start
(Windows style, above the taskbar, with Lock and Sign out) list every
browser and app, found by typing; quick launch (⌘K) finds apps too.
Control Centre has only switches that do something here: dark mode, the
style, wallpaper, show the desktop, the cloud browsers open with "End all",
Lock, Sign out and the classic layout. Alt+` (Option+` on a Mac) switches
windows.

## 9.4 Apps that keep records

What these apps keep is stored with the account, not on the computer: the
`app_records` table holds each app's JSON sealed with its own data key
(SecretBox, bound to the account, the app and the key), up to 256 KB a
record and 500 per app (`GET/PUT/DELETE /apps/:app/records/:key`), and it's
in the account's data export.

- **Assignments**: coursework by due date: late, this week, later, done.
- **Citations**: Harvard (Cite Them Right), APA 7 and MLA 9 references for
  web pages, books and journal articles, and a sorted list to copy.
- **Focus Timer**: focus and break lengths; finished focus time logged by
  subject, with this week's totals.
- **Exam Mode**: for a set time, only the chosen apps and browsers open on
  the desktop (windows, the launcher and the Browser page keep to it), the
  classic layout stays off, a reload keeps to it, and ending early takes the
  password. It's for the person's own focus, not proctoring.
- **Money**: income and expenses by month and category; a month saved to
  Drive as CSV, with cells that look like formulas made safe.
- **Invoices**: invoices and quotes with the business's details, lines, tax
  and status, saved to Drive as PDFs written by Brawzer's own small PDF
  writer.

## 9.5 Drive's apps

Drive gains Trash (a deleted clean file waits 30 days, still counting
towards storage, to be put back or removed; the retention job purges it),
saving a new version in place (`PUT /drive/files/:id/content`: same id,
name and folder, scanned and encrypted with a new key), playable audio
(MP3, M4A, AAC, OGG, WAV, FLAC), and listing every clean file of a kind
(`?kind=images|pdfs|audio|text`).

- **Files** and **Trash**: folders, icons or a list, upload, rename, open each
  file in its app, move to Trash, put back, empty.
- **Photos**, **PDF Viewer** (the browser's own viewer) and **Music** (a
  playlist of Drive's audio).
- **Notepad** and **Code** (line numbers, indenting), **Writer** (headings,
  lists, emphasis; saved as HTML, and anything opened is cleaned to safe
  tags first), **Calc** (references, ranges, SUM, AVERAGE, MIN, MAX, COUNT,
  ROUND, ABS; saved as CSV with formulas kept) and **Templates** (business
  plan, pitch, meeting notes, cover letter, essay plan, cash-flow forecast,
  budget, grade tracker).

## 9.6 The account's tools

- **App Store**: Brawzer's apps to keep in the Dock, and web apps (Gmail,
  Outlook, WhatsApp, Google Docs, Microsoft 365, Canva, YouTube and more)
  that open the site in a cloud browser window. The Dock is kept with the
  account. Web apps show the name's initial on a colour, not the site's
  logo, and Brawzer holds no account with any of them.
- **Web Store**: the reviewed extension catalogue, per profile (ADR 0018).
- **Passwords**: where the person's passwords are: each profile's browser
  account (its own passwords page opens in the browser) and password
  managers' websites. Brawzer keeps none.
- **Usage**: browsing time by browser this month, and the plan's limits.
- **Screenshot**: a browser window's page saved to Drive as a PNG.
- **Send to Phone**: a QR code of Drive's page for a file; opening it needs a
  sign-in on the phone, so the code gives nothing away.
- **Terminal**: Brawzer's own commands (ls, cd, cat, open, mkdir, rm,
  browsers, start, end, storage, lock) acting on the account as the apps
  do. It is not a shell on Brawzer's servers.

## 9.7 Assistant and Study Notes

The **Assistant** is a conversation with Claude (`claude-opus-5-5`, set by
`ASSISTANT_MODEL`) through `POST /assistant/chat`; **Study Notes** turns notes
into a summary, flashcards or a multiple-choice quiz through
`POST /assistant/study`, using structured outputs and only what the notes
say. Both are off unless the operator sets `ANTHROPIC_API_KEY`, which stays on
the server; `GET /assistant` says whether they're on, and the apps say so in
words when they aren't. Nothing sent or answered is stored or logged by
Brawzer; Study Notes keeps the notes and the latest result as its app
record. A refusal is retried on another model by the API's server-side
fallback; one that still refuses says it plainly. Each account can make 60
requests an hour.

## Not built, and why

These parts of the prototype only look like features, so Brawzer doesn't
copy them:

- **"Any password works" sign-in, and guest mode without an account.**
  Sign-in stays real. A guest desktop would be cloud browsers for anyone,
  with no account to hold to the terms or the plan's limits.
- **Made-up numbers:** tracker counts, a simulated ping, and storage or
  usage figures that aren't the account's own. Brawzer shows only what it
  measures.
- **Exit locations and a VPN.** Brawzer has no network of exit locations.
  Browsing goes direct or through a proxy the person saves (Proxy page).
- **A pretend inbox, and a shell on Brawzer's servers.** Mail is a web app
  (Gmail, Outlook) in a cloud browser; Brawzer runs no mail service. The
  Terminal runs Brawzer's own commands; a shell on its hosts would break the
  isolation the runtime depends on (ADR 0012).
- **Music with bundled tracks.** Brawzer has no licensed music; Music plays
  the person's own audio files from Drive.
