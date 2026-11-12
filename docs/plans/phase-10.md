# Phase 10: a computer of one's own

On 2026-11-12 the person asked what would make Brawzer feel like a real Mac
or PC rather than a picture of one, and then said to build all of it. The
list below is the order chosen: first what makes the cloud browser stop
feeling like a picture, then what makes the desktop behave like a Mac or a
PC, then the parts that make it top-notch. It is built on the
`phase-8-finishing` branch, one commit per milestone, each with its own
journey in the browser tests.

Brawzer's rules hold throughout: nothing from a page reaches the person's
computer except pixels and, on purpose, text; every control does something
real; nothing an account owns is kept on the device.

## Milestones

| #    | Milestone                                                                                                                         | Status              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 10.1 | The cloud browser as a computer's own: cursor, gestures, site icons and tab previews, fonts, link numbers                         | **Done** 2026-11-12 |
| 10.2 | The app switcher, Mission Control and Task View, Spotlight and Start search, notifications, app menus                             | **Done** 2026-11-12 |
| 10.3 | Idle, screensaver and lock; boot, shut down and restart; several desktops; windows that remember                                  | **Done** 2026-11-12 |
| 10.4 | Drag and drop across the boundary; faces on the login screen and switching; the stream read aloud                                 | **Done** 2026-11-12 |
| 10.5 | The moving page as video (VP8 over the stream, decoded with WebCodecs)                                                            | **Done** 2026-11-12 |
| 10.6 | Email that a computer's owner expects: welcome, billing, quarantines, team updates, administrators, preferences, delivery reports | **Done** 2026-11-12 |

## 10.1 The cloud browser as a computer's own

- **The cursor is the page's.** After the pointer moves (at most every 60 ms)
  the agent asks the page what is under it: the cursor it asks for, with the
  browser's own choice worked out where it says `auto` (an I-beam over text
  and fields, a hand over links and buttons), looking into same-origin
  frames. The viewer shows that cursor over the canvas. Sent only when it
  changes (`pointer` message).
- **Gestures.** A trackpad pinch (a wheel with Ctrl) zooms a step per 40
  units; two fingers sideways go back or forward after 260 px in one burst,
  unless the page under the pointer scrolls sideways, which the pointer
  probe reports; two fingers on a touch screen pinch to zoom. Momentum
  scrolling already came through as the trackpad's own wheel deltas.
- **Site icons** reach the tab strip fetched by the container through the
  session's own filtering proxy, as a data URL of at most 64 KB whose type
  is read from the bytes (`favicon` message); the viewer never asks a site
  for anything. **Tab previews** are made here from the canvas (a 288 px
  JPEG) when a tab is left and every few seconds for the one in front, and
  shown when the pointer rests on a tab.
- **Fonts.** The image now ships Inter, Roboto, Open Sans, Lato, Carlito and
  Caladea beside Liberation and Noto, with a fontconfig file that maps the
  families pages ask for on a Mac or Windows (system-ui, -apple-system,
  Segoe UI, Helvetica Neue, Calibri, Cambria, Georgia, Menlo, Consolas…) to
  the nearest free one, lightly hinted greyscale rendering, and Chromium's
  `--font-render-hinting=none`.
- **The link's numbers.** The status bar shows the round trip to the
  container (a ping every 5 s, answered by the agent) and frames drawn in
  the last second, with a tooltip saying what they are.

## 10.2 The desktop as a Mac's or a PC's

- **The window switcher** (Alt+` or Option+`) now moves with the arrow keys
  and chooses with a click, and the Window menu opens it for the mouse.
  ⌘Tab and Alt+Tab themselves belong to the computer: no web page ever
  receives them, so Brawzer doesn't pretend to.
- **Mission Control** (Task View on Windows): F3 or Control and the up
  arrow, the Window menu, or the taskbar's Task View button fly every window
  to a cell of a grid, each named, with the windows in the Dock in a row
  below; choosing one brings it forward, Escape or a click on the desktop
  puts them back. The windows themselves move (a transform on each), so what
  is shown is live, not a picture.
- **Search** (⌘K or Ctrl+K, and Option+Space on a Mac) now finds the desktop's
  apps and its open windows ("Switch to"), Settings by section, files in
  Drive as you type (asked of the API once typing pauses), and works out a
  sum typed into it on the spot with a small parser of its own, never code
  evaluation; choosing the answer copies it.
- **Notification Centre.** Apps tell the person what happened through one
  store (`lib/notifications.ts`): downloads and printed pages, screenshots,
  uploads, and the Focus Timer. Each arrives as a banner at the top right,
  with a sound if sounds are on, unless Do Not Disturb is on, and waits in
  Notification Centre, opened from the clock or the bell in the menu bar,
  beside Shield's latest notices; Do Not Disturb is switched there too.
  Kept for this tab only, as everything on a shared computer is.
- **App and Window menus.** The menu bar's first menu is the app in front:
  About it, a new window, Hide (⌘M) and Quit (or End, for a browser). A
  Window menu offers Minimise, Zoom, Mission Control, Show desktop, Switch
  windows, Bring all to front and every window, the one in front ticked.

