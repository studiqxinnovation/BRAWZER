import { lookup as dnsLookup } from "node:dns/promises";
import { connect as netConnect, isIP, isIPv4, type LookupFunction, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { type ConnectionOptions, connect as tlsConnect } from "node:tls";
import type { ProxyProtocol, ProxyTestReason } from "@brawzer/contracts";
import { isPublicAddress, parseHost } from "@brawzer/net-policy";
import { SocksClient } from "socks";

export type Lookup = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

export interface ProxyTarget {
  protocol: ProxyProtocol;
  host: string;
  port: number;
  credentials: { username: string; password: string } | null;
}

export interface TunnelOptions {
  /** Development and tests only: allow private and local proxy addresses. */
  allowPrivate: boolean;
  lookup?: Lookup;
  /** For the whole connection. */
  timeoutMs?: number;
  /** Extra TLS settings, such as a test certificate authority. */
  tls?: Pick<ConnectionOptions, "ca">;
  /** Opens the TCP connection to an already-checked address (replaceable in tests). */
  connect?: (address: string, port: number) => Socket;
}

export interface Destination {
  host: string;
  port: number;
}

export const HEADER_LIMIT = 8 * 1024;
export const USER_AGENT = "Brawzer-proxy-test";

/** Why a connection through a proxy didn't happen, in ADR 0010's fixed vocabulary. */
export class TunnelFailure extends Error {
  constructor(readonly reason: ProxyTestReason) {
    super(reason);
    this.name = "TunnelFailure";
  }
}

/** What the tester reports. */
export interface ProxyTestOutcome {
  ok: boolean;
  reachable: boolean;
  authenticated: boolean | null;
  latencyMs: number | null;
  exitAddress: string | null;
  reason: ProxyTestReason | null;
}

/** Every connection is to an IP address Brawzer already checked: never let one resolve a name. */
const refuseLookup: LookupFunction = (_hostname, _options, callback) => {
  callback(new Error("Name lookups are not allowed here"), "", 4);
};

export const defaultConnect = (address: string, port: number): Socket =>
  netConnect({ host: address, port, lookup: refuseLookup, noDelay: true });

export const defaultLookup: Lookup = (hostname) =>
  dnsLookup(hostname, { all: true, order: "verbatim" });

function connectFailure(error: NodeJS.ErrnoException): TunnelFailure {
  if (error.code === "ECONNREFUSED") return new TunnelFailure("connection_refused");
  if (error.code === "ETIMEDOUT") return new TunnelFailure("timeout");
  return new TunnelFailure("connection_failed");
}

/**
 * Opens a connection to `destination` through a saved proxy, the way ADR
 * 0010 describes: the proxy's host is resolved once and refused unless every
 * answer is public, the socket goes to that exact address, HTTPS proxies get
 * TLS with certificate verification, and the proxy's own protocol (SOCKS4,
 * SOCKS4a, SOCKS5 or HTTP CONNECT) carries the destination. Names are given
 * to the proxy as names (except with SOCKS4, which only takes IPv4), so the
 * proxy resolves them: nothing about the destination leaves through this
 * machine's resolver.
 */
export class ProxyTunnel {
  private readonly lookup: Lookup;
  readonly timeoutMs: number;

  constructor(private readonly options: TunnelOptions) {
    this.lookup = options.lookup ?? defaultLookup;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Connects through `target` to `destination`. `opened` collects every
   * stream made on the way, so the caller can tear them all down; `phase`
   * reports progress for the tester's result.
   */
  async open(
    target: ProxyTarget,
    destination: Destination,
    deadline: AbortSignal,
    opened: Duplex[],
    phase: { reachable?: () => void; authenticated?: () => void } = {},
  ): Promise<Duplex> {
    const address = await this.resolve(target.host, deadline);
    let channel: Duplex = await this.connect(address, target.port, deadline, opened);
    phase.reachable?.();
    if (target.protocol === "https") {
      channel = await this.secure(channel, target.host, deadline, opened);
    }
    const where = await this.destination(target.protocol, destination, deadline);
    channel =
      target.protocol === "http" || target.protocol === "https"
        ? await httpConnect(channel, where, target.credentials, deadline)
        : await this.socksConnect(channel as Socket, target, where, deadline);
    phase.authenticated?.();
    return channel;
  }

  /** One lookup; the address it returns is the one used. */
  async resolve(host: string, deadline: AbortSignal): Promise<string> {
    const parsed = parseHost(host);
    if (!parsed) throw new TunnelFailure("invalid_host");
    let address: string;
    if (parsed.kind === "ip") {
      address = parsed.address;
    } else {
      let answers: readonly { address: string }[];
      try {
        answers = await withDeadline(this.lookup(parsed.name), deadline);
      } catch (error) {
        if (error instanceof TunnelFailure) throw error;
        throw new TunnelFailure("dns_failed");
      }
      const first = answers[0];
      if (!first) throw new TunnelFailure("dns_failed");
      // A name that also points somewhere private is refused outright.
      if (
        !this.options.allowPrivate &&
        answers.some((answer) => !isPublicAddress(answer.address))
      ) {
        throw new TunnelFailure("blocked_address");
      }
      address = first.address;
    }
    if (!this.options.allowPrivate && !isPublicAddress(address)) {
      throw new TunnelFailure("blocked_address");
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
        reject(new TunnelFailure("timeout"));
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
  secure(stream: Duplex, host: string, deadline: AbortSignal, opened: Duplex[]): Promise<Duplex> {
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
          reject(new TunnelFailure("tls_failed"));
        });
      }),
      deadline,
    );
  }

  /** SOCKS4 can only carry an IPv4 address, so for it the destination is resolved here. */
  private async destination(
    protocol: ProxyProtocol,
    destination: Destination,
    deadline: AbortSignal,
  ): Promise<Destination> {
    const host = destination.host.replace(/^\[|\]$/g, "");
    if (protocol !== "socks4" || isIPv4(host)) return { host, port: destination.port };
    const answers = await withDeadline(this.lookup(host), deadline).catch(() => []);
    const ipv4 = answers.find((answer) => isIPv4(answer.address));
    if (!ipv4) throw new TunnelFailure("destination_failed");
    return { host: ipv4.address, port: destination.port };
  }

  private async socksConnect(
    socket: Socket,
    target: ProxyTarget,
    destination: Destination,
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
      if (error instanceof TunnelFailure) throw error;
      const message = error instanceof Error ? error.message : "";
      if (/authentication/i.test(message)) throw new TunnelFailure("auth_failed");
      if (/rejected/i.test(message)) throw new TunnelFailure("destination_failed");
      if (/timed out/i.test(message)) throw new TunnelFailure("timeout");
      throw new TunnelFailure("proxy_error");
    }
  }
}

