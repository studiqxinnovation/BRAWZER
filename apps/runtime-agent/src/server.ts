import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { Readable } from "node:stream";
import {
  binaryKind,
  decodeTransferChunk,
  relayMessageSchema,
  STREAM_CLOSE_CODES,
} from "@brawzer/contracts";
import { WebSocket, WebSocketServer } from "ws";
import type { Engine, Viewer } from "./engine-types.ts";
import { type AudioSink, type SessionAudio } from "./audio.ts";
import { log } from "./log.ts";
import { startScale } from "./video.ts";

/** How much may queue on the viewer's socket before frames are dropped instead. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_MESSAGE_BYTES = 64 * 1024;
/** Transfer chunks: the chunk itself plus its header. */
const MAX_MESSAGE_BYTES = 512 * 1024;
const MAX_BAD_MESSAGES = 20;
/** The start request's body: `{ "scale": 2 }` and nothing more. */
const MAX_START_BODY_BYTES = 256;

function rawText(data: Buffer | ArrayBuffer | Buffer[]): string {
  return rawBytes(data).toString("utf8");
}

function rawBytes(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function authorized(header: string | undefined, secret: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type AgentState = "waiting" | "starting" | "running" | "stopped";

/** What the HTTP routes drive: the engine's life and the profile data around it. */
export interface AgentLifecycle {
  state(): AgentState;
  engine(): Engine | null;
  /** Unpacks a profile archive before the engine starts. */
  restore(archive: Readable): Promise<void>;
  /** Starts the engine, drawing at this pixel ratio; resolves once it is ready. */
  start(scale: number): Promise<void>;
  /** Stops the engine cleanly and streams the profile archive. */
  pack(): Promise<Readable>;
}

export interface AgentServer extends http.Server {
  closeViewer(code: number, reason: string): void;
}

function json(res: http.ServerResponse, status: number, body: object): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * The ways into the agent, all on one port reachable only from the host's
 * loopback: /healthz for the orchestrator, and, with the session's secret,
 * the stream WebSocket at /stream plus the profile routes (PUT /profile
 * before the engine starts, POST /start, POST /pack at the end). One viewer
 * at a time; a new connection replaces the old one.
 */
export function createAgentServer(
  lifecycle: AgentLifecycle,
  secret: string,
  audio?: SessionAudio,
): AgentServer {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      const engine = lifecycle.engine();
      json(res, 200, { state: lifecycle.state(), ready: engine?.isReady ?? false });
      return;
    }
    if (!authorized(req.headers.authorization, secret)) {
      res.writeHead(401).end();
      return;
    }
    if (req.method === "PUT" && req.url === "/profile") {
      if (lifecycle.state() !== "waiting") {
        json(res, 409, { error: "The engine has already started." });
        return;
      }
      lifecycle.restore(req).then(
        () => json(res, 204, {}),
        (error: unknown) => {
          log("warn", "profile restore failed", {
            message: error instanceof Error ? error.message : "",
          });
          json(res, 422, { error: "The profile data couldn’t be unpacked." });
        },
      );
      return;
    }
    if (req.method === "POST" && req.url === "/start") {
      if (lifecycle.state() !== "waiting") {
        json(res, 409, { error: `The engine is ${lifecycle.state()}.` });
        return;
      }
      // The body says the pixel ratio to draw at: a few bytes, or it is ignored.
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        if (body.length <= MAX_START_BODY_BYTES) body += chunk;
      });
      req.on("error", () => res.destroy());
      req.on("end", () => {
        if (lifecycle.state() !== "waiting") {
          json(res, 409, { error: `The engine is ${lifecycle.state()}.` });
          return;
        }
        const scale = body.length <= MAX_START_BODY_BYTES ? startScale(body) : 1;
        lifecycle.start(scale).then(
          () => json(res, 200, { state: lifecycle.state() }),
          (error: unknown) => {
            json(res, 500, { error: error instanceof Error ? error.message : "start failed" });
          },
        );
      });
      return;
    }
    if (req.method === "POST" && req.url === "/pack") {
      closeViewer(STREAM_CLOSE_CODES.ended, "ended");
      lifecycle.pack().then(
        (archive) => {
          res.writeHead(200, { "content-type": "application/gzip" });
          archive.pipe(res);
          archive.on("error", () => res.destroy());
        },
        (error: unknown) => {
          json(res, 500, { error: error instanceof Error ? error.message : "pack failed" });
        },
      );
      return;
    }
    res.writeHead(404).end();
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  let current: WebSocket | null = null;

  const closeViewer = (code: number, reason: string) => {
    if (current?.readyState === WebSocket.OPEN) current.close(code, reason);
  };

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/stream" || !authorized(req.headers.authorization, secret)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const engine = lifecycle.engine();
    if (!engine) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      if (current?.readyState === WebSocket.OPEN) {
        current.send(
          JSON.stringify({ type: "error", code: "replaced", message: "Opened elsewhere." }),
        );
        current.close(STREAM_CLOSE_CODES.replaced, "replaced");
      }
      current = ws;
      let bad = 0;
      const viewer: Viewer = {
        send: (message) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
        },
        sendFrame: (frame) => {
          if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED_BYTES) {
            return false;
          }
          ws.send(frame, { binary: true });
          return true;
        },
        sendVideo: (chunk) => {
          if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED_BYTES) {
            return false;
          }
          ws.send(chunk, { binary: true });
          return true;
        },
        sendBinary: (bytes) =>
          new Promise<void>((resolve, reject) => {
            if (ws.readyState !== WebSocket.OPEN) {
              reject(new Error("viewer gone"));
              return;
            }
            ws.send(bytes, { binary: true }, (error) => {
              if (error) reject(error);
              else resolve();
            });
          }),
      };
      let attached = false;
      const audioSink: AudioSink = {
        sendAudio: (bytes) => {
          if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED_BYTES) {
            return false;
          }
          ws.send(bytes, { binary: true });
          return true;
        },
      };

      ws.on("message", (data, isBinary) => {
        if (isBinary) {
          const bytes = rawBytes(data);
          const chunk = binaryKind(bytes) === "transfer" ? decodeTransferChunk(bytes) : null;
          if (!chunk || !attached) {
            ws.close(STREAM_CLOSE_CODES.badMessage, "bad binary message");
            return;
          }
          void engine.receiveChunk(chunk.header, chunk.data);
          return;
        }
        const text = rawText(data);
        if (text.length > MAX_TEXT_MESSAGE_BYTES) {
          ws.close(STREAM_CLOSE_CODES.badMessage, "too large");
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
        const message = relayMessageSchema.safeParse(parsed);
        if (!message.success) {
          if (++bad > MAX_BAD_MESSAGES) ws.close(STREAM_CLOSE_CODES.badMessage, "bad messages");
          return;
        }
        if (message.data.type === "ping") {
          viewer.send({ type: "pong" });
          return;
        }
        if (message.data.type === "hello") {
          if (!attached) {
            attached = true;
            engine.attachViewer(
              viewer,
              message.data.viewport,
              message.data.codecs,
              message.data.repeats,
            );
            audio?.attach(audioSink);
          }
          return;
        }
        if (!attached) return;
        if (message.data.type === "sound") {
          audio?.setOn(message.data.on);
          return;
        }
        engine.handle(message.data).catch((error: unknown) => {
          log("warn", "command failed", {
            type: message.data.type,
            message: error instanceof Error ? error.message : "",
          });
        });
      });
      ws.on("close", () => {
        if (current === ws) current = null;
        if (attached) {
          engine.detachViewer(viewer);
          audio?.detach(audioSink);
        }
      });
      ws.on("error", () => undefined);
    });
  });

  return Object.assign(server, { closeViewer });
}
