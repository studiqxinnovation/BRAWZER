import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { defaultLookup, type ProxyTarget, ProxyTunnel, TunnelFailure } from "@brawzer/proxy-client";
import { log } from "./log.ts";
import { decideEgress, type EgressDecision } from "./rules.ts";

const HOP_BY_HOP = new Set([
  "proxy-connection",
  "proxy-authorization",
  "proxy-authenticate",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
]);

export interface EgressProxyOptions {
  /** The profile's saved proxy, or null for direct connections. */
  upstream: ProxyTarget | null;
  allowPrivate: boolean;
  /** The profile's choice: private addresses go to the proxy instead of being refused. */
  privateViaUpstream?: boolean;
  /** Development only: loopback targets are reached under this name. */
  loopbackHost: string | null;
  lookup?: (name: string) => Promise<readonly { address: string; family: number }[]>;
  onRefused?: (target: string, reason: string) => void;
}

/** Rewrites a loopback target for development, where test proxies run on the host's loopback. */
export function rewriteLoopback(target: ProxyTarget, loopbackHost: string | null): ProxyTarget {
  if (!loopbackHost) return target;
  const host = target.host.replace(/^\[|\]$/g, "");
  if (host === "127.0.0.1" || host === "::1" || host === "localhost") {
    return { ...target, host: loopbackHost };
  }
  return target;
}

function forwardHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name) && value !== undefined) out[name] = value;
  }
  return out;
}

export function parseConnectTarget(target: string): { host: string; port: number } | null {
  const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(target);
  if (!match) return null;
  return { host: (match[1] ?? "").replace(/^\[|\]$/g, ""), port: Number(match[2]) };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

function blockedPage(target: string, reason: string): string {
  const detail =
    reason === "unresolved"
      ? `${escapeHtml(target)} couldn’t be found.`
      : reason === "port"
        ? `${escapeHtml(target)} uses a port the cloud browser doesn’t open.`
        : reason === "engine"
          ? "This is one of the engine’s own background services, which the cloud browser doesn’t contact."
          : `${escapeHtml(target)} is a private or local address, which the cloud browser never opens.`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Blocked by Brawzer</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f6f5f2;color:#1c1b19}
main{max-width:28rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#5c5a55}</style>
</head><body><main><h1>Blocked by Brawzer</h1><p>${detail}</p></main></body></html>`;
}

/**
 * The egress proxy of one session: an HTTP proxy on the container's loopback
 * that the runtime's own proxy forwards to. Every connection is decided by
 * the egress rules, then made directly to a checked public address or
 * through the profile's saved proxy, whose credentials live only here.
 */
export function createEgressProxy(options: EgressProxyOptions): http.Server {
  const lookup = options.lookup ?? defaultLookup;
  const upstream = options.upstream
    ? rewriteLoopback(options.upstream, options.loopbackHost)
    : null;
  const tunnel = upstream
    ? new ProxyTunnel({ allowPrivate: options.allowPrivate, lookup, timeoutMs: 20_000 })
    : null;
  const rules = {
    hasUpstream: upstream !== null,
    allowPrivate: options.allowPrivate,
    privateViaUpstream: options.privateViaUpstream === true,
    lookup,
  };

  /** A stream to the destination, however it is reached. */
  async function openChannel(decision: EgressDecision): Promise<Duplex> {
    if (decision.kind === "refused") throw new Error(decision.reason);
    if (decision.kind === "direct") {
      return new Promise((resolve, reject) => {
        const socket = net.connect({ host: decision.address, port: decision.port, noDelay: true });
        socket.once("connect", () => {
          socket.removeListener("error", reject);
          resolve(socket);
        });
        socket.once("error", reject);
      });
    }
    if (!tunnel || !upstream) throw new Error("no upstream");
    const opened: Duplex[] = [];
    try {
      return await tunnel.open(
        upstream,
        { host: decision.host, port: decision.port },
        AbortSignal.timeout(tunnel.timeoutMs),
        opened,
      );
    } catch (error) {
      for (const stream of opened) stream.destroy();
      throw error;
    }
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      let url: URL;
      try {
        url = new URL(req.url ?? "");
      } catch {
        res.writeHead(400, { "content-type": "text/plain" }).end("Proxy requests only");
        return;
      }
      if (url.protocol !== "http:") {
        res.writeHead(400, { "content-type": "text/plain" }).end("Unsupported scheme");
        return;
      }
      const port = url.port ? Number(url.port) : 80;
      const decision = await decideEgress(url.hostname, port, rules);
      if (decision.kind === "refused") {
        options.onRefused?.(url.host, decision.reason);
        res.writeHead(403, {
          "content-type": "text/html; charset=utf-8",
          // The runtime reads why, to explain a failed page in its own words.
          "x-brawzer-refused": decision.reason,
          "content-security-policy": "default-src 'none'",
          "cache-control": "no-store",
        });
        res.end(blockedPage(url.host, decision.reason));
        return;
      }
      let channel: Duplex;
      try {
        channel = await openChannel(decision);
      } catch (error) {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(
          error instanceof TunnelFailure && error.reason === "auth_failed"
            ? "The proxy refused Brawzer’s credentials."
            : "The site didn’t answer.",
        );
        return;
      }
      const forwarded = http.request(
        {
          createConnection: () => channel,
          method: req.method,
          path: `${url.pathname}${url.search}`,
          headers: { ...forwardHeaders(req.headers), host: url.host },
          setHost: false,
          timeout: 30_000,
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, forwardHeaders(response.headers));
          response.pipe(res);
        },
      );
      forwarded.on("timeout", () => forwarded.destroy(new Error("timeout")));
      forwarded.on("error", () => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end("The site didn’t answer.");
      });
      req.pipe(forwarded);
    })();
  });

  server.on("connect", (req, clientSocket, head) => {
    void (async () => {
      const target = parseConnectTarget(req.url ?? "");
      const decision = target
        ? await decideEgress(target.host, target.port, rules)
        : ({ kind: "refused", reason: "address" } as const);
      if (decision.kind === "refused") {
        options.onRefused?.(req.url ?? "", decision.reason);
        clientSocket.end(
          `HTTP/1.1 403 Forbidden\r\nX-Brawzer-Refused: ${decision.reason}\r\nConnection: close\r\n\r\n`,
        );
        return;
      }
      let channel: Duplex;
      try {
        channel = await openChannel(decision);
      } catch {
        if (clientSocket.writable) {
          clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
        }
        return;
      }
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) channel.write(head);
      channel.pipe(clientSocket);
      clientSocket.pipe(channel);
      channel.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => channel.destroy());
      clientSocket.on("close", () => channel.destroy());
      channel.on("close", () => clientSocket.destroy());
    })();
  });

  server.keepAliveTimeout = 15_000;
  server.headersTimeout = 20_000;
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });
  log("info", "egress proxy", { upstream: upstream ? upstream.protocol : "direct" });
  return server;
}
