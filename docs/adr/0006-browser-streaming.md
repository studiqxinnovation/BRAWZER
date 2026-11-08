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
- **Frames at device pixel ratio 1**, up to 1920×1080. High-density screens are scaled up locally; streaming at 2× would roughly quadruple the bytes.
- **Acknowledgements travel end to end.** The agent acknowledges a frame to Chromium only when the viewer reports it has drawn that frame, so each viewer's connection sets its own frame rate.
- **Frames replace, never queue.** If a newer frame arrives before an older one is sent, the older one is dropped.
