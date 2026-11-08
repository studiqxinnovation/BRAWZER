import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { type AddressInfo, connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";

/**
 * Small proxies for tests, on 127.0.0.1 only. They implement just enough of
 * SOCKS5 (RFC 1928/1929) and HTTP CONNECT (RFC 9110) to carry one request.
 */
export interface TestServer {
  port: number;
  /** Destinations the proxy was asked to reach. */
  requests: string[];
  close(): Promise<void>;
}

function listen(
  server: Server | ReturnType<typeof createServer>,
  requests: string[],
): Promise<TestServer> {
  const sockets = new Set<Duplex>();
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        requests,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}

/** Answers every request with the address it came from, like /api/v1/network/echo. */
export function echoServer(): Promise<TestServer> {
  const server = createHttpServer((request, response) => {
    response.setHeader("content-type", "text/plain");
    response.end(request.socket.remoteAddress ?? "unknown");
  });
  return listen(server, []);
}

export function socks5Proxy(auth?: { username: string; password: string }): Promise<TestServer> {
  const requests: string[] = [];
  const server = createServer((client) => {
    client.on("error", () => undefined);
    client.once("data", (greeting: Buffer) => {
      const methods = [...greeting.subarray(2, 2 + (greeting[1] ?? 0))];
      if (!auth) {
        client.write(Buffer.from([5, 0]));
        handleRequest();
        return;
      }
      if (!methods.includes(2)) {
        client.end(Buffer.from([5, 0xff]));
        return;
      }
      client.write(Buffer.from([5, 2]));
      client.once("data", (message: Buffer) => {
        const userLength = message[1] ?? 0;
        const username = message.subarray(2, 2 + userLength).toString();
        const passwordLength = message[2 + userLength] ?? 0;
        const password = message
          .subarray(3 + userLength, 3 + userLength + passwordLength)
          .toString();
        if (username === auth.username && password === auth.password) {
          client.write(Buffer.from([1, 0]));
          handleRequest();
        } else {
          client.end(Buffer.from([1, 1]));
        }
      });
    });

    function handleRequest() {
      client.once("data", (request: Buffer) => {
        const type = request[3];
        let host = "";
        let offset = 0;
        if (type === 1) {
          host = [...request.subarray(4, 8)].join(".");
          offset = 8;
        } else if (type === 3) {
          const length = request[4] ?? 0;
          host = request.subarray(5, 5 + length).toString();
          offset = 5 + length;
        }
        const port = request.readUInt16BE(offset);
        requests.push(`${host}:${String(port)}`);
        const upstream = connect(port, host, () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          client.pipe(upstream).pipe(client);
        });
        upstream.on("error", () => client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
      });
    }
  });
  return listen(server, requests);
}

function connectHandler(
  requests: string[],
  auth?: { username: string; password: string },
  delayMs = 0,
) {
  const expected = auth
    ? `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`
    : undefined;
  return (request: IncomingMessage, client: Duplex, head: Buffer) => {
    client.on("error", () => undefined);
    if (expected && request.headers["proxy-authorization"] !== expected) {
      client.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n");
      return;
    }
    const target = request.url ?? "";
    requests.push(target);
    const separator = target.lastIndexOf(":");
    const host = target.slice(0, separator).replace(/^\[|\]$/g, "");
    const port = Number(target.slice(separator + 1));
    setTimeout(() => {
      const upstream = connect(port, host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        client.pipe(upstream).pipe(client);
      });
      upstream.on("error", () => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
    }, delayMs);
  };
}

/** `delayMs` holds each tunnel open before connecting, for concurrency tests. */
export function httpProxy(
  auth?: { username: string; password: string },
  delayMs = 0,
): Promise<TestServer> {
  const requests: string[] = [];
  const server = createHttpServer();
  server.on("connect", connectHandler(requests, auth, delayMs));
  return listen(server, requests);
}

/** A throwaway certificate for localhost and 127.0.0.1, made for this test run only. */
export function testCertificate(): { key: string; cert: string } {
  const directory = mkdtempSync(path.join(tmpdir(), "brawzer-cert-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        path.join(directory, "key.pem"),
        "-out",
        path.join(directory, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    return {
      key: readFileSync(path.join(directory, "key.pem"), "utf8"),
      cert: readFileSync(path.join(directory, "cert.pem"), "utf8"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function httpsProxy(certificate: { key: string; cert: string }): Promise<TestServer> {
  const requests: string[] = [];
  const server = createHttpsServer(certificate);
  server.on("connect", connectHandler(requests));
  return listen(server, requests);
}

/**
 * A SOCKS5 proxy that never connects anywhere: it answers every tunnelled
 * request with a small page naming the destination it was asked for. Used to
 * prove a cloud browser session's traffic went through the profile's proxy
 * and that the name reached the proxy unresolved.
 */
export function answeringSocks5Proxy(auth: {
  username: string;
  password: string;
}): Promise<TestServer> {
  const requests: string[] = [];
  const server = createServer((client) => {
    client.on("error", () => undefined);
    client.once("data", () => {
      client.write(Buffer.from([5, 2]));
      client.once("data", (message: Buffer) => {
        const userLength = message[1] ?? 0;
        const username = message.subarray(2, 2 + userLength).toString();
        const passwordLength = message[2 + userLength] ?? 0;
        const password = message
          .subarray(3 + userLength, 3 + userLength + passwordLength)
          .toString();
        if (username !== auth.username || password !== auth.password) {
          client.end(Buffer.from([1, 1]));
          return;
        }
        client.write(Buffer.from([1, 0]));
        client.once("data", (request: Buffer) => {
          const type = request[3];
          let host = "";
          let offset = 0;
          if (type === 1) {
            host = [...request.subarray(4, 8)].join(".");
            offset = 8;
          } else if (type === 3) {
            const length = request[4] ?? 0;
            host = request.subarray(5, 5 + length).toString();
            offset = 5 + length;
          }
          const port = request.readUInt16BE(offset);
          requests.push(`${host}:${String(port)}`);
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          // Whatever the page asks for, the proxy "is" the website.
          client.once("data", () => {
            const body = `<!doctype html><title>Through the proxy: ${host}</title><h1>Through the proxy</h1>`;
            client.end(
              `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${String(Buffer.byteLength(body))}\r\nConnection: close\r\n\r\n${body}`,
            );
          });
        });
      });
    });
  });
  return listen(server, requests);
}
