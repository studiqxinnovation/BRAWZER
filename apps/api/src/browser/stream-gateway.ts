import {
  clientMessageSchema,
  decodeFrame,
  STREAM_CLOSE_CODES,
  streamAuthMessageSchema,
} from "@brawzer/contracts";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { WebSocket } from "ws";
import { isAllowedOrigin } from "../common/request-meta.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { BrowserService } from "./browser.service.js";
import { StreamTickets } from "./stream-tickets.js";

const logger = new Logger("StreamGateway");
const TICKET_WAIT_MS = 5_000;
const CHECK_INTERVAL_MS = 10_000;
const TOUCH_INTERVAL_MS = 60_000;
const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;
const MAX_BAD_MESSAGES = 20;
const MAX_QUEUED_MESSAGES = 100;
/** Queued bytes towards the page above which frames are dropped (and acknowledged for it). */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

type RawData = Buffer | ArrayBuffer | Buffer[];

function rawText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function rawBytes(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function sendError(
  socket: WebSocket,
  code: "unauthorized" | "ended" | "replaced",
  message: string,
) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "error", code, message }));
  }
}

/**
 * Relays the Browser page's WebSocket to the session's runtime agent. The
 * page proves itself with a single-use ticket (first message), the relay
 * proves itself to the agent with the session's secret; neither side ever
 * sees the other's credential. Messages from the page are validated before
 * they are passed on; the agent validates them again.
 */
@Injectable()
export class StreamGateway {
  private readonly relays = new Map<string, { close(code: number, reason: string): void }>();

  constructor(
    @Inject(BrowserService) private readonly browser: BrowserService,
    @Inject(StreamTickets) private readonly tickets: StreamTickets,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.browser.events.on("ended", (sessionId: string) => {
      this.relays.get(sessionId)?.close(STREAM_CLOSE_CODES.ended, "ended");
    });
  }

  /** A fresh connection on /browser/sessions/:id/stream. */
  handle(client: WebSocket, request: FastifyRequest): void {
    const { id } = request.params as { id: string };
    logger.debug(`Stream connection for session ${id} (state ${String(client.readyState)})`);
    if (!isAllowedOrigin(request.headers, this.config.allowedOrigins)) {
      client.close(STREAM_CLOSE_CODES.unauthorized, "origin");
      return;
    }
    const timer = setTimeout(() => {
      sendError(client, "unauthorized", "No ticket was presented.");
      client.close(STREAM_CLOSE_CODES.unauthorized, "no ticket");
    }, TICKET_WAIT_MS);
    client.once("message", (data: RawData) => {
      clearTimeout(timer);
      // The page talks right after its ticket: keep what arrives while the ticket is checked.
      const early: { data: RawData; isBinary: boolean }[] = [];
      const keep = (payload: RawData, isBinary: boolean) => {
        if (early.length < MAX_QUEUED_MESSAGES) early.push({ data: payload, isBinary });
      };
      client.on("message", keep);
      void this.authenticate(client, id, data, () => {
        client.off("message", keep);
        return early;
      });
    });
    client.on("error", () => undefined);
  }

  private async authenticate(
    client: WebSocket,
    id: string,
    data: RawData,
    takeEarly: () => { data: RawData; isBinary: boolean }[],
  ): Promise<void> {
    logger.debug(`Stream ticket presented for session ${id}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText(data));
    } catch {
      parsed = undefined;
    }
    const message = streamAuthMessageSchema.safeParse(parsed);
    const claims = message.success ? await this.tickets.redeem(message.data.ticket, id) : null;
    logger.debug(`Stream ticket for session ${id}: ${claims ? "valid" : "invalid"}`);
    const access = claims ? await this.browser.viewerAccess(id, claims.userId) : null;
    logger.debug(`Stream access for session ${id}: ${access ? "granted" : "refused"}`);
    if (!claims || !access) {
      takeEarly();
      sendError(client, "unauthorized", "This stream link has expired. Reload the page.");
      client.close(STREAM_CLOSE_CODES.unauthorized, "ticket");
      return;
    }
    if (client.readyState !== WebSocket.OPEN) return;

    const agent = new WebSocket(`ws://${access.agentAddress}/stream`, {
      headers: { authorization: `Bearer ${access.secret}` },
      handshakeTimeout: 5_000,
      maxPayload: 16 * 1024 * 1024,
    });
    agent.binaryType = "nodebuffer";

