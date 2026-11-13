# Phase 3b spike: WebRTC, sound and Firefox

Measured 2026-11-08 on the Phase 3a runtime image (Debian's Chromium 156,
new headless mode, the Phase 3 seccomp profile) to decide how step 3b of
[ADR 0006](../adr/0006-browser-streaming.md) would be built. **Nothing of 3b
is built**; this records what was found and what it means.

## What was tried

1. **Tab capture from inside the engine** (`getDisplayMedia` on a capture page, with `--use-fake-ui-for-media-stream`, `--auto-select-tab-capture-source-by-title` and a managed policy allowing capture without a gesture; the captured tab a different one from the capturer): the picker is answered, but the stream fails with `NotReadableError: Could not start video source`. New headless Chromium has no compositor surface to capture from. The same page produces a WebRTC offer fine once it has a stream, so signalling and the data path are not the problem; the source is.
2. **Audio output into PulseAudio** (a null sink and the native protocol socket at `$XDG_RUNTIME_DIR/pulse/native`, the engine as the same user, with and without the audio service sandbox, headless and headful under Xvfb): Chromium never connects to the server (no PulseAudio client appears), so nothing can be captured from the sink's monitor. Debian's build links `libpulse`, so the cause is in how the engine starts its audio service in this container, not a missing library; it was not found within the spike.

## What this means

- WebRTC streaming from the engine's own capture (the cheap path) is out for headless Chromium. 3b as ADR 0006 describes it, a **virtual display with GStreamer capture and encode** (`ximagesrc` or a PipeWire portal, `vp8enc`/`vp9enc`, `webrtcbin`) and audio from PulseAudio, is the way, for Chromium and for Firefox alike. That is a media service with native dependencies inside the runtime image, a TURN deployment, and an opening in the egress firewall for the engine's media traffic to the TURN server only: a build of its own, measured against the Phase 3a figures before replacing them.
- The 3a screencast remains the production path. Pages without sound are the stated limit on the Browser page.

## Next steps, when 3b is scheduled

1. Make Chromium's audio reach PulseAudio in the container (likely a `--audio-output`/`--alsa` fallback or the runtime directory the audio service brokers), measured with the probe scripts from this spike.
2. Xvfb or a PipeWire headless session, GStreamer with `webrtcbin`, coturn in `infra`, the firewall rule for the media path, a `media` transport in the stream protocol with the JPEG path as fallback.
3. Firefox through WebDriver BiDi on the same capture path.

## Addendum (2026-11-08)

Finding 2 was the probe's mistake, not the engine's: the audio probes ran
containers without the session seccomp profile, so Chromium had no usable
sandbox and exited before any page played. Under the real profile, headless
Chromium connects to a PulseAudio server reached through `PULSE_SERVER`
(anonymous auth on a socket in the scratch space) with its default flags and
plays into a null sink, whose monitor the agent captures. Sound shipped on
that path (ADR 0006, addendum); WebRTC video remains as step 3b describes.
