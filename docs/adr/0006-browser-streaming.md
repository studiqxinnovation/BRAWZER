# 0006 Browser streaming

- **Status:** Proposed. Phase 3 begins with a short benchmark spike.
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
