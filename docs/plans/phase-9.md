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

| #   | Milestone                                                                       | Status                                                                                       |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 9.1 | The desktop: windows, dock and taskbar, wallpapers, both styles                 | **Done** 2026-11-10                                                                          |
| 9.2 | Lock screen and wipe, Control Centre, a window switcher, Launchpad and Start    | Next                                                                                         |
| 9.3 | Files, Trash, Photos, PDF Viewer and Screenshot, over Drive                     | Planned; Trash needs Drive to keep deleted files for a while                                 |
| 9.4 | Notepad, Writer, Calc, Code and Calculator, saving to Drive                     | Planned                                                                                      |
| 9.5 | App Store: web apps that open in a cloud browser window; extensions per browser | Planned; extensions come from the existing catalogue (ADR 0018)                              |
| 9.6 | Study and business apps                                                         | Planned; each keeps its records on the server, per account                                   |
| 9.7 | Assistant                                                                       | Planned; only when the operator configures a model provider's key, which stays on the server |

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

## 9.2 to 9.7

- **Lock screen and wipe (9.2).** Locking is enforced by the server: a locked
  session gets nothing but the unlock request until the password or a
  passkey is given again, and the streams pause. "Wipe" signs out and clears
  the tab's state. Control Centre holds only real switches: theme, sound,
  style, wallpaper, the shared-computer timeout and the ad blocker. A window
  switcher (Alt+Tab within the desktop) and a Launchpad and Start menu of
  apps.
- **Files and the media apps (9.3)** are views over Drive, so files stay
  encrypted and scanned. Trash needs Drive to keep deleted files for a set
  time before removing them. Screenshot uses the cloud browser's existing
  "Save a screenshot to Drive". Send to Phone shows a link and QR code for a
  Drive file that opens only after signing in on the phone.
- **Documents (9.4)** are files in Drive, edited in a window and saved back.
  The calculator needs no storage.
- **App Store (9.5)** lists web apps (shortcuts that open a site in a cloud
  browser window with a chosen profile) and each browser's extensions from
  Brawzer's reviewed catalogue.
- **Study and business apps (9.6)**: Study Notes, Citations, Assignments, a
  Focus Timer, Exam Mode (a profile that only opens allowed sites, using
  Site rules), Invoices, Money and Templates. Each keeps its records per
  account on the server.
- **Assistant (9.7)** answers with a model provider's API, through Brawzer's
  API, only when the operator sets a key. It is off otherwise.

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
- **A pretend inbox and a pretend terminal.** Mail needs a real mail
  service. A terminal on Brawzer's hosts would break the isolation the
  runtime depends on (ADR 0012).
- **Music with bundled tracks.** Brawzer has no licensed music. Playing the
  person's own audio files from Drive could come with 9.3.