## 10.3 A desktop that rests, restarts and has several desktops

- **Idle.** After the minutes chosen in Settings (Desktop and dock: dim,
  screen saver, lock; each can be Never, and the lock is Never unless chosen), counted from the last click, key or
  touch in any Brawzer tab, the screen dims, then the screen saver shows the
  wallpaper photographs drifting under the clock (still, with reduced
  motion), then the screen locks: the server's lock, as Lock screen is.
  Anything wakes it. "Start now" starts the screen saver at once.
- **Restart and Shut Down**, in the Brawzer menu and Start, asked about as a
  Mac asks, going ahead on their own after a minute. Restart closes the app
  windows one after another, shows the black screen with the mark and starts
  Brawzer again (the start-up screen included); the cloud browsers wait where
  they were. Shut Down closes every window, ends the cloud browsers (as
  quitting them would) and signs out.
- **Desktops.** Windows belong to a desktop; the Window menu and Mission
  Control's bar at the top add, choose and remove them (a removed desktop's
  windows join the first), Control and the left or right arrow move between
  them, a window's title-bar menu moves it, and the Dock reaches a window on
  any desktop. Kept for this tab, like the windows themselves.
- **Windows remember their place.** Where an app's window was last moved or
  resized is kept with the account (by app; one place for the cloud
  browsers), and it opens there next time, brought inside a smaller screen
  if need be.

## 10.4 Across the boundary, faces, the stream read aloud, and video

- **Drag and drop across the boundary.** A file from Files or a desktop
  icon dropped on a cloud browser's window, or this computer's own file
  dropped on the page, reaches the page as a drop at that point (Chromium
  engines; Firefox's remote protocol has no drop, so it says to use the
  page's upload button). This computer's files go to Drive's Uploads first,
  scanned and encrypted; the page never sees this computer. An image dragged
  out of the page with Alt held, onto Files or the desktop, is saved to
  Drive by the container, as is "Save image to Drive" in the page's new
  right-click menu (Back, Forward, Reload; a link's and an image's actions;
  Copy, Paste, Find, Save as PDF, Reader view).
- **Faces.** The person's picture, chosen in Settings → About (a Drive
  file, scanned and encrypted, never on this device), shows on the lock
  screen and in Start. **Switch user** on the lock screen signs the person
  out so someone else can sign in, their cloud browsers waiting; the sign-in
  page says so. Nothing about the last person stays on the device, which is
  why the sign-in screen shows no faces of its own.
- **The stream read aloud.** After a key or click that may have moved focus,
  the agent asks the page what has focus, as the page labels it (role, name,
  a field's value, never a password), and the viewer announces it in a live
  region; "Show what has focus" in the More menu writes it under the page.

## 10.5 The moving page as video

WebRTC was the plan's step 3b, but the session's container has no network
or UDP of its own (its traffic goes through the egress sidecar), so a media
path would have needed a relay of its own. Instead the moving page goes as
VP8 over the stream it has: the viewer offers the codecs it can decode with
WebCodecs, the container's ffmpeg encodes each engine's pictures at
realtime settings (about 1.6 Mbit/s, a key frame every 48), the viewer
decodes and draws each frame, and the still page keeps its sharp picture
drawn over the last frame. A missed chunk makes the viewer ask for a key
frame. Without ffmpeg, WebCodecs or with `BRAWZER_VIDEO=off`, the stream
is the pictures it was. See ADR 0006's addendum for the measurements.

## 10.6 Email, through Resend

Brawzer already sent twenty transactional emails (confirmation, reset,
every change to an account, usage notices, team invitations) through one
transport with Resend behind it in production. Added:

- **Welcome** once the email is confirmed, with the first three things to
  try and what Brawzer never sees.
- **Billing**: a plan started (with its trial and renewal dates), changed,
  cancelled for the end of the period, ended; a payment that didn't go
  through (`invoice.payment_failed`) and a trial about to end
  (`customer.subscription.trial_will_end`), both new webhook events. Each is
  sent once per Stripe event (an idempotency key), never again on a
  redelivery.
- **A quarantined file**: what it was, the threat, how it came in.
- **Teams**: someone joined (to the owner and admins), you were removed,
  you now own the team.
- **For whoever runs Brawzer** (`ADMIN_EMAILS`): a sign-up, a subscription
  change, a reported page, a quarantined file; `ADMIN_NOTIFICATIONS=none`
  stops them.
- **Preferences** on the Account page (usage notices, team updates), with a
  one-click "Stop these emails" link and `List-Unsubscribe` headers on those
  notices; security and billing emails are always sent.
- **Delivery reports**: Resend's signed webhooks for bounces and complaints
  stop email to that address and tell the person on their Account page.
- The layout shows the brand mark (`/brand/mark.png`), facts as a table,
  and Resend gets a category tag on every message.
- Found on the way: webhooks carry no Origin, and the cross-site check
  would have refused Stripe's in production. Signed webhook paths are
  exempt now, and a test posts both without an origin.
