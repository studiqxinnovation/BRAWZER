import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appNav, plannedModules } from "./app";
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

describe("signed-in navigation", () => {
  const items = appNav.flatMap((group) => group.items);

  it.each(items.map((item) => item.href))("%s points to a real page", (href) => {
    expect(pageExists(href)).toBe(true);
  });

  it("marks exactly the modules that aren't built as planned", () => {
    const planned = items.filter((item) => item.status === "planned").map((item) => item.label);
    expect(planned).toEqual(Object.values(plannedModules).map((planned) => planned.title));
  });

  it("states what each planned module still needs", () => {
    for (const planned of Object.values(plannedModules)) {
      expect(planned.requires.length).toBeGreaterThan(0);
      expect(planned.milestone).toMatch(/^Phases? \d/);
    }
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
