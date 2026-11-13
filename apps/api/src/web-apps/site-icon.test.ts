import { describe, expect, it } from "vitest";
import { fetchSiteIcon, iconCandidates, isPublicHttps, sniffImageType } from "./site-icon.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 1, 0]);

const site = new URL("https://example.com/");

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = routes[url];
    return Promise.resolve(route ? route() : new Response("nope", { status: 404 }));
  };
}

describe("isPublicHttps", () => {
  it("allows public https names only", () => {
    expect(isPublicHttps(new URL("https://chatgpt.com/"))).toBe(true);
    for (const bad of [
      "http://example.com/",
      "https://localhost/",
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://10.0.0.5/icon.png",
      "https://printer.local/",
      "https://api.internal/",
      "https://metadata/",
    ]) {
      expect(isPublicHttps(new URL(bad)), bad).toBe(false);
    }
  });
});

describe("iconCandidates", () => {
  it("prefers the touch icon, then larger icons, then the usual places", () => {
    const html = `<html><head>
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel='icon' type="image/svg+xml" href=/logo.svg>
      <link rel="apple-touch-icon" sizes="180x180" href="https://cdn.example.com/touch.png">
      <link rel="stylesheet" href="/app.css">
      <link rel="icon" href="http://example.com/plain.png">
    </head></html>`;
    expect(iconCandidates(html, site).map((url) => url.href)).toEqual([
      "https://cdn.example.com/touch.png",
      "https://example.com/logo.svg",
      "https://example.com/favicon-16.png",
      "https://example.com/apple-touch-icon.png",
      "https://example.com/favicon.ico",
    ]);
  });

  it("offers the usual places for a page that names none", () => {
    expect(iconCandidates("", site).map((url) => url.pathname)).toEqual([
      "/apple-touch-icon.png",
      "/favicon.ico",
    ]);
  });
});

describe("fetchSiteIcon", () => {
  it("returns the touch icon the page names, typed from its bytes", async () => {
    const icon = await fetchSiteIcon(
      site,
      fakeFetch({
        "https://example.com/": () =>
          new Response('<link rel="apple-touch-icon" href="/touch.png">', { status: 200 }),
        "https://example.com/touch.png": () =>
          new Response(PNG, { status: 200, headers: { "content-type": "text/plain" } }),
      }),
    );
    expect(icon?.type).toBe("image/png");
    expect(icon?.bytes.equals(PNG)).toBe(true);
  });

  it("falls back to favicon.ico when the page has nothing better", async () => {
    const icon = await fetchSiteIcon(
      site,
      fakeFetch({
        "https://example.com/": () => new Response("<html></html>", { status: 200 }),
        "https://example.com/favicon.ico": () => new Response(ICO, { status: 200 }),
      }),
    );
    expect(icon?.type).toBe("image/x-icon");
  });

  it("follows a redirect to a public address but never to a private one", async () => {
    const icon = await fetchSiteIcon(
      site,
      fakeFetch({
        "https://example.com/": () =>
          new Response(null, { status: 301, headers: { location: "https://www.example.com/" } }),
        "https://www.example.com/": () =>
          new Response('<link rel="icon" href="/i.png">', { status: 200 }),
        "https://www.example.com/i.png": () =>
          new Response(null, { status: 302, headers: { location: "https://10.1.1.1/i.png" } }),
        "https://10.1.1.1/i.png": () => new Response(PNG, { status: 200 }),
        "https://www.example.com/favicon.ico": () => new Response(ICO, { status: 200 }),
      }),
    );
    // The redirected icon was refused; the page's own favicon served instead.
    expect(icon?.type).toBe("image/x-icon");
  });

  it("refuses anything that isn't an image, or is too large", async () => {
    const big = Buffer.alloc(300 * 1024, 0x89);
    const icon = await fetchSiteIcon(
      site,
      fakeFetch({
        "https://example.com/": () => new Response("", { status: 200 }),
        "https://example.com/apple-touch-icon.png": () =>
          new Response("<html>not found</html>", { status: 200 }),
        "https://example.com/favicon.ico": () => new Response(big, { status: 200 }),
      }),
    );
    expect(icon).toBeNull();
  });
});

describe("sniffImageType", () => {
  it("knows the image types a tile can show", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(ICO)).toBe("image/x-icon");
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?><svg xmlns="x">'))).toBe(
      "image/svg+xml",
    );
    expect(sniffImageType(Buffer.from("<html>"))).toBeNull();
  });
});
