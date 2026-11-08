import {
  type AgentMessage,
  agentMessageSchema,
  type ClientMessageInput,
  decodeFrame,
  type FrameHeader,
  STREAM_CLOSE_CODES,
  type Viewport,
} from "@brawzer/contracts";

export type StreamEvent =
  | { kind: "message"; message: AgentMessage }
  | { kind: "frame"; header: FrameHeader; image: Blob }
  | { kind: "closed"; code: number; reason: string };

const PING_INTERVAL_MS = 20_000;

/**
 * The page's end of the cloud browser stream: opens the relay's WebSocket,
 * presents the ticket, says hello with the viewport, and turns what arrives
 * into typed events. Frames are acknowledged by the caller once drawn, so
 * the engine never sends faster than this connection can show.
 */
export class BrowserStream {
  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onEvent: (event: StreamEvent) => void) {}

  open(url: string, ticket: string, viewport: Viewport): void {
    this.close();
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "ticket", ticket }));
      this.send({ type: "hello", viewport });
      this.pingTimer = setInterval(() => this.send({ type: "ping" }), PING_INTERVAL_MS);
    });
    socket.addEventListener("message", (event: MessageEvent<ArrayBuffer | string>) => {
      if (typeof event.data === "string") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        const message = agentMessageSchema.safeParse(parsed);
        if (message.success && message.data.type !== "pong") {
          this.onEvent({ kind: "message", message: message.data });
        }
        return;
      }
      const frame = decodeFrame(new Uint8Array(event.data));
      if (!frame) return;
      this.onEvent({
        kind: "frame",
        header: frame.header,
        image: new Blob([frame.image.slice()], { type: "image/jpeg" }),
      });
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.stopPing();
      this.socket = null;
      this.onEvent({ kind: "closed", code: event.code, reason: event.reason });
    });
    socket.addEventListener("error", () => undefined);
  }

  send(message: ClientMessageInput): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "left");
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}

/** What a close code means for the person, and whether reconnecting makes sense. */
export function describeClose(code: number): { message: string; retry: boolean } {
  switch (code) {
    case STREAM_CLOSE_CODES.ended:
      return { message: "This browser session has ended.", retry: false };
    case STREAM_CLOSE_CODES.replaced:
      return { message: "This session was opened in another window.", retry: false };
    case STREAM_CLOSE_CODES.unauthorized:
      return { message: "The stream link expired before it was used.", retry: true };
    case STREAM_CLOSE_CODES.runtimeClosed:
      return { message: "The cloud browser stopped.", retry: false };
    case STREAM_CLOSE_CODES.badMessage:
      return { message: "The connection was closed because of a bad message.", retry: true };
    case 1000:
      return { message: "The connection was closed.", retry: false };
    default:
      return { message: "The connection to the cloud browser was lost.", retry: true };
  }
}