export function withDeadline<T>(promise: Promise<T>, deadline: AbortSignal): Promise<T> {
  if (deadline.aborted) return Promise.reject(new TunnelFailure("timeout"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new TunnelFailure("timeout"));
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
export function read(
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
          reject(new TunnelFailure(overflow));
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
        reject(new TunnelFailure("connection_failed"));
      };
      stream.on("data", onData);
      stream.once("end", onEnd);
      stream.once("error", onError);
      stream.resume();
    }),
    deadline,
  );
}

export const HEAD_END = Buffer.from("\r\n\r\n");

async function httpConnect(
  stream: Duplex,
  destination: Destination,
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
  if (end === -1) throw new TunnelFailure("proxy_error");
  const status = /^HTTP\/1\.[01] (\d{3})/.exec(data.subarray(0, end).toString("latin1"))?.[1];
  if (!status) throw new TunnelFailure("proxy_error");
  if (status === "407") throw new TunnelFailure("auth_failed");
  if (status === "502" || status === "503" || status === "504") {
    throw new TunnelFailure("destination_failed");
  }
  if (!status.startsWith("2")) throw new TunnelFailure("proxy_error");
  // Anything after the head already belongs to the tunnel.
  const rest = data.subarray(end + HEAD_END.length);
  if (rest.length > 0) stream.unshift(rest);
  return stream;
}
