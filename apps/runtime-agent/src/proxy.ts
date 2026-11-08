import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import { isObviouslyLocal, isPublicAddress, parseHost } from "@brawzer/net-policy";

/**
 * The only way out of the container for the pages in the cloud browser.
 * Chromium is forced through it (policy and flag), so every connection is
 * checked against ADR 0010's address rules: names are resolved here and the
 * connection goes to the checked address, never to a name that could be
 * re-resolved to something private (DNS rebinding).
 */
/** Development only: a name served by a local site instead of the internet. */
export interface ProxyOverride {
  host: string;
  /** Where plain connections go. */
  port: number;
  /** Where connections to port 443 (CONNECT tunnels) go, if the site speaks TLS. */
  tlsPort?: number;
}

export interface ProxyOptions {
  /** Every address a name resolves to; the default asks the system resolver. */
  resolve?: (name: string) => Promise<string[]>;
  /** Development only: names served by a local test site instead of the internet. */
  overrides?: ReadonlyMap<string, ProxyOverride>;
  /** Called with the refused `host:port` (no path or query) and why, here or in the egress. */
  onRefused?: (host: string, reason: RefusalReason) => void;
  /**
   * The session's egress proxy (`host:port`, ADR 0014). With it set, every
   * connection that isn't an override is forwarded there unresolved: the
   * egress decides and connects, and names never meet this container's
   * resolver. The local checks stay as a first, cheap refusal.
   */
  egress?: { host: string; port: number } | undefined;
}

/** Why a connection was refused: this proxy's own checks, or the egress's (ADR 0014). */
export type RefusalReason = "address" | "unresolved" | "port" | "engine";

export type Decision =
  | { address: string; port: number }
  | { egress: true; host: string; port: number }
  | { refused: "address" | "unresolved" };

function isRefusalReason(value: string): value is RefusalReason {
  return value === "address" || value === "unresolved" || value === "port" || value === "engine";
}

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

async function defaultResolve(name: string): Promise<string[]> {
  const results = await dns.lookup(name, { all: true, order: "verbatim" });
  return results.map((result) => result.address);
}

/** Where a connection to `host:port` may go, if anywhere. */
export async function decide(
  host: string,
  port: number,
  options: ProxyOptions = {},
): Promise<Decision> {
  const override = options.overrides?.get(host.toLowerCase());
  if (override) {
    const target = port === 443 ? (override.tlsPort ?? override.port) : override.port;
    return { address: override.host, port: target };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return { refused: "address" };
  const parsed = parseHost(host);
  if (!parsed) return { refused: "address" };
  if (parsed.kind === "ip") {
    if (!isPublicAddress(parsed.address)) return { refused: "address" };
    return options.egress
      ? { egress: true, host: parsed.address, port }
      : { address: parsed.address, port };
  }
  if (isObviouslyLocal(parsed)) return { refused: "address" };
  if (options.egress) return { egress: true, host: parsed.name, port };
  let addresses: string[];
  try {
    addresses = await (options.resolve ?? defaultResolve)(parsed.name);
  } catch {
    return { refused: "unresolved" };
  }
  if (addresses.length === 0) return { refused: "unresolved" };
  // A name that resolves to anything private is treated as hostile as a whole.
  if (!addresses.every(isPublicAddress)) return { refused: "address" };
  return { address: addresses[0] ?? "", port };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

/** Shown instead of a private or local page. No scripts, no outside resources. */
export function blockedPage(host: string, reason: Decision & { refused: string }): string {
  const detail =
    reason.refused === "unresolved"
      ? `${escapeHtml(host)} couldn’t be found.`
      : `${escapeHtml(host)} is a private or local address, which the cloud browser never opens.`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Blocked by Brawzer</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f6f5f2;color:#1c1b19}
main{max-width:28rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#5c5a55}</style>
</head><body><main><h1>Blocked by Brawzer</h1><p>${detail}</p></main></body></html>`;
}

function sendBlocked(res: http.ServerResponse, host: string, decision: Decision): void {
  if (!("refused" in decision)) return;
  res.writeHead(403, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'none'",
    "cache-control": "no-store",
  });
  res.end(blockedPage(host, decision));
}

function forwardHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name) && value !== undefined) out[name] = value;
  }
  return out;
}

/** Parses the `host:port` target of a CONNECT request (IPv6 in brackets). */
export function parseConnectTarget(target: string): { host: string; port: number } | null {
  const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(target);
  if (!match) return null;
  return { host: match[1] ?? "", port: Number(match[2]) };
}

export function createFilteringProxy(options: ProxyOptions = {}): http.Server {
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
      const decision = await decide(url.hostname, port, options);
      if (process.env.BRAWZER_AGENT_DEBUG === "true") {
        process.stdout.write(`${JSON.stringify({ proxy: "request", host: url.host, decision })}\n`);
      }
      if ("refused" in decision) {
        options.onRefused?.(url.host, decision.refused);
        sendBlocked(res, url.host, decision);
        return;
      }
      const upstream = http.request(
        "egress" in decision
          ? {
              host: options.egress?.host,
              port: options.egress?.port,
              method: req.method,
              path: url.href,
              headers: { ...forwardHeaders(req.headers), host: url.host },
              setHost: false,
              timeout: 30_000,
            }
          : {
              host: decision.address,
              port: decision.port,
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
      upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end("The site didn’t answer.");
      });
      req.pipe(upstream);
    })();
  });

  server.on("connect", (req, clientSocket, head) => {
    void (async () => {
      const target = parseConnectTarget(req.url ?? "");
      const host = target?.host.replace(/^\[|\]$/g, "") ?? "";
      const decision = target
        ? await decide(host, target.port, options)
        : { refused: "address" as const };
      if (process.env.BRAWZER_AGENT_DEBUG === "true") {
        process.stdout.write(
          `${JSON.stringify({ proxy: "connect", target: req.url, decision })}\n`,
        );
      }
      if ("refused" in decision) {
        options.onRefused?.(req.url ?? "", decision.refused);
        clientSocket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      const viaEgress = "egress" in decision;
      const upstream = viaEgress
        ? net.connect(options.egress?.port ?? 0, options.egress?.host ?? "127.0.0.1")
        : net.connect(decision.port, decision.address);
      upstream.setNoDelay(true);
      upstream.once("connect", () => {
        if (!viaEgress) {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length > 0) upstream.write(head);
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
          return;
        }
        // The egress answers the CONNECT itself (200 or a refusal), so its reply
        // goes straight through; a refusal's reason is noted on the way.
        const authority = `${net.isIPv6(decision.host) ? `[${decision.host}]` : decision.host}:${String(decision.port)}`;
        upstream.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
        if (head.length > 0) upstream.write(head);
        upstream.once("data", (first: Buffer) => {
          const reply = first.subarray(0, 512).toString("latin1");
          const refused = /^HTTP\/1\.[01] 403[^]*?x-brawzer-refused:\s*(\w+)/i.exec(reply)?.[1];
          if (refused && isRefusalReason(refused)) options.onRefused?.(req.url ?? "", refused);
          clientSocket.write(first);
          upstream.pipe(clientSocket);
        });
        clientSocket.pipe(upstream);
      });
      upstream.on("error", () => {
        if (clientSocket.writable) {
          clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
        }
      });
      clientSocket.on("error", () => upstream.destroy());
      clientSocket.on("close", () => upstream.destroy());
    })();
  });

  // Keep idle browser connections from piling up.
  server.keepAliveTimeout = 15_000;
  server.headersTimeout = 20_000;
  return server;
}
