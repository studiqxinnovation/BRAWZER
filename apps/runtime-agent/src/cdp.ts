import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

/** A DevTools Protocol error reply. */
export class CdpError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
  ) {
    super(`${method}: ${message} (${String(code)})`);
    this.name = "CdpError";
  }
}

interface Pending {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface Incoming {
  id?: number;
  method?: string;
  params?: unknown;
  sessionId?: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export type CdpListener = (params: unknown, sessionId: string | undefined) => void;

/**
 * The Chrome DevTools Protocol over Chromium's `--remote-debugging-pipe`:
 * NUL-terminated JSON messages written to the engine on one pipe and read
 * from it on another. No debugging port ever exists, so nothing on the
 * network can reach the engine's controls.
 */
export class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly events = new EventEmitter({ captureRejections: false });
  private chunks: Buffer[] = [];
  private closed: Error | null = null;

  constructor(
    private readonly input: Writable,
    output: Readable,
  ) {
    this.events.setMaxListeners(0);
    output.on("data", (chunk: Buffer) => {
      this.read(chunk);
    });
    output.on("end", () => {
      this.close(new Error("The engine closed its DevTools pipe"));
    });
    output.on("error", (error: Error) => {
      this.close(error);
    });
    input.on("error", (error: Error) => {
      this.close(error);
    });
  }

  /** Sends a command; the promise settles with the reply. */
  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { method, resolve: (value) => resolve(value as T), reject });
      this.input.write(`${message}\0`);
    });
  }

  on(method: string, listener: CdpListener): () => void {
    this.events.on(method, listener);
    return () => {
      this.events.off(method, listener);
    };
  }

  onClose(listener: (error: Error) => void): void {
    this.events.on("close", listener);
  }

  get isClosed(): boolean {
    return this.closed !== null;
  }

  close(error = new Error("DevTools connection closed")): void {
    if (this.closed) return;
    this.closed = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.events.emit("close", error);
  }

  private read(chunk: Buffer): void {
    let start = 0;
    for (;;) {
      const end = chunk.indexOf(0, start);
      if (end === -1) {
        if (start < chunk.length) this.chunks.push(chunk.subarray(start));
        return;
      }
      this.chunks.push(chunk.subarray(start, end));
      const text = Buffer.concat(this.chunks).toString("utf8");
      this.chunks = [];
      this.dispatch(text);
      start = end + 1;
    }
  }

  private dispatch(text: string): void {
    let message: Incoming;
    try {
      message = JSON.parse(text) as Incoming;
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new CdpError(pending.method, message.error.code, message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method) {
      if (process.env.BRAWZER_AGENT_DEBUG === "true") {
        process.stdout.write(
          `${JSON.stringify({ event: message.method, sessionId: message.sessionId, params: message.method.startsWith("Target.") ? message.params : undefined })}\n`,
        );
      }
      this.events.emit(message.method, message.params, message.sessionId);
    }
  }
}
