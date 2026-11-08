import http from "node:http";

export const TEST_SITE_HOST = "testsite.invalid";

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
 * as http://testsite.invalid/ through the filtering proxy. Every control sits
 * at a fixed position so tests can click it through the streamed viewport.
 */
export function createTestSite(): http.Server {
  return http.createServer((req, res) => {
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
<input class="box" style="top:360px" type="file">
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
      case "/download":
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-disposition": 'attachment; filename="brawzer-test.bin"',
        });
        res.end(Buffer.alloc(1024));
        return;
      default:
        send(404, page("Not found", "<h1>Not found</h1>"));
    }
  });
}
