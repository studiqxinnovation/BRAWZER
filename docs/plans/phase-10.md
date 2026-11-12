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

| #    | Milestone                                                                                                            | Status              |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 10.1 | The cloud browser as a computer's own: cursor, gestures, site icons and tab previews, fonts, link numbers            | **Done** 2026-11-12 |
| 10.2 | The app switcher, Mission Control and Task View, Spotlight and Start search, notifications, app menus                | Planned             |
| 10.3 | Idle, screensaver and lock; boot, shut down and restart; several desktops; windows that remember                     | Planned             |
| 10.4 | Drag and drop across the boundary; faces on the login screen and switching; the stream read aloud; video over WebRTC | Planned             |

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
