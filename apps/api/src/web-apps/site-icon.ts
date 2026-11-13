import { isIP } from "node:net";

/** Bytes an icon may be: a touch icon is a few KB; nothing a page needs is more. */
export const ICON_MAX_BYTES = 256 * 1024;
const HTML_MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 3;

export interface SiteIcon {
  type: string;
  bytes: Buffer;
}

export type Fetch = typeof fetch;

/** Image types a tile can show; read from the bytes, never trusted from a header. */
const SIGNATURES: [number[], string][] = [
  [[0x89, 0x50, 0x4e, 0x47], "image/png"],
  [[0x00, 0x00, 0x01, 0x00], "image/x-icon"],
  [[0x47, 0x49, 0x46, 0x38], "image/gif"],
  [[0xff, 0xd8, 0xff], "image/jpeg"],
];

export function sniffImageType(bytes: Buffer): string | null {
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
 * Only public https sites: never a private address, a name on this network
 * or a plain http page, wherever a redirect may try to send the request.
 */
export function isPublicHttps(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host.includes(".") || isIP(host) !== 0) return false;
  return !/\.(local|localhost|internal|home|lan|arpa)$/.test(host);
}

interface Candidate {
  url: URL;
  score: number;
}

const attribute = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : null;
};

/**
 * The icons a page offers, best first: its touch icon (what a phone's home
 * screen shows) over its favicon, and larger over smaller. Then the two
 * places sites keep them without saying so.
 */
export function iconCandidates(html: string, page: URL, site: URL = page): URL[] {
  const found: Candidate[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attribute(tag, "href");
    if (!href) continue;
    const touch = rel.some((r) => r.startsWith("apple-touch-icon"));
    const icon = rel.includes("icon");
    if (!touch && !icon) continue;
    const sizes = attribute(tag, "sizes") ?? "";
    const type = (attribute(tag, "type") ?? "").toLowerCase();
    let size = Number.parseInt(sizes, 10);
    if (sizes.toLowerCase() === "any" || type.includes("svg") || /\.svg(\?|$)/i.test(href)) {
      size = 256;
    }
    if (!Number.isFinite(size)) size = touch ? 180 : 32;
    try {
      const url = new URL(href, page);
      if (isPublicHttps(url)) found.push({ url, score: (touch ? 1000 : 0) + Math.min(size, 999) });
    } catch {
      // A malformed href: not a candidate.
    }
  }
  found.sort((a, b) => b.score - a.score);
  const urls = found.map((candidate) => candidate.url);
  // A site that sends visitors elsewhere (to sign in, say) still keeps its own icon at home.
  for (const origin of new Set([page.origin, site.origin])) {
    for (const path of ["/apple-touch-icon.png", "/favicon.ico"]) {
      urls.push(new URL(path, origin));
    }
  }
  const seen = new Set<string>();
  return urls.filter((url) => !seen.has(url.href) && seen.add(url.href));
}

interface Got {
  status: number;
  body: Buffer;
  /** Where the response came from, after any redirects. */
  url: URL;
}

/** One GET, following redirects only to public https addresses, the body capped. */
async function get(
  url: URL,
  accept: string,
  maxBytes: number,
  fetchImpl: Fetch,
  hops = 0,
): Promise<Got | null> {
  if (!isPublicHttps(url)) return null;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: accept, "User-Agent": "Brawzer (site icon)" },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location || hops >= MAX_REDIRECTS) return null;
    try {
      return await get(new URL(location, url), accept, maxBytes, fetchImpl, hops + 1);
    } catch {
      return null;
    }
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const body = await readCapped(response, maxBytes);
  if (!body) return null;
  return { status: response.status, body, url };
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer | null> {
  if (!response.body) return Buffer.alloc(0);
  // Node types the stream's chunks loosely; a fetch body is always bytes.
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks);
}

/**
 * A site's own icon: what its page names, or what it keeps in the usual
 * places. Null when the site offers nothing small and image-shaped; the tile
 * then shows the name's initial.
 */
export async function fetchSiteIcon(site: URL, fetchImpl: Fetch = fetch): Promise<SiteIcon | null> {
  const page = await get(site, "text/html,*/*;q=0.5", HTML_MAX_BYTES, fetchImpl);
  const html = page?.status === 200 ? page.body.toString("utf8") : "";
  // Icons are named relative to the page that answered, which may have moved.
  for (const url of iconCandidates(html, page?.url ?? site, site)) {
    const got = await get(url, "image/*", ICON_MAX_BYTES, fetchImpl);
    if (got?.status !== 200 || got.body.length === 0) continue;
    const type = sniffImageType(got.body);
    if (type) return { type, bytes: got.body };
  }
  return null;
}
