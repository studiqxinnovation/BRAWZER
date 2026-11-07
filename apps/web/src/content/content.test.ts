import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pricing } from "./pricing";
import { accountLinks, footerNav, primaryNav, publicRoutes } from "./site";

const appDir = path.resolve(import.meta.dirname, "../app");

/** Finds the page file for a URL path, looking inside route groups like (site). */
function pageExists(route: string): boolean {
  const segments = route.split("/").filter(Boolean);
  const groups = readdirSync(appDir).filter((entry) => entry.startsWith("("));
  return ["", ...groups].some((group) =>
    existsSync(path.join(appDir, group, ...segments, "page.tsx")),
  );
}

describe("site navigation", () => {
  const allLinks = [
    ...primaryNav.map((item) => item.href),
    ...footerNav.flatMap((group) => group.items.map((item) => item.href)),
    ...Object.values(accountLinks),
    ...publicRoutes,
  ];

  it.each(allLinks)("%s points to a real page", (href) => {
    expect(pageExists(href)).toBe(true);
  });

  it("lists every primary page in the sitemap routes", () => {
    for (const item of primaryNav) expect(publicRoutes).toContain(item.href);
  });
});

describe("pricing content", () => {
  it("states no prices or currencies while plans are undecided", () => {
    const text = JSON.stringify(pricing);
    expect(text).not.toMatch(/[$€£¥₹]|\b\d+(?:[.,]\d+)?\s?(?:USD|EUR|GBP)\b|per month|\/mo\b/i);
  });

  it("says that pricing is not decided yet", () => {
    expect(pricing.status).toMatch(/no prices yet/);
  });
});
