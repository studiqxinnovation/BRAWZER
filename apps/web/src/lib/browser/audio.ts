import type { AudioChunkHeader } from "@brawzer/contracts";

/** How far ahead of "now" chunks are scheduled: smooths the network, costs this much delay. */
const LEAD_SECONDS = 0.12;
/** When playback has fallen this far behind the arriving sound, it jumps forward. */
const MAX_LAG_SECONDS = 0.6;

/**
 * Plays the session's sound (Phase 3b): short PCM chunks from the relay,
 * scheduled back to back on a Web Audio context. No worklet and no separate
 * script, which keeps the page's script policy strict. The context needs a
 * gesture before it may play; `unlock` is called from the page's own input.
 */
export class AudioPlayer {
  private context: AudioContext | null = null;
  private cursor = 0;
  private lastSeq = -1;
  private enabled = true;

  /** Whether the browser lets the sound play yet (a gesture is needed first). */
  get unlocked(): boolean {
    return this.context?.state === "running";
  }

  get on(): boolean {
    return this.enabled;
  }

  /** Called from a user gesture: creates or resumes the context. */
  unlock(): void {
    try {
      this.context ??= new AudioContext();
      if (this.context.state !== "running") void this.context.resume();
    } catch {
      this.context = null;
    }
  }

  setOn(on: boolean): void {
    this.enabled = on;
    if (!on) this.cursor = 0;
  }

  play(header: AudioChunkHeader, samples: Uint8Array): void {
    const context = this.context;
    if (!this.enabled || context?.state !== "running") return;
    const frames = samples.length / (2 * header.channels);
    if (frames === 0) return;
    const buffer = context.createBuffer(header.channels, frames, header.sampleRate);
    const view = new DataView(samples.buffer, samples.byteOffset, samples.byteLength);
    for (let channel = 0; channel < header.channels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < frames; i++) {
        data[i] = view.getInt16((i * header.channels + channel) * 2, true) / 32768;
      }
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const now = context.currentTime;
    // A gap in sequence numbers, or a cursor that fell behind: start afresh a little ahead.
    if (
      header.seq !== this.lastSeq + 1 ||
      this.cursor < now ||
      this.cursor - now > MAX_LAG_SECONDS
    ) {
      this.cursor = now + LEAD_SECONDS;
    }
    this.lastSeq = header.seq;
    source.start(this.cursor);
    this.cursor += buffer.duration;
  }

  close(): void {
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.cursor = 0;
  }
}
