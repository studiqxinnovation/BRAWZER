import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { clientMessageSchema, STREAM_CLOSE_CODES } from "@brawzer/contracts";
import { WebSocket, WebSocketServer } from "ws";
import type { BrowserEngine, Viewer } from "./engine.ts";
import { log } from "./log.ts";

/** How much may queue on the viewer's socket before frames are dropped instead. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_BAD_MESSAGES = 20;

function rawText(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function authorized(header: string | undefined, secret: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The one way into the agent: a WebSocket at /stream that the relay opens
 * with the session's secret, plus /healthz for the orchestrator. One viewer
 * at a time; a new connection replaces the old one.
 */
export function createAgentServer(engine: BrowserEngine, secret: string): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      const ready = engine.isReady;
      res.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ready }));
      return;
    }
    res.writeHead(404).end();
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  let current: WebSocket | null = null;

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/stream" || !authorized(req.headers.authorization, secret)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
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
      };
      let attached = false;

      ws.on("message", (data, isBinary) => {
        if (isBinary) {
          ws.close(STREAM_CLOSE_CODES.badMessage, "text only");
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawText(data));
        } catch {
          parsed = undefined;
        }
        const message = clientMessageSchema.safeParse(parsed);
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
            engine.attachViewer(viewer, message.data.viewport);
          }
          return;
        }
        if (!attached) return;
        engine.handle(message.data).catch((error: unknown) => {
          log("warn", "command failed", {
            type: message.data.type,
            message: error instanceof Error ? error.message : "",
          });
        });
      });
      ws.on("close", () => {
        if (current === ws) current = null;
        if (attached) engine.detachViewer(viewer);
      });
      ws.on("error", () => undefined);
    });
  });

  /** Tells the viewer the session is over before the process exits. */
  Object.assign(server, {
    closeViewer: (code: number, reason: string) => {
      if (current?.readyState === WebSocket.OPEN) current.close(code, reason);
    },
  });
  return server;
}
