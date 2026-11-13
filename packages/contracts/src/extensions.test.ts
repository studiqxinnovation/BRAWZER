import { describe, expect, it } from "vitest";
import { EXTENSION_CATALOGUE, extensionListSchema, extensionsFor } from "./extensions.ts";

describe("the extension catalogue", () => {
  it("pins every build to a release asset and its hash, each slug once", () => {
    const slugs = EXTENSION_CATALOGUE.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const entry of EXTENSION_CATALOGUE) {
      expect(entry.slug).toMatch(/^[a-z0-9-]+$/);
      expect(entry.bee ?? entry.firefox).not.toBeNull();
      for (const build of [entry.bee, entry.firefox]) {
        if (!build) continue;
        expect(build.url).toMatch(/^https:\/\/github\.com\/.+\/releases\/download\//);
        expect(build.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(build.kind).toBe(build.url.endsWith(".xpi") ? "xpi" : "zip");
        if (build.kind === "xpi") expect(build.id).toMatch(/@/);
      }
    }
  });

  it("knows which engine runs what, and takes each extension once", () => {
    expect(extensionsFor("bee").map((entry) => entry.slug)).toEqual(["ubo-lite", "dark-reader"]);
    expect(extensionsFor("firefox").map((entry) => entry.slug)).toEqual([
      "ubo-lite",
      "ublock-origin",
      "dark-reader",
    ]);
    expect(extensionListSchema.safeParse(["ubo-lite", "ubo-lite"]).success).toBe(false);
    expect(extensionListSchema.safeParse(["nope"]).success).toBe(false);
    expect(extensionListSchema.safeParse(["dark-reader"]).success).toBe(true);
  });
});
