import type { Writable } from "node:stream";

/** How much of one transfer may wait in the relay's memory before the agent is paused. */
export const TRANSFER_BUFFER_BYTES = 2 * 1024 * 1024;

/**
 * Keeps a download's memory in the relay bounded (Phase 8, idea 16): chunks
 * from the agent go into a stream that Drive's upload reads (scanning and
 * encrypting as it goes); when that stream's buffer is full, the agent's
 * socket is paused until the upload has drained it. Several transfers may
 * be in flight; the socket stays paused while any of them is full.
 */
export class BackPressure {
  private readonly full = new Set<string>();
  private pausedCount = 0;

  constructor(
    private readonly socket: { pause(): void; resume(): void },
    private readonly onPause?: () => void,
  ) {}

  /** How often the agent was paused: a figure for the metrics, not a limit. */
  get pauses(): number {
    return this.pausedCount;
  }

  get paused(): boolean {
    return this.full.size > 0;
  }

  /** Writes a chunk; pauses the agent when the stream's buffer is full, until it drains. */
  write(transferId: string, body: Writable, chunk: Buffer): void {
    if (body.destroyed) return;
    const ok = body.write(chunk);
    if (ok || this.full.has(transferId)) return;
    this.full.add(transferId);
    if (this.full.size === 1) {
      this.pausedCount += 1;
      this.socket.pause();
      this.onPause?.();
    }
    body.once("drain", () => {
      this.release(transferId);
    });
  }

  /** The transfer ended or failed: it holds the agent no longer. */
  release(transferId: string): void {
    if (!this.full.delete(transferId)) return;
    if (this.full.size === 0) this.socket.resume();
  }

  /** Every transfer is over (the stream closed): nothing holds the agent. */
  releaseAll(): void {
    if (this.full.size === 0) return;
    this.full.clear();
    this.socket.resume();
  }
}
