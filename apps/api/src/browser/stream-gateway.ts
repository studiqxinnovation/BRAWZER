import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { BackPressure, TRANSFER_BUFFER_BYTES } from "./back-pressure.js";
import {
  agentMessageSchema,
  binaryKind,
  type ClientMessage,
  clientMessageSchema,
  decodeFrame,
  decodeTransferChunk,
  encodeTransferChunk,
  type RelayMessage,
  STREAM_CLOSE_CODES,
  streamAuthMessageSchema,
  TRANSFER_CHUNK_BYTES,
  type TransferMessage,
} from "@brawzer/contracts";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import type { Redis } from "ioredis";
import type { FastifyRequest } from "fastify";
import { WebSocket } from "ws";
import { ApiException } from "../common/api-exception.js";
import { isAllowedOrigin, type RequestMeta, requestMeta } from "../common/request-meta.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DriveService, type OpenedFile } from "../drive/drive.service.js";
import { REDIS } from "../redis/redis.module.js";
import { SecurityEventsService } from "../security-events/security-events.js";
import { BrowserService, SESSION_ENDED_CHANNEL } from "./browser.service.js";
import { StreamTickets } from "./stream-tickets.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { HistoryService } from "../history/history.service.js";

const logger = new Logger("StreamGateway");
const TICKET_WAIT_MS = 5_000;
const CHECK_INTERVAL_MS = 10_000;
const TOUCH_INTERVAL_MS = 60_000;
const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;
const MAX_BAD_MESSAGES = 20;
const MAX_QUEUED_MESSAGES = 100;
/** Queued bytes towards the page above which frames are dropped (and acknowledged for it). */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
/** Where the cloud browser's downloads and printed pages go in Drive. */
const DOWNLOADS_FOLDER = "Downloads";

type RawData = Buffer | ArrayBuffer | Buffer[];

