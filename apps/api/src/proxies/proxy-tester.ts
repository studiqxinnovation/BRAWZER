import { lookup as dnsLookup } from "node:dns/promises";
import { connect as netConnect, isIP, isIPv4, type LookupFunction, type Socket } from "node:net";
import { performance } from "node:perf_hooks";
import type { Duplex } from "node:stream";
import { type ConnectionOptions, connect as tlsConnect } from "node:tls";
import type { ProxyProtocol, ProxyTestReason } from "@brawzer/contracts";
import { SocksClient } from "socks";
import { isPublicAddress, parseHost } from "@brawzer/net-policy";

export type Lookup = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

export interface ProxyTarget {
  protocol: ProxyProtocol;
  host: string;
  port: number;
  credentials: { username: string; password: string } | null;
}

export interface ProxyTestOutcome {
  ok: boolean;
  reachable: boolean;
  authenticated: boolean | null;
  latencyMs: number | null;
  exitAddress: string | null;
  reason: ProxyTestReason | null;
}

export interface ProxyTesterOptions {
  /** Fixed destination: answers with the caller's IP address as plain text. */
  echoUrl: URL;
  /** Development and tests only: allow private and local proxy addresses. */
  allowPrivate: boolean;
  lookup?: Lookup;
  /** For the whole test. */
  timeoutMs?: number;
  /** Extra TLS settings, such as a test certificate authority. */
  tls?: Pick<ConnectionOptions, "ca">;
  /** Opens the TCP connection to an already-checked address (replaceable in tests). */
  connect?: (address: string, port: number) => Socket;
}

const HEADER_LIMIT = 8 * 1024;
const RESPONSE_LIMIT = 4 * 1024;
const USER_AGENT = "Brawzer-proxy-test";

class TestFailure extends Error {
  constructor(readonly reason: ProxyTestReason) {
    super(reason);
  }
}

/** Every connection is to an IP address Brawzer already checked: never let one resolve a name. */
const refuseLookup: LookupFunction = (_hostname, _options, callback) => {
  callback(new Error("Name lookups are not allowed here"), "", 4);
};

const defaultConnect = (address: string, port: number): Socket =>
  netConnect({ host: address, port, lookup: refuseLookup, noDelay: true });

const defaultLookup: Lookup = (hostname) => dnsLookup(hostname, { all: true, order: "verbatim" });

function connectFailure(error: NodeJS.ErrnoException): TestFailure {
  if (error.code === "ECONNREFUSED") return new TestFailure("connection_refused");
  if (error.code === "ETIMEDOUT") return new TestFailure("timeout");
  return new TestFailure("connection_failed");
}

/**
 * Tests a proxy the way ADR 0010 describes: resolve the host once, refuse
 * anything that isn't a public address (every answer, not just the first),
 * connect to that exact address, then fetch a fixed echo URL through the
 * proxy with short timeouts and size limits. Never throws: every outcome is
 * a result.
 */
export class ProxyTester {
  private readonly lookup: Lookup;
  private readonly timeoutMs: number;

