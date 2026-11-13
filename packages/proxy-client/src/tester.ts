import { performance } from "node:perf_hooks";
import { isIP } from "node:net";
import type { Duplex } from "node:stream";
import {
  type Destination,
  HEAD_END,
  type ProxyTarget,
  type ProxyTestOutcome,
  ProxyTunnel,
  read,
  type TunnelOptions,
  TunnelFailure,
  USER_AGENT,
} from "./tunnel.ts";

export interface ProxyTesterOptions extends TunnelOptions {
  /** Fixed destination: answers with the caller's IP address as plain text. */
  echoUrl: URL;
}

const RESPONSE_LIMIT = 4 * 1024;

/**
 * Tests a proxy the way ADR 0010 describes: connects through it (see
 * {@link ProxyTunnel}) and fetches a fixed echo URL with short timeouts and
 * size limits. Never throws: every outcome is a result.
 */
export class ProxyTester {
  private readonly tunnel: ProxyTunnel;

  constructor(private readonly options: ProxyTesterOptions) {
    this.tunnel = new ProxyTunnel(options);
  }

  async test(target: ProxyTarget): Promise<ProxyTestOutcome> {
    const deadline = AbortSignal.timeout(this.tunnel.timeoutMs);
    const opened: Duplex[] = [];
    let reachable = false;
    let authenticated: boolean | null = null;
    try {
      const started = performance.now();
      const url = this.options.echoUrl;
      const destination: Destination = {
        host: url.hostname,
        port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
      };
      let channel = await this.tunnel.open(target, destination, deadline, opened, {
        reachable: () => {
          reachable = true;
        },
        authenticated: () => {
          authenticated = true;
        },
      });
      if (url.protocol === "https:") {
        channel = await this.tunnel.secure(channel, url.hostname, deadline, opened);
      }
      const exitAddress = await echo(channel, url, deadline);
      return {
        ok: true,
        reachable,
        authenticated,
        latencyMs: Math.round(performance.now() - started),
        exitAddress,
        reason: null,
      };
    } catch (error) {
      const reason =
        error instanceof TunnelFailure
          ? error.reason
          : deadline.aborted
            ? "timeout"
            : "connection_failed";
      return {
        ok: false,
        reachable,
        authenticated: reason === "auth_failed" ? false : authenticated,
        latencyMs: null,
        exitAddress: null,
        reason,
      };
    } finally {
      for (const stream of opened) stream.destroy();
    }
  }
}

function decodeChunked(body: Buffer): Buffer | null {
  const parts: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const lineEnd = body.indexOf("\r\n", offset);
    if (lineEnd === -1) return null;
    const size = Number.parseInt(body.subarray(offset, lineEnd).toString("latin1"), 16);
    if (!Number.isFinite(size) || size < 0) return null;
    if (size === 0) return Buffer.concat(parts);
    const start = lineEnd + 2;
    parts.push(body.subarray(start, start + size));
    offset = start + size + 2;
  }
}

/** Fetches the echo URL through the tunnel and returns the address it reports. */
async function echo(stream: Duplex, url: URL, deadline: AbortSignal): Promise<string> {
  stream.write(
    `GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\nUser-Agent: ${USER_AGENT}\r\nAccept: text/plain\r\nConnection: close\r\n\r\n`,
  );
  const complete = (data: Buffer) => {
    const end = data.indexOf(HEAD_END);
    if (end === -1) return false;
    const head = data.subarray(0, end).toString("latin1");
    const length = /\r\ncontent-length:\s*(\d+)/i.exec(head)?.[1];
    return length !== undefined && data.length - end - HEAD_END.length >= Number(length);
  };
  const data = await read(stream, complete, RESPONSE_LIMIT, "invalid_response", deadline);
  const end = data.indexOf(HEAD_END);
  if (end === -1) throw new TunnelFailure("invalid_response");
  const head = data.subarray(0, end).toString("latin1");
  if (!/^HTTP\/1\.[01] 200/.test(head)) throw new TunnelFailure("invalid_response");
  let body: Buffer | null = data.subarray(end + HEAD_END.length);
  if (/\r\ntransfer-encoding:\s*chunked/i.test(head)) body = decodeChunked(body);
  const address = body?.toString("utf8").trim() ?? "";
  if (isIP(address) === 0) throw new TunnelFailure("invalid_response");
  return address;
}
