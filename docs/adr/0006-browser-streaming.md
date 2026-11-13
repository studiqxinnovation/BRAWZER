# 0006 Browser streaming

- **Status:** Accepted for step 3a after the milestone 3.1 measurements (2026-11-07). Step 3b stays proposed; a spike on 2026-11-08 ([findings](../reviews/phase-3b-spike.md)) ruled out capturing from inside headless Chromium and confirmed the virtual-display pipeline as the way.
- **Date:** 2026-11-06

## Context

The cloud browser must feel like a browser, not a remote desktop. It has to
work with Chromium first and Firefox later, and over restrictive café and
hotel networks.

## Decision

- **Brawzer draws all browser chrome** (tabs, address bar, menus, dialogs). The engine runs without visible UI. The client receives only page pixels plus structured events: URL, title, favicon, loading and security state. Engine dialogs, file pickers, permission prompts and printing are intercepted and shown as Brawzer UI.
- **Phase 3a: CDP screencast over secure WebSocket.**
  - Headless Chromium sends frames for each tab; input goes back through CDP's `Input` domain.
  - Real browsing, entirely in TypeScript, quick to deliver.
  - Limits: Chromium only, no audio, about 15–30 fps.
- **Phase 3b: WebRTC.**
  - The engine runs full-screen in a virtual display sized to the user's viewport, so the display holds page content only.
  - GStreamer captures and encodes it. WebRTC carries video, audio and an input data channel.
  - TURN runs on TLS port 443 for strict networks.
  - The approach works with any engine, which enables Firefox via WebDriver BiDi.
  - Before committing, benchmark a TypeScript WebRTC stack (`werift`, `node-datachannel`) against a small Go/Pion media service.
- **3a stays as the fallback** when UDP or TURN is blocked.

## Consequences

- Keyboard shortcuts reserved by the local browser (⌘/Ctrl+W, T, N) can't be captured by a web page. Brawzer defines its own shortcuts, and uses the Keyboard Lock API in full-screen where the local browser supports it.
- Media with DRM (some video services) is expected to be limited.
- Streaming bandwidth (estimated 0.5–2 GB per active hour) drives hosting costs. Choose providers from Phase 3 measurements.

## Measurements (milestone 3.1)