    let closed = false;
    const close = (code: number, reason: string) => {
      if (closed) return;
      closed = true;
      clearInterval(check);
      clearInterval(touch);
      if (this.relays.get(id) === relay) this.relays.delete(id);
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close(code, reason);
      }
      if (agent.readyState === WebSocket.OPEN || agent.readyState === WebSocket.CONNECTING) {
        agent.close(1000, reason);
      }
      void this.browser.touch(id).catch(() => undefined);
    };
    const relay = { close };

    // Only one viewer per session: a new one replaces the old one.
    this.relays.get(id)?.close(STREAM_CLOSE_CODES.replaced, "replaced");
    this.relays.set(id, relay);

    const check = setInterval(() => {
      void this.browser.viewerAllowed(id, claims.authSessionId).then((allowed) => {
        if (!allowed) {
          sendError(client, "ended", "This browser session has ended.");
          close(STREAM_CLOSE_CODES.ended, "ended");
        }
      });
    }, CHECK_INTERVAL_MS);
    const touch = setInterval(() => {
      void this.browser.touch(id).catch(() => undefined);
    }, TOUCH_INTERVAL_MS);
    void this.browser.touch(id).catch(() => undefined);

    let bad = 0;
    // What the page sends before the agent answers waits here.
    const queued: string[] = [];
    const onClientMessage = (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        close(STREAM_CLOSE_CODES.badMessage, "text only");
        return;
      }
      const text = rawText(data);
      if (text.length > MAX_CLIENT_MESSAGE_BYTES) {
        close(STREAM_CLOSE_CODES.badMessage, "too large");
        return;
      }
      let candidate: unknown;
      try {
        candidate = JSON.parse(text);
      } catch {
        candidate = undefined;
      }
      const parsed = clientMessageSchema.safeParse(candidate);
      if (!parsed.success) {
        if (++bad > MAX_BAD_MESSAGES) close(STREAM_CLOSE_CODES.badMessage, "bad messages");
        return;
      }
      const serialized = JSON.stringify(parsed.data);
      if (agent.readyState === WebSocket.OPEN) {
        agent.send(serialized);
      } else if (queued.length < MAX_QUEUED_MESSAGES) {
        queued.push(serialized);
      }
    };
    for (const message of takeEarly()) onClientMessage(message.data, message.isBinary);
    client.on("message", onClientMessage);
    agent.on("open", () => {
      for (const message of queued.splice(0)) agent.send(message);
    });
    agent.on("message", (data: RawData, isBinary: boolean) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (!isBinary) {
        client.send(rawText(data));
        return;
      }
      const bytes = rawBytes(data);
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
        // The page is behind: drop the frame and acknowledge it in its place.
        const frame = decodeFrame(bytes);
        if (frame && agent.readyState === WebSocket.OPEN) {
          agent.send(
            JSON.stringify({
              type: "frame-ack",
              tabId: frame.header.tabId,
              frameId: frame.header.frameId,
            }),
          );
        }
        return;
      }
      client.send(bytes, { binary: true });
    });
    agent.on("close", () => {
      close(STREAM_CLOSE_CODES.runtimeClosed, "runtime closed");
    });
    agent.on("error", (error: Error) => {
      logger.warn(`Agent connection for session ${id} failed: ${error.message}`);
      close(STREAM_CLOSE_CODES.runtimeClosed, "runtime unreachable");
    });
    client.on("close", () => {
      close(1000, "client closed");
    });
  }

  /** How many sessions currently have a viewer. */
  get viewerCount(): number {
    return this.relays.size;
  }
}
