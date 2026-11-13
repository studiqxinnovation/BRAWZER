import { WebSocket } from "ws";
import { log } from "./log.ts";

type Listener = (params: Record<string, unknown>) => void;

export class BidiError extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
    message: string,
  ) {
    super(`${method}: ${message} (${code})`);
    this.name = "BidiError";
  }
}

/**
 * A WebDriver BiDi connection to Firefox: commands with ids, events by
 * method name. The socket is on the container's loopback and lives as long
 * as the engine does.
 */
export class BidiConnection {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { method: string; resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly listeners = new Map<string, Set<Listener>>();
  private closeListeners: ((error: Error) => void)[] = [];
  private closed = false;

  async connect(url: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await this.open(url);
        return;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  private open(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { handshakeTimeout: 2_000, maxPayload: 64 * 1024 * 1024 });
      socket.once("open", () => {
        this.socket = socket;
        socket.on("message", (data) => {
          const text = Array.isArray(data)
            ? Buffer.concat(data).toString("utf8")
            : Buffer.from(data as Uint8Array).toString("utf8");
          this.dispatch(text);
        });
        socket.on("close", () => {
          this.fail(new Error("The engine closed its BiDi connection"));
        });
        socket.on("error", () => undefined);
        resolve();
      });
      socket.once("error", (error) => {
        reject(error);
      });
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    if (!this.socket || this.closed) {
      return Promise.reject(new BidiError(method, "closed", "the connection is closed"));
    }
    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject });
      this.socket?.send(message);
    });
  }

  on(method: string, listener: Listener): () => void {
    let set = this.listeners.get(method);
    if (!set) {
      set = new Set();
      this.listeners.set(method, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  onClose(listener: (error: Error) => void): void {
    this.closeListeners.push(listener);
  }

  close(): void {
    this.fail(new Error("closed"));
    this.socket?.close();
  }

  private dispatch(raw: string): void {
    let message: {
      id?: number;
      type?: string;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: string;
      message?: string;
    };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.type === "error") {
        pending.reject(
          new BidiError(pending.method, message.error ?? "unknown", message.message ?? ""),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method) {
      if (process.env.BRAWZER_AGENT_DEBUG === "true" && !message.method.startsWith("log.")) {
        process.stdout.write(
          `${JSON.stringify({ bidi: message.method, params: message.params })}\n`,
        );
      }
      for (const listener of this.listeners.get(message.method) ?? []) {
        try {
          listener(message.params ?? {});
        } catch (error) {
          log("warn", "bidi listener failed", {
            method: message.method,
            message: error instanceof Error ? error.message : "",
          });
        }
      }
    }
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const listener of this.closeListeners) listener(error);
  }
}