Headless Chromium 1248 (Playwright's build) on Apple Silicon, 1280×800, one
tab, no network between the browser and the reader of the frames. Scripts:
`infra/bench/screencast.mjs` and `infra/bench/screencast-rich.mjs`.

| Scene                                   | JPEG quality | Frames per second | Size per frame | Bandwidth    |
| --------------------------------------- | ------------ | ----------------- | -------------- | ------------ |
| Simple animation                        | 50 to 85     | 60                | 8 KB           | 3.7–4 Mbit/s |
| Brawzer's home page, scrolling non-stop | 50           | 50                | 33 KB          | 13.6 Mbit/s  |
| Same                                    | 70           | 40                | 57 KB          | 19 Mbit/s    |
| Same, frames acknowledged 100 ms late   | 50           | 25                | 45 KB          | 9.1 Mbit/s   |
| Same, frames acknowledged 250 ms late   | 50           | 11                | 47 KB          | 4.4 Mbit/s   |

- **Input to next frame** (key press on a still page): median 16–22 ms, 90th percentile 21–32 ms, before any network time.
- **Chromium paces itself by acknowledgements**, keeping about three frames in flight. A slow viewer therefore gets fewer frames rather than a growing backlog.
- A still page sends no frames at all, so the hourly figure depends on how much of the hour is scrolling or video.

## Settings chosen for step 3a

- **JPEG quality 60** by default: text stays crisp while frames stay near the quality-50 size.
- **Frames at device pixel ratio 1**, up to 1920×1080. High-density screens are scaled up locally; streaming at 2× would roughly quadruple the bytes. (Revised below: a still page gets one frame at the screen's own ratio.)
- **Acknowledgements travel end to end.** The agent acknowledges a frame to Chromium only when the viewer reports it has drawn that frame, so each viewer's connection sets its own frame rate.
- **Frames replace, never queue.** If a newer frame arrives before an older one is sent, the older one is dropped.

## Addendum (2026-11-08): sound without WebRTC

Sound came by the shortest honest path rather than with step 3b's WebRTC:
the runtime starts a PulseAudio server of the session's own with one null
sink, both engines play into it (they find it through `PULSE_SERVER`; the
3b spike's failure to see Chromium connect was the spike's probe lacking
the session seccomp profile, not the engine), the agent captures the sink's
monitor with `parec` (one channel, 24 kHz, 16-bit, 20 ms chunks, silence
skipped) and streams it as `A` binary messages beside the frames, never
acknowledged. The page plays them on a Web Audio context scheduled a little
ahead, unlocked by the person's first click or keystroke, with a speaker
control in the status bar. About 380 kbit/s while sound plays, nothing while
it doesn't. WebRTC video (lower latency, hardware encode) remains a later
step; the frame stream stays the production path.

## Addendum (2026-11-09): measured under load

`infra/bench/stream-load.mjs` measures sessions side by side on a host. On a
developer machine, Bee kept 32 frames a second per session from one to eight
sessions, at about half a core and 275 MB each, sending about 17 Mbit/s per
session while scrolling a busy page; Firefox kept about 12 frames a second.
Bandwidth, not CPU, is what step 3a costs most: adapting JPEG quality to the
viewer's link is the first lever, before WebRTC's encoders.

## Addendum (2026-11-12): sharp when still

Streaming every frame at ratio 1 made every page on a dense screen (every
MacBook, most phones) soft: the browser stretched each frame twice over.
Streaming everything at 2× would have quadrupled the bytes and made scrolling
lag. The revision keeps the moving frames as they were and adds one sharp
frame once the page stops:

- The viewer sends its pixel ratio with `hello` and `resize` (`viewport.scale`,
  capped at 2 and by a budget of 6 million pixels, so 1920×1080 asks for 1.7).
- Chromium lays the page out at that ratio (`deviceScaleFactor`), and the
  screencast scales its frames down to the page's size on the way out, so
  frames of a moving page cost what they did. When no frame has arrived for
  300 ms, the agent captures one screenshot as painted (JPEG quality 85) and
  sends it with its scale in the header; the viewer draws it pixel for pixel.
- Firefox can't scale a capture on the way out, so it is captured at ratio 1
  while the page moves and, once the page has been unchanged for 300 ms,
  switched to the viewer's ratio for one capture and switched back.
- A sharp frame goes only when the viewer has drawn every moving frame, and
  if one takes more than 1.5 s to be drawn the agent pauses sharp frames for
  30 s: a slow connection gets the stream it had before, never a backlog.
- The pointer is mapped in the page's CSS pixels whatever the frame's scale.
- Once the sharp picture is up, a lone frame (a blinking text cursor, a
  clock) no longer replaces it with a soft frame: the agent acknowledges
  the frame and refreshes the sharp picture instead, at most once a second.
  Only sustained movement, three frames within 700 ms, returns the stream
  to moving frames. Before this, a page with a blinking cursor flickered
  between soft and sharp twice a second.

Measured on the long test page, 1280×800 at ratio 2 against ratio 1: Chromium
scrolls at 19 frames a second against 21, Firefox at 8 against 9, with moving
frames the same size (about 39 KB and 48 KB); the sharp frame is 170–190 KB and
arrives 0.4–0.9 s after the page stops; a still page sends nothing further.

## Addendum (2026-11-12): what the pointer is over, and site icons

Two more things travel on the stream, both agent to viewer (Phase 10.1):
`pointer` says what the pointer is over (the cursor the page asks for and
whether anything there scrolls sideways), asked of the page by a script at
most every 60 ms while the pointer moves and sent when the answer changes;
`favicon` carries a tab's site icon as a data URL, fetched by the container
through the session's own filtering proxy, so the same policy applies as to
the page and the viewer never asks a site for anything. The viewer also
times the ping it already sent, now every 5 s, and shows the round trip.

## Addendum (2026-11-12): the moving page as video

Step 3b's WebRTC never came: the session's container has no network of its
own (its traffic goes through the egress sidecar, ADR 0014) and no UDP, so
a media path would need its own relay. The moving page now goes as video
over the same WebSocket instead (Phase 10.5):

- The viewer says in `hello` which codecs it decodes (`codecs: ["vp8"]`
  when WebCodecs can). The container has ffmpeg (Debian's, with libvpx).
- In the agent, each engine's pictures of the moving page (the screencast's
  JPEGs; Firefox's screenshots) go into one ffmpeg per page size (the
  `mjpeg` demuxer in, `libvpx` at realtime settings, `-g 48`, 1.6 Mbit/s
  aiming, 2.6 ceiling, IVF out), whose frames go to the viewer as `V`
  messages: a sequence number, the codec, whether it is a key frame, the
  size. Chromium is acknowledged as soon as the encoder has the picture, so
  the engine draws as fast as it can; a picture the encoder can't take yet
  is skipped, never queued. Two things measured in the image decided the
  flags: `image2pipe` holds every picture until the input closes, while the
  `mjpeg` demuxer hands each on as the next begins; so the last picture
  before a pause is fed once more after 60 ms to let it through.
- Video is never acknowledged. A chunk the relay or the agent drops (the
  viewer behind) leaves the frames after it useless: the agent sends nothing
  until the next key frame, and a viewer that sees a gap or a decoder error
  asks for one (`video-lost`), which starts a fresh encoder.
- The still page's sharp picture (the addendum above) stays as it was:
  one JPEG at the screen's ratio, drawn over the last video frame.
- Without ffmpeg, a viewer without WebCodecs, or `BRAWZER_VIDEO=off`, the
  stream is the pictures it was.

Measured on the long test page at 1280×800, scrolling without pause for
5 s, against the pictures-only figures above: Chromium 27 frames a second at
1.6 Mbit/s (pictures: 21 at 13–19 Mbit/s), Firefox 21 at 1.2 Mbit/s
(pictures: 9 at about 5 Mbit/s); a still page sends one frame and then
nothing. ffmpeg adds about 300 MB to the image (2.9 GB).
