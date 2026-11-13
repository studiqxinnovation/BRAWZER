import http from "node:http";

/** Where a new tab opens: served inside the container, never from the internet. */
export const BEE_HOME_HOST = "bee.invalid";
export const BEE_HOME_URL = `http://${BEE_HOME_HOST}/`;
export const BEE_HOME_PORT = 8095;
/** Bee's own version, the token added to the engine's user agent. */
export const BEE_VERSION = "1.0";

/** The Brawzer mark: the tab (top) and the window (bottom), in one path. */
const MARK_PATH =
  "M6 14V8a3 3 0 0 1 3-3h6.5A4.5 4.5 0 0 1 20 9.5V14zM6 17.5A1.5 1.5 0 0 1 7.5 16h13a5.5 5.5 0 0 1 0 11H9a3 3 0 0 1-3-3z";

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>New tab</title>
<style>
:root{color-scheme:light}
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f5f2;color:#1c1b19}
main{display:flex;flex-direction:column;align-items:center;gap:20px;padding:40px 24px;max-width:36rem;text-align:center}
.mark{width:56px;height:56px;color:#1c1b19}
h1{font-size:1.75rem;margin:0;letter-spacing:-.01em}
h1 small{display:block;font-size:.95rem;font-weight:400;color:#5c5a55;margin-top:4px}
form{display:flex;width:100%;max-width:30rem;border:1px solid #d9d6cf;border-radius:14px;background:#fff;overflow:hidden}
form:focus-within{border-color:#2b5cd9;box-shadow:0 0 0 3px rgba(43,92,217,.18)}
input{flex:1;border:0;padding:14px 18px;font:inherit;outline:none;background:transparent}
button{border:0;background:#1c1b19;color:#fff;padding:0 18px;font:inherit;cursor:pointer}
p{margin:0;color:#5c5a55;font-size:.95rem}
</style></head>
<body><main>
<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><path d="${MARK_PATH}" fill="currentColor"/></svg>
<h1>Bee Browser<small>Brawzer’s own browser, running in the cloud</small></h1>
<form action="https://duckduckgo.com/" method="get"><input name="q" placeholder="Search or type an address in the bar above" autocomplete="off" autofocus><button type="submit">Search</button></form>
<p>This tab is isolated: the website runs in Brawzer’s cloud, and only its pixels reach the computer you’re using.</p>
</main></body></html>`;

/** Bee's start page, served on the container's loopback behind the filtering proxy's override. */
export function createBeeHome(): http.Server {
  return http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action https://duckduckgo.com",
      "cache-control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : page);
  });
}