  constructor(private readonly options: ProxyTesterOptions) {
    this.lookup = options.lookup ?? defaultLookup;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async test(target: ProxyTarget): Promise<ProxyTestOutcome> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const opened: Duplex[] = [];
    let reachable = false;
    let authenticated: boolean | null = null;
    try {
      const address = await this.resolve(target.host, deadline);
      const started = performance.now();
      let channel: Duplex = await this.connect(address, target.port, deadline, opened);
      reachable = true;
      if (target.protocol === "https") {
        channel = await this.secure(channel, target.host, deadline, opened);
      }
      const destination = await this.destination(target.protocol, deadline);
      channel =
        target.protocol === "http" || target.protocol === "https"
          ? await httpConnect(channel, destination, target.credentials, deadline)
          : await this.socksConnect(channel as Socket, target, destination, deadline);
      authenticated = true;
      if (this.options.echoUrl.protocol === "https:") {
        channel = await this.secure(channel, this.options.echoUrl.hostname, deadline, opened);
      }
      const exitAddress = await echo(channel, this.options.echoUrl, deadline);
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
        error instanceof TestFailure
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

  /** One lookup; the address it returns is the one used. */
  private async resolve(host: string, deadline: AbortSignal): Promise<string> {
    const parsed = parseHost(host);
    if (!parsed) throw new TestFailure("invalid_host");
    let address: string;
    if (parsed.kind === "ip") {
      address = parsed.address;
    } else {
      let answers: readonly { address: string }[];
      try {
        answers = await withDeadline(this.lookup(parsed.name), deadline);
      } catch (error) {
        if (error instanceof TestFailure) throw error;
        throw new TestFailure("dns_failed");
      }
      const first = answers[0];
      if (!first) throw new TestFailure("dns_failed");
      // A name that also points somewhere private is refused outright.
      if (
        !this.options.allowPrivate &&
        answers.some((answer) => !isPublicAddress(answer.address))
      ) {
        throw new TestFailure("blocked_address");
      }
      address = first.address;
    }
    if (!this.options.allowPrivate && !isPublicAddress(address)) {
      throw new TestFailure("blocked_address");
    }
    return address;
  }

  private connect(
    address: string,
    port: number,
    deadline: AbortSignal,
    opened: Duplex[],
  ): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = (this.options.connect ?? defaultConnect)(address, port);
      opened.push(socket);
      const onAbort = () => {
        reject(new TestFailure("timeout"));
      };
      deadline.addEventListener("abort", onAbort, { once: true });
      socket.once("connect", () => {
        deadline.removeEventListener("abort", onAbort);
        socket.removeAllListeners("error");
        resolve(socket);
      });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        deadline.removeEventListener("abort", onAbort);
        reject(connectFailure(error));
      });
    });
  }

  /** TLS over an existing stream, verifying the certificate for `host`. */
  private secure(
    stream: Duplex,
    host: string,
    deadline: AbortSignal,
    opened: Duplex[],
  ): Promise<Duplex> {
    const parsed = parseHost(host);
    const name = parsed?.kind === "name" ? parsed.name : undefined;
    return withDeadline(
      new Promise((resolve, reject) => {
        const secured = tlsConnect({
          socket: stream,
          host: parsed?.kind === "ip" ? parsed.address : (name ?? host),
          // SNI takes names only.
          ...(name ? { servername: name } : {}),
          ALPNProtocols: ["http/1.1"],
          ...this.options.tls,
        });
        opened.push(secured);
        secured.once("secureConnect", () => {
          secured.removeAllListeners("error");
          resolve(secured);
        });
        secured.once("error", () => {
          reject(new TestFailure("tls_failed"));
        });
      }),
      deadline,
    );
  }

  /** Where the tunnel goes. SOCKS4 can only carry an IPv4 address, so that one is resolved here. */
  private async destination(
    protocol: ProxyProtocol,
    deadline: AbortSignal,
  ): Promise<{ host: string; port: number }> {
    const url = this.options.echoUrl;
    const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (protocol !== "socks4" || isIPv4(host)) return { host, port };
    const answers = await withDeadline(this.lookup(host), deadline).catch(() => []);
    const ipv4 = answers.find((answer) => isIPv4(answer.address));
    if (!ipv4) throw new TestFailure("destination_failed");
    return { host: ipv4.address, port };
  }

  private async socksConnect(
    socket: Socket,
    target: ProxyTarget,
    destination: { host: string; port: number },
    deadline: AbortSignal,
  ): Promise<Duplex> {
    try {
      const { socket: tunnel } = await withDeadline(
        SocksClient.createConnection({
          proxy: {
            host: socket.remoteAddress ?? "0.0.0.0",
            port: target.port,
            type: target.protocol === "socks5" ? 5 : 4,
            ...(target.credentials
              ? {
                  userId: target.credentials.username,
                  ...(target.protocol === "socks5"
                    ? { password: target.credentials.password }
                    : {}),
                }
              : {}),
          },
          destination,
          command: "connect",
          existing_socket: socket,
          timeout: this.timeoutMs,
        }),
        deadline,
      );
      return tunnel;
    } catch (error) {
      if (error instanceof TestFailure) throw error;
      const message = error instanceof Error ? error.message : "";
      if (/authentication/i.test(message)) throw new TestFailure("auth_failed");
      if (/rejected/i.test(message)) throw new TestFailure("destination_failed");
      if (/timed out/i.test(message)) throw new TestFailure("timeout");
      throw new TestFailure("proxy_error");
    }
  }
}