function rawText(data: RawData): string {
  return rawBytes(data).toString("utf8");
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

/** Sends one binary message to the agent and resolves once it has left the process. */
function sendBinary(agent: WebSocket, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    if (agent.readyState !== WebSocket.OPEN) {
      reject(new Error("agent gone"));
      return;
    }
    agent.send(bytes, { binary: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/** A download or printed page arriving from the agent, on its way into Drive. */
interface IncomingTransfer {
  message: TransferMessage;
  body: PassThrough;
}

/**
 * Relays the Browser page's WebSocket to the session's runtime agent. The
 * page proves itself with a single-use ticket (first message), the relay
 * proves itself to the agent with the session's secret; neither side ever
 * sees the other's credential. Messages from the page are validated before
 * they are passed on; the agent validates them again.
 *
 * Files never reach the page: downloads and printed pages come from the
 * agent as transfer chunks and go into Drive here (scanned and encrypted
 * like any upload), and a page's file chooser is answered with Drive files
 * streamed to the agent the same way.
 */
@Injectable()
export class StreamGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly relays = new Map<
    string,
    { authSessionId: string; close(code: number, reason: string): void }
  >();
  /** Figures for the metrics: how often a download had to pause its agent. */
  readonly stats = { transferPauses: 0 };
  private subscriber: Redis | null = null;

  constructor(
    @Inject(BrowserService) private readonly browser: BrowserService,
    @Inject(StreamTickets) private readonly tickets: StreamTickets,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DriveService) private readonly drive: DriveService,
    @Inject(SecurityEventsService) private readonly securityEvents: SecurityEventsService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(HistoryService) private readonly history: HistoryService,
  ) {
    this.browser.events.on("ended", (sessionId: string) => {
      this.relays.get(sessionId)?.close(STREAM_CLOSE_CODES.ended, "ended");
    });
    // A sign-in locked here stops its streams now; on other instances, the
    // periodic check stops them within CHECK_INTERVAL_MS.
    this.browser.onSignInLocked((authSessionId) => {
      for (const relay of [...this.relays.values()]) {
        if (relay.authSessionId === authSessionId) relay.close(STREAM_CLOSE_CODES.locked, "locked");
      }
    });
  }

  /** A session ended on any instance: cut its viewer here too (ADR 0016). */
  onApplicationBootstrap(): void {
    this.metrics.gauge("brawzer_stream_viewers", "Pages watching a session on this instance.", () =>
      Promise.resolve([{ value: this.relays.size }]),
    );
    const subscriber = this.redis.duplicate({
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
    });
    subscriber.on("error", () => undefined);
    subscriber.on("message", (channel: string, sessionId: string) => {
      if (channel === SESSION_ENDED_CHANNEL) {
        this.relays.get(sessionId)?.close(STREAM_CLOSE_CODES.ended, "ended");
      }
    });
    subscriber.subscribe(SESSION_ENDED_CHANNEL).catch((error: unknown) => {
      logger.warn(`Not subscribed to session ends: ${error instanceof Error ? error.message : ""}`);
    });
    this.subscriber = subscriber;
  }

  onApplicationShutdown(): void {
    this.subscriber?.disconnect();
    this.subscriber = null;
  }

  /** A fresh connection on /browser/sessions/:id/stream. */
  handle(client: WebSocket, request: FastifyRequest): void {
    const { id } = request.params as { id: string };
    logger.debug(`Stream connection for session ${id} (state ${String(client.readyState)})`);
    if (!isAllowedOrigin(request.headers, this.config.allowedOrigins)) {
      client.close(STREAM_CLOSE_CODES.unauthorized, "origin");
      return;
    }
    const meta = requestMeta(request);
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
      void this.authenticate(client, id, data, meta, () => {
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
    meta: RequestMeta,
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
    const auth = { user: { id: claims.userId }, session: { id: claims.authSessionId } };

    const agent = new WebSocket(`ws://${access.agentAddress}/stream`, {
      headers: { authorization: `Bearer ${access.secret}` },
      handshakeTimeout: 5_000,
      maxPayload: 16 * 1024 * 1024,
    });
    agent.binaryType = "nodebuffer";

    const incoming = new Map<string, IncomingTransfer>();
    // Downloads are bounded in memory: a full buffer pauses the agent until Drive catches up.
    const pressure = new BackPressure(agent, () => {
      this.stats.transferPauses += 1;
      this.metrics.count(
        "brawzer_transfer_pauses_total",
        "Downloads that paused their agent while Drive caught up.",
      );
    });
    // History and open tabs, for profiles that keep them (ADR 0020).
    const observer = this.history.observe(id);
    let closed = false;
    const close = (code: number, reason: string) => {
      if (closed) return;
      closed = true;
      void observer.close();
      clearInterval(check);
      clearInterval(touch);
      if (this.relays.get(id) === relay) this.relays.delete(id);
      for (const transfer of incoming.values()) {
        transfer.body.destroy(new Error("The stream closed before the file arrived."));
      }
      incoming.clear();
      pressure.releaseAll();
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close(code, reason);
      }
      if (agent.readyState === WebSocket.OPEN || agent.readyState === WebSocket.CONNECTING) {
        agent.close(1000, reason);
      }
      void this.browser.touch(id).catch(() => undefined);
    };
    const relay = { authSessionId: claims.authSessionId, close };

    // Only one viewer per session: a new one replaces the old one.
    this.relays.get(id)?.close(STREAM_CLOSE_CODES.replaced, "replaced");
    this.relays.set(id, relay);

    const check = setInterval(() => {
      void this.browser.viewerState(id, claims.authSessionId).then((state) => {
        if (state === "locked") {
          close(STREAM_CLOSE_CODES.locked, "locked");
        } else if (state === "ended") {
          sendError(client, "ended", "This browser session has ended.");
          close(STREAM_CLOSE_CODES.ended, "ended");
        }
      });
    }, CHECK_INTERVAL_MS);
    const touch = setInterval(() => {
      void this.browser.touch(id).catch(() => undefined);
    }, TOUCH_INTERVAL_MS);
    void this.browser.touch(id).catch(() => undefined);

    const toPage = (message: object) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
    };
    // What the page sends before the agent answers waits here.
    const queued: string[] = [];
    const toAgent = (message: RelayMessage) => {
      const serialized = JSON.stringify(message);
      if (agent.readyState === WebSocket.OPEN) {
        agent.send(serialized);
      } else if (queued.length < MAX_QUEUED_MESSAGES) {
        queued.push(serialized);
      }
    };

    let bad = 0;
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
      if (parsed.data.type === "file-chooser") {
        void this.answerChooser(parsed.data, auth, meta, agent, toAgent);
        return;
      }
      if (parsed.data.type === "paste") {
        // Clipboard with intent: the act is recorded (how much), never the text.
        void this.securityEvents
          .record({
            type: "browser.clipboard_pasted",
            userId: auth.user.id,
            sessionId: auth.session.id,
            meta,
            metadata: { chars: parsed.data.text.length },
          })
          .catch(() => undefined);
      }
      toAgent(parsed.data);
    };
    for (const message of takeEarly()) onClientMessage(message.data, message.isBinary);
    client.on("message", onClientMessage);
    agent.on("open", () => {
      for (const message of queued.splice(0)) agent.send(message);
    });
    agent.on("message", (data: RawData, isBinary: boolean) => {
      if (!isBinary) {
        const text = rawText(data);
        let candidate: unknown;
        try {
          candidate = JSON.parse(text);
        } catch {
          candidate = undefined;
        }
        const message = agentMessageSchema.safeParse(candidate);
        if (!message.success) return;
        if (message.data.type === "welcome" || message.data.type === "tabs") {
          observer.tabs(message.data.tabs);
        }
        if (message.data.type === "welcome") {
          // A session continuing from saved tabs reopens them once, in their order.
          const activeTabId = message.data.activeTabId;
          void this.history
            .claimRestore(id)
            .then((urls) => {
              const [first, ...rest] = urls;
              if (!first) return;
              toAgent({ type: "navigate", tabId: activeTabId, url: first });
              for (const url of rest) toAgent({ type: "new-tab", url });
            })
            .catch(() => undefined);
        }
        if (message.data.type === "transfer" && message.data.state === "received") {
          this.receiveTransfer(message.data, incoming, auth, meta, toPage, pressure);
        }
        if (message.data.type === "clipboard" && message.data.text !== "") {
          void this.securityEvents
            .record({
              type: "browser.clipboard_copied",
              userId: auth.user.id,
              sessionId: auth.session.id,
              meta,
              metadata: { chars: message.data.text.length },
            })
            .catch(() => undefined);
        }
        toPage(message.data);
        return;
      }
      const bytes = rawBytes(data);
      if (binaryKind(bytes) === "transfer") {
        const chunk = decodeTransferChunk(bytes);
        const transfer = chunk ? incoming.get(chunk.header.transferId) : undefined;
        if (!chunk || !transfer) return;
        if (chunk.data.length > 0) {
          pressure.write(chunk.header.transferId, transfer.body, Buffer.from(chunk.data));
        }
        if (chunk.header.last) {
          transfer.body.end();
          incoming.delete(chunk.header.transferId);
          pressure.release(chunk.header.transferId);
        }
        return;
      }
      if (client.readyState !== WebSocket.OPEN) return;
      if (binaryKind(bytes) === "audio") {
        // Sound is live: a page that is behind loses some, and never waits for it.
        if (client.bufferedAmount <= MAX_BUFFERED_BYTES) client.send(bytes, { binary: true });
        return;
      }
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
        // The page is behind: drop the frame and acknowledge it in its place.
        this.metrics.count(
          "brawzer_frames_dropped_total",
          "Frames dropped because the page was behind.",
        );
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
      this.metrics.count("brawzer_frames_relayed_total", "Frames relayed to pages.");
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

  /**
   * The agent has a whole download or printed page: the chunks that follow
   * go into Drive as one upload. The page learns how it went.
   */
  private receiveTransfer(
    message: TransferMessage,
    incoming: Map<string, IncomingTransfer>,
    auth: { user: { id: string }; session: { id: string } },
    meta: RequestMeta,
    toPage: (message: object) => void,
    pressure: BackPressure,
  ): void {
    const body = new PassThrough({ highWaterMark: TRANSFER_BUFFER_BYTES });
    incoming.set(message.transferId, { message, body });
    void (async () => {
      try {
        const folderId = await this.drive.ensureFolder(auth.user.id, DOWNLOADS_FOLDER);
        const file = await this.drive.upload(
          auth,
          folderId,
          {
            filename: message.filename,
            stream: body,
            source: "browser",
            kind: message.kind,
          },
          meta,
        );
        this.metrics.count(
          "brawzer_transfers_total",
          "Downloads and printed pages, by kind and outcome.",
          {
            kind: message.kind,
            state: file.status === "infected" ? "quarantined" : "saved",
          },
        );
        toPage({
          ...message,
          state: file.status === "infected" ? "quarantined" : "saved",
          filename: file.name,
          bytes: file.size,
          fileId: file.id,
          ...(file.threat ? { reason: file.threat } : {}),
        });
      } catch (error) {
        incoming.delete(message.transferId);
        if (!body.destroyed) body.destroy();
        pressure.release(message.transferId);
        const refusal = error instanceof ApiException ? error : null;
        this.metrics.count(
          "brawzer_transfers_total",
          "Downloads and printed pages, by kind and outcome.",
          {
            kind: message.kind,
            state: refusal?.code === "payload_too_large" ? "too_large" : "failed",
          },
        );
        toPage({
          ...message,
          state: refusal?.code === "payload_too_large" ? "too_large" : "failed",
          reason: refusal?.message ?? "The file couldn’t be saved to Drive.",
        });
        if (!refusal) {
          logger.warn(
            `Saving a ${message.kind} from the cloud browser failed: ${error instanceof Error ? error.message : ""}`,
          );
        }
      }
    })();
  }

  /**
   * The page chose Drive files for a website's file chooser: tell the agent
   * what comes, then stream each file to it. Only clean files of the account
   * are opened; anything else is silently left out.
   */
  private async answerChooser(
    answer: Extract<ClientMessage, { type: "file-chooser" }>,
    auth: { user: { id: string }; session: { id: string } },
    meta: RequestMeta,
    agent: WebSocket,
    toAgent: (message: RelayMessage) => void,
  ): Promise<void> {
    let opened: OpenedFile[];
    try {
      opened = await this.drive.openForBrowser(auth.user.id, answer.fileIds);
    } catch (error) {
      logger.warn(
        `Opening Drive files for a page failed: ${error instanceof Error ? error.message : ""}`,
      );
      opened = [];
    }
    const files = opened.map((file) => ({
      transferId: randomUUID(),
      name: file.file.name,
      bytes: file.file.size,
    }));
    toAgent({ type: "file-chooser", tabId: answer.tabId, chooserId: answer.chooserId, files });
    if (files.length === 0) {
      for (const file of opened) file.body.destroy();
      return;
    }
    try {
      for (const [index, file] of opened.entries()) {
        const transferId = files[index]?.transferId ?? "";
        let seq = 0;
        for await (const piece of file.body as AsyncIterable<Buffer>) {
          for (let offset = 0; offset < piece.length; offset += TRANSFER_CHUNK_BYTES) {
            const data = piece.subarray(offset, offset + TRANSFER_CHUNK_BYTES);
            await sendBinary(
              agent,
              encodeTransferChunk({ transferId, seq: seq++, last: false }, data),
            );
          }
        }
        await sendBinary(
          agent,
          encodeTransferChunk({ transferId, seq, last: true }, new Uint8Array(0)),
        );
      }
      await this.securityEvents.record({
        type: "browser.file_sent",
        userId: auth.user.id,
        sessionId: auth.session.id,
        meta,
        metadata: { count: files.length },
      });
    } catch (error) {
      for (const file of opened) if (!file.body.destroyed) file.body.destroy();
      logger.warn(
        `Sending Drive files to a page failed: ${error instanceof Error ? error.message : ""}`,
      );
    }
  }

  /** How many sessions currently have a viewer. */
  get viewerCount(): number {
    return this.relays.size;
  }
}
