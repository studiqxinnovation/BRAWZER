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

const MANIFEST_MAX_BYTES = 64 * 1024;
/** Big enough for the largest tile (Launchpad's) on a sharp screen. */
const SHARP_PX = 128;
/** How many candidate images to try before settling for the best so far. */
const MAX_TRIES = 8;

const attribute = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : null;
};

/** The web app manifest a page names, if any. */
export function manifestUrl(html: string, page: URL): URL | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attribute(tag, "href");
    if (!rel.includes("manifest") || !href) continue;
    try {
      const url = new URL(href, page);
      if (isPublicHttps(url)) return url;
    } catch {
      // A malformed href.
    }
  }
  return null;
}

/**
 * The icons a manifest lists, largest first: a site's home-screen icons,
 * which are the sharp ones (192 and 512 pixels, as a rule).
 */
export function manifestIcons(json: string, manifest: URL): URL[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const icons = (parsed as { icons?: unknown } | null)?.icons;
  if (!Array.isArray(icons)) return [];
  const found: Candidate[] = [];
  for (const icon of icons as unknown[]) {
    if (!icon || typeof icon !== "object") continue;
    const { src, sizes, type, purpose } = icon as Record<string, unknown>;
    if (typeof src !== "string") continue;
    // A maskable icon is drawn to be cropped; the plain one is what a tile wants.
    if (
      typeof purpose === "string" &&
      purpose.split(/\s+/).includes("maskable") &&
      !purpose.includes("any")
    ) {
      continue;
    }
    const declared = typeof sizes === "string" ? sizes : "";
    const size =
      declared.toLowerCase() === "any" || (typeof type === "string" && type.includes("svg"))
        ? 256
        : Math.max(0, ...declared.split(/\s+/).map((entry) => Number.parseInt(entry, 10) || 0));
    try {
      const url = new URL(src, manifest);
      if (isPublicHttps(url)) found.push({ url, score: size });
    } catch {
      // A malformed src.
    }
  }
  return found.sort((a, b) => b.score - a.score).map((candidate) => candidate.url);
}

/** An image's pixel size from its bytes: the larger side, or null if unknown. */
export function imageSize(bytes: Buffer, type: string): number | null {
  try {
    if (type === "image/svg+xml") return 1024;
    if (type === "image/png" && bytes.length >= 24) {
      return Math.max(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    }
    if (type === "image/gif" && bytes.length >= 10) {
      return Math.max(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
    }
    if (type === "image/x-icon" && bytes.length >= 6) {
      const count = bytes.readUInt16LE(4);
      let largest = 0;
      for (let index = 0; index < count && 6 + index * 16 + 2 <= bytes.length; index += 1) {
        // An entry's size byte: 0 means 256.
        const width = bytes[6 + index * 16] ?? 0;
        const height = bytes[7 + index * 16] ?? 0;
        largest = Math.max(largest, width === 0 ? 256 : width, height === 0 ? 256 : height);
      }
      return largest || null;
    }
    if (type === "image/webp" && bytes.length >= 30) {
      const chunk = bytes.subarray(12, 16).toString("latin1");
      if (chunk === "VP8X") {
        return Math.max(1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3));
      }
      if (chunk === "VP8L") {
        const bits = bytes.readUInt32LE(21);
        return Math.max(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff));
      }
      if (chunk === "VP8 ") {
        return Math.max(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
      }
      return null;
    }
    if (type === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        const marker = bytes[offset + 1] ?? 0;
        const length = bytes.readUInt16BE(offset + 2);
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          return Math.max(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 7));
        }
        offset += 2 + length;
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

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
  /** Keep the first `maxBytes` of a longer body (a page's head is at its start) rather than give it up. */
  truncate = false,
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
      return await get(new URL(location, url), accept, maxBytes, fetchImpl, hops + 1, truncate);
    } catch {
      return null;
    }
  }
  const declared = Number(response.headers.get("content-length"));
  if (!truncate && Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const body = await readCapped(response, maxBytes, truncate);
  if (!body) return null;
  return { status: response.status, body, url };
}

async function readCapped(
  response: Response,
  maxBytes: number,
  truncate: boolean,
): Promise<Buffer | null> {
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
        if (!truncate) return null;
        chunks.push(Buffer.from(value));
        break;
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

/**
 * A site's own icon, the sharpest it offers: its manifest's home-screen
 * icons first, then what its page names, then the usual places. The first
 * one sharp enough for a tile wins; otherwise the largest found. Null when
 * the site offers nothing image-shaped; the tile then shows the name's initial.
 */
export async function fetchSiteIcon(site: URL, fetchImpl: Fetch = fetch): Promise<SiteIcon | null> {
  // A long page (a video site's home is over a megabyte) still names its icons in its head.
  const page = await get(site, "text/html,*/*;q=0.5", HTML_MAX_BYTES, fetchImpl, 0, true);
  const html = page?.status === 200 ? page.body.toString("utf8") : "";
  // Icons are named relative to the page that answered, which may have moved.
  const pageUrl = page?.url ?? site;
  const candidates: URL[] = [];
  const manifest = manifestUrl(html, pageUrl);
  if (manifest) {
    const got = await get(
      manifest,
      "application/manifest+json,application/json,*/*;q=0.5",
      MANIFEST_MAX_BYTES,
      fetchImpl,
    );
    if (got?.status === 200) candidates.push(...manifestIcons(got.body.toString("utf8"), got.url));
  }
  candidates.push(...iconCandidates(html, pageUrl, site));
  const seen = new Set<string>();
  let best: { icon: SiteIcon; size: number } | null = null;
  let tries = 0;
  for (const url of candidates) {
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    if (tries >= MAX_TRIES) break;
    tries += 1;
    const got = await get(url, "image/*", ICON_MAX_BYTES, fetchImpl);
    if (got?.status !== 200 || got.body.length === 0) continue;
    const type = sniffImageType(got.body);
    if (!type) continue;
    const size = imageSize(got.body, type) ?? 0;
    if (size >= SHARP_PX) return { type, bytes: got.body };
    if (!best || size > best.size) best = { icon: { type, bytes: got.body }, size };
  }
  return best?.icon ?? null;
}
