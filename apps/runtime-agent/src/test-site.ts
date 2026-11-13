import { execFile } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";

export const TEST_SITE_HOST = "testsite.invalid";
/** Loopback ports inside the container; the proxy maps the host's 80 and 443 onto them. */
export const TEST_SITE_PORTS = { http: 8090, https: 8091 } as const;

export interface TestSiteCertificate {
  key: string;
  cert: string;
  /** Base64 SHA-256 of the public key, for Chromium's `--ignore-certificate-errors-spki-list`. */
  spkiHash: string;
}

/**
 * A self-signed certificate for the test site, made fresh for this container
 * with the system's OpenSSL. Nothing trusts it except the engine in this
 * container, and only for this one key (not for any other certificate error).
 */
export async function generateTestSiteCertificate(dir: string): Promise<TestSiteCertificate> {
  const keyPath = path.join(dir, "testsite-key.pem");
  const certPath = path.join(dir, "testsite-cert.pem");
  await promisify(execFile)("openssl", [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-days",
    "2",
    "-subj",
    `/CN=${TEST_SITE_HOST}`,
    "-addext",
    `subjectAltName=DNS:${TEST_SITE_HOST}`,
    "-keyout",
    keyPath,
    "-out",
    certPath,
  ]);
  const [key, cert] = await Promise.all([readFile(keyPath, "utf8"), readFile(certPath, "utf8")]);
  const spki = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
  return { key, cert, spkiHash: createHash("sha256").update(spki).digest("base64") };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{margin:0;font:20px/1.4 sans-serif;background:#fff;color:#111}
.box{position:fixed;left:40px;width:280px;height:56px;display:flex;align-items:center;justify-content:center;
background:#1d4ed8;color:#fff;border:0;border-radius:8px;font:20px sans-serif;text-decoration:none;box-sizing:border-box}
input.box{background:#fff;color:#111;border:2px solid #1d4ed8;padding:0 12px;justify-content:flex-start}
h1{position:fixed;left:360px;top:40px;margin:0}</style></head>
<body>${body}</body></html>`;

/**
 * A small site served inside the container for the browser tests, reachable
 * as http://testsite.invalid/ and https://testsite.invalid/ through the
 * filtering proxy. Every control sits at a fixed position so tests can click
 * it through the streamed viewport.
 */
export function createTestSite(tls?: TestSiteCertificate): http.Server {
  return tls
    ? https.createServer(tls, handleTestSiteRequest)
    : http.createServer(handleTestSiteRequest);
}

function handleTestSiteRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://testsite.invalid");
  const send = (status: number, html: string, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(html);
  };
  switch (url.pathname) {
    case "/":
      send(
        200,
        page(
          "Brawzer test site",
          `<h1>Brawzer test site</h1>
<a class="box" style="top:40px" href="/second">Second page</a>
<button class="box" style="top:120px" onclick="alert('Hello from the test site')">Show message</button>
<form action="/search"><input class="box" style="top:200px" name="q" placeholder="Search"></form>
<a class="box" style="top:280px" href="/download">Download a file</a>
<input class="box" style="top:360px" type="file" onchange="document.title=[...this.files].map(f=>f.name+' '+f.size).join(', ')">
<button class="box" style="top:440px" onclick="window.open('/second')">Open popup</button>
<a class="box" style="top:520px" href="file:///etc/hostname">Local file</a>
<a class="box" style="top:600px" href="http://127.0.0.1:4100/">Private address</a>`,
        ),
      );
      return;
    case "/second":
      send(200, page("Second page", "<h1>Second page</h1>"));
      return;
    case "/search": {
      const q = url.searchParams.get("q") ?? "";
      send(200, page(`Results for ${q}`, `<h1>Results for ${escapeHtml(q)}</h1>`));
      return;
    }
    case "/download": {
      // ?bytes= picks the size (1 KiB by default); ?name= the suggested filename.
      const bytes = Math.min(
        Number(url.searchParams.get("bytes") ?? "1024") || 1024,
        512 * 1024 * 1024,
      );
      const name = (url.searchParams.get("name") ?? "brawzer-test.bin").replace(/["\\\r\n]/g, "");
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${name}"`,
        "content-length": String(bytes),
      });
      // A recognisable pattern, streamed in pieces so large files don't sit in memory.
      let sent = 0;
      const piece = Buffer.alloc(64 * 1024, "brawzer-test-pattern ");
      const write = () => {
        while (sent < bytes) {
          const chunk = piece.subarray(0, Math.min(piece.length, bytes - sent));
          sent += chunk.length;
          if (!res.write(chunk)) {
            res.once("drain", write);
            return;
          }
        }
        res.end();
      };
      write();
      return;
    }
    case "/upload":
      send(
        200,
        page(
          "Upload page",
          `<h1>Upload page</h1>
<input class="box" style="top:40px" type="file" multiple onchange="document.title=[...this.files].map(f=>f.name+' '+f.size).join(', ')">`,
        ),
      );
      return;
    case "/set-cookie":
      send(200, page("Cookie set", "<h1>Cookie set</h1>"), {
        "set-cookie": "brawzer_test=kept; Max-Age=86400; Path=/; SameSite=Lax",
      });
      return;
    case "/cookie": {
      const cookie = req.headers.cookie ?? "none";
      send(200, page(`Cookie: ${cookie}`, `<h1>Cookie: ${escapeHtml(cookie)}</h1>`));
      return;
    }
    default:
      send(404, page("Not found", "<h1>Not found</h1>"));
  }
}
