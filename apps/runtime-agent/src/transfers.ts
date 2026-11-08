import { createReadStream } from "node:fs";
import { type FileHandle, open, rm } from "node:fs/promises";
import { encodeTransferChunk, TRANSFER_CHUNK_BYTES } from "@brawzer/contracts";

/** Something that can take binary messages and says when each one has left the process. */
export interface BinarySink {
  sendBinary(bytes: Uint8Array): Promise<void>;
}

/**
 * Streams a file to the relay as ordered transfer chunks, waiting for each to
 * leave before reading the next, so a slow relay never fills the agent's
 * memory. Returns the number of bytes sent.
 */
export async function sendFile(
  sink: BinarySink,
  transferId: string,
  path: string,
): Promise<number> {
  let seq = 0;
  let bytes = 0;
  const stream = createReadStream(path, { highWaterMark: TRANSFER_CHUNK_BYTES });
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    bytes += chunk.length;
    await sink.sendBinary(encodeTransferChunk({ transferId, seq: seq++, last: false }, chunk));
  }
  await sink.sendBinary(encodeTransferChunk({ transferId, seq, last: true }, new Uint8Array(0)));
  return bytes;
}

/**
 * Writes the chunks of one incoming file (a Drive file for a page's file
 * chooser) to disk, in order, up to a limit. Out-of-order or oversized input
 * fails the transfer and removes the partial file.
 */
export class ChunkWriter {
  private handle: FileHandle | null = null;
  private expected = 0;
  private written = 0;
  private settled = false;
  private resolveDone!: (bytes: number) => void;
  private rejectDone!: (error: Error) => void;
  /** Resolves with the size once the last chunk is written. */
  readonly done: Promise<number>;

  constructor(
    readonly path: string,
    private readonly maxBytes: number,
  ) {
    this.done = new Promise<number>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    // The caller observes failures through `done`; an unobserved rejection must not crash the agent.
    this.done.catch(() => undefined);
  }

  /** Chunks arrive as fast as the socket delivers them; writes happen one at a time. */
  private queue: Promise<void> = Promise.resolve();

  write(seq: number, data: Uint8Array, last: boolean): Promise<void> {
    // Two concurrent writes would each open the file and leak a handle, which
    // Node treats as fatal when it is collected; the queue keeps them in order.
    this.queue = this.queue.then(() => this.writeNow(seq, data, last));
    return this.queue;
  }

  private async writeNow(seq: number, data: Uint8Array, last: boolean): Promise<void> {
    if (this.settled) return;
    try {
      if (seq !== this.expected) throw new Error("chunk out of order");
      this.expected += 1;
      this.written += data.length;
      if (this.written > this.maxBytes) throw new Error("file too large");
      this.handle ??= await open(this.path, "w", 0o600);
      if (data.length > 0) await this.handle.write(data);
      if (last) {
        await this.handle.close();
        this.handle = null;
        this.settled = true;
        this.resolveDone(this.written);
      }
    } catch (error) {
      await this.abort(error instanceof Error ? error : new Error("write failed"));
    }
  }

  async abort(error: Error): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    await this.handle?.close().catch(() => undefined);
    this.handle = null;
    await rm(this.path, { force: true }).catch(() => undefined);
    this.rejectDone(error);
  }
}
