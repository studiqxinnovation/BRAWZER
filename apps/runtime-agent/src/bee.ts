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

const SHORTCUTS: readonly [string, string, string][] = [
  ["YouTube", "https://www.youtube.com/", "#FF3B30"],
  ["Gmail", "https://mail.google.com/", "#0A84FF"],
  ["GitHub", "https://github.com/", "#3A3A3C"],
  ["BBC", "https://www.bbc.co.uk/", "#B4161B"],
  ["Wikipedia", "https://www.wikipedia.org/", "#636366"],
  ["Amazon", "https://www.amazon.co.uk/", "#FF9F0A"],
];

/** The start page as the prototype draws a browser's: the icon, the name, a search pill, shortcuts. */
const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>New tab</title>
<style>
:root{color-scheme:light dark;--bg:#f7f8fb;--card:rgba(0,0,0,.05);--line:rgba(0,0,0,.09);--t1:#0f172a;--t2:rgba(15,23,42,.65);--t3:rgba(15,23,42,.42)}
@media (prefers-color-scheme:dark){:root{--bg:#141b2b;--card:rgba(255,255,255,.07);--line:rgba(255,255,255,.1);--t1:#f0f4ff;--t2:rgba(220,230,255,.7);--t3:rgba(180,200,255,.42)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:26px;font:13px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--t1)}
.tile{width:60px;height:60px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(145deg,#FFE566,#F5A623);color:#1c1b19;box-shadow:0 4px 12px rgba(0,0,0,.25)}
.tile svg{width:34px;height:34px}
h1{margin:0;font-size:18px;font-weight:700;letter-spacing:-.02em}
form{display:flex;align-items:center;gap:9px;width:min(440px,92%);height:42px;padding:0 16px;border-radius:21px;background:var(--card);border:1px solid var(--line)}
form:focus-within{border-color:#3B82F6}
form svg{width:13px;height:13px;stroke:var(--t3);fill:none;stroke-width:2;flex-shrink:0}
input{flex:1;min-width:0;border:0;outline:0;background:none;color:var(--t1);font:inherit;font-size:12.5px}
input::placeholder{color:var(--t3)}
button{display:none}
.short{display:grid;grid-template-columns:repeat(6,62px);gap:10px;margin:4px 0 6px}
.sc{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:10.5px;color:var(--t2);text-decoration:none}
.sc b{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;color:#fff;font-size:16px;font-weight:700;transition:transform .15s;box-shadow:inset 0 .5px 0 rgba(255,255,255,.3)}
.sc:hover b{transform:translateY(-3px)}
p{margin:0;color:var(--t3);font-size:11px}
@media (max-width:460px){.short{grid-template-columns:repeat(3,62px)}}
</style></head>
<body>
<span class="tile"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="${MARK_PATH}" fill="currentColor"/></svg></span>
<h1>Bee Browser</h1>
<form action="https://www.google.com/search" method="get"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input name="q" placeholder="Search the web or type a website" autocomplete="off" aria-label="Search the web" autofocus><button type="submit">Search</button></form>
<nav class="short" aria-label="Shortcuts">${SHORTCUTS.map(
  ([name, href, colour]) =>
    `<a class="sc" href="${href}"><b style="background:${colour}">${name[0] ?? ""}</b>${name}</a>`,
).join("")}</nav>
<p>Isolated cloud session · only pixels reach the computer you’re using</p>
</body></html>`;

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
        "default-src 'none'; style-src 'unsafe-inline'; form-action https://www.google.com",
      "cache-control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : page);
  });
}