function withDeadline<T>(promise: Promise<T>, deadline: AbortSignal): Promise<T> {
  if (deadline.aborted) return Promise.reject(new TestFailure("timeout"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new TestFailure("timeout"));
    };
    deadline.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        deadline.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        deadline.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Reads from `stream` until `done` says it has enough, the stream ends, or
 * `limit` bytes arrive (which fails with `overflow`).
 */
function read(
  stream: Duplex,
  done: (data: Buffer) => boolean,
  limit: number,
  overflow: ProxyTestReason,
  deadline: AbortSignal,
): Promise<Buffer> {
  return withDeadline(
    new Promise<Buffer>((resolve, reject) => {
      let data = Buffer.alloc(0);
      const cleanup = () => {
        stream.off("data", onData);
        stream.off("end", onEnd);
        stream.off("error", onError);
      };
      const onData = (chunk: Buffer) => {
        data = Buffer.concat([data, chunk]);
        if (data.length > limit) {
          cleanup();
          reject(new TestFailure(overflow));
        } else if (done(data)) {
          cleanup();
          stream.pause();
          resolve(data);
        }
      };
      const onEnd = () => {
        cleanup();
        resolve(data);
      };
      const onError = () => {
        cleanup();
        reject(new TestFailure("connection_failed"));
      };
      stream.on("data", onData);
      stream.once("end", onEnd);
      stream.once("error", onError);
      stream.resume();
    }),
    deadline,
  );
}

const HEAD_END = Buffer.from("\r\n\r\n");

async function httpConnect(
  stream: Duplex,
  destination: { host: string; port: number },
  credentials: ProxyTarget["credentials"],
  deadline: AbortSignal,
): Promise<Duplex> {
  const authority = `${isIP(destination.host) === 6 ? `[${destination.host}]` : destination.host}:${String(destination.port)}`;
  const lines = [
    `CONNECT ${authority} HTTP/1.1`,
    `Host: ${authority}`,
    `User-Agent: ${USER_AGENT}`,
  ];
  if (credentials) {
    const token = Buffer.from(`${credentials.username}:${credentials.password}`, "utf8").toString(
      "base64",
    );
    lines.push(`Proxy-Authorization: Basic ${token}`);
  }
  stream.write(`${lines.join("\r\n")}\r\n\r\n`);

  const data = await read(
    stream,
    (buffer) => buffer.includes(HEAD_END),
    HEADER_LIMIT,
    "proxy_error",
    deadline,
  );
  const end = data.indexOf(HEAD_END);
  if (end === -1) throw new TestFailure("proxy_error");
  const status = /^HTTP\/1\.[01] (\d{3})/.exec(data.subarray(0, end).toString("latin1"))?.[1];
  if (!status) throw new TestFailure("proxy_error");
  if (status === "407") throw new TestFailure("auth_failed");
  if (status === "502" || status === "503" || status === "504") {
    throw new TestFailure("destination_failed");
  }
  if (!status.startsWith("2")) throw new TestFailure("proxy_error");
  // Anything after the head already belongs to the tunnel.
  const rest = data.subarray(end + HEAD_END.length);
  if (rest.length > 0) stream.unshift(rest);
  return stream;
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
  if (end === -1) throw new TestFailure("invalid_response");
  const head = data.subarray(0, end).toString("latin1");
  if (!/^HTTP\/1\.[01] 200/.test(head)) throw new TestFailure("invalid_response");
  let body: Buffer | null = data.subarray(end + HEAD_END.length);
  if (/\r\ntransfer-encoding:\s*chunked/i.test(head)) body = decodeChunked(body);
  const address = body?.toString("utf8").trim() ?? "";
  if (isIP(address) === 0) throw new TestFailure("invalid_response");
  return address;
}
