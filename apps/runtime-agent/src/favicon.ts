import http from "node:http";
import tls from "node:tls";
import { FAVICON_MAX_BYTES } from "@brawzer/contracts";

const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 2;
/** Image types a tab strip can show; the type is read from the bytes, never trusted from a header. */
const SIGNATURES: [number[], string][] = [
  [[0x89, 0x50, 0x4e, 0x47], "image/png"],
  [[0x00, 0x00, 0x01, 0x00], "image/x-icon"],
  [[0x47, 0x49, 0x46, 0x38], "image/gif"],
  [[0xff, 0xd8, 0xff], "image/jpeg"],
];

function sniff(bytes: Buffer): string | null {
  for (const [magic, type] of SIGNATURES) {
    if (magic.every((byte, index) => bytes[index] === byte)) return type;
  }
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  ) {
    return "image/webp";
  }
  const head = bytes.subarray(0, 512).toString("utf8").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

/**
 * Fetches a page's site icon through the session's own filtering proxy, so
 * the same policy, proxy and allow-list apply as to the page, and returns it
 * as a data URL for the viewer to show: the person's computer never asks the
 * site for anything. Null for anything that isn't a small image.
 */
export function fetchFavicon(url: string, proxyPort: number): Promise<string | null> {
  return get(url, proxyPort, 0);
}

async function get(url: string, proxyPort: number, hops: number): Promise<string | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  const response = await request(target, proxyPort).catch(() => null);
  if (!response) return null;
  const { status, headers, body } = response;
  if (status >= 300 && status < 400 && headers.location && hops < MAX_REDIRECTS) {
    let next: string;
    try {
      next = new URL(headers.location, target).href;
    } catch {
      return null;
    }
    return get(next, proxyPort, hops + 1);
  }
  if (status !== 200 || body.length === 0 || body.length > FAVICON_MAX_BYTES) return null;
  const type = sniff(body);
  if (!type) return null;
  return `data:${type};base64,${body.toString("base64")}`;
}

interface Response {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** One GET through the proxy: plain for http, inside a CONNECT tunnel for https. */
function request(target: URL, proxyPort: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers = { Host: target.host, Accept: "image/*", "User-Agent": "Brawzer" };
    const finish = (res: http.IncomingMessage) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > FAVICON_MAX_BYTES + 1) {
          res.destroy();
          reject(new Error("too large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
      );
      res.on("error", reject);
    };
    if (target.protocol === "http:") {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: proxyPort,
          method: "GET",
          path: target.href,
          headers,
          timeout: TIMEOUT_MS,
        },
        finish,
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end();
      return;
    }
    const authority = `${target.hostname}:${target.port || "443"}`;
    const connect = http.request({
      host: "127.0.0.1",
      port: proxyPort,
      method: "CONNECT",
      path: authority,
      headers: { Host: authority },
      timeout: TIMEOUT_MS,
    });
    connect.on("timeout", () => connect.destroy(new Error("timeout")));
    connect.on("error", reject);
    connect.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`tunnel refused: ${String(res.statusCode)}`));
        return;
      }
      const secure = tls.connect({ socket, servername: target.hostname });
      secure.on("error", reject);
      const req = http.request(
        {
          createConnection: () => secure,
          method: "GET",
          path: `${target.pathname}${target.search}`,
          headers,
          timeout: TIMEOUT_MS,
        },
        finish,
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end();
    });
    connect.end();
  });
}
