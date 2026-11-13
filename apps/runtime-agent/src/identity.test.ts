import { describe, expect, it } from "vitest";
import { BEE_VERSION } from "./bee.ts";
import { browserIdentity } from "./engine.ts";

const headless = {
  product: "HeadlessChrome/157.0.8103.50",
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36",
};

describe("what websites are told the browser is", () => {
  it("says Chrome for Google Chrome, with Chrome's brand hints", () => {
    const { userAgent, metadata } = browserIdentity(headless, "chrome", "x64");
    expect(userAgent).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
    );
    expect(metadata?.brands).toEqual([
      { brand: "Google Chrome", version: "157" },
      { brand: "Chromium", version: "157" },
      { brand: "Not_A Brand", version: "24" },
    ]);
    expect(metadata?.fullVersionList[0]).toEqual({
      brand: "Google Chrome",
      version: "157.0.8103.50",
    });
    expect(metadata).toMatchObject({ platform: "Linux", architecture: "x86", bitness: "64" });
  });

  it("names Bee after what it is built on, and never says headless", () => {
    const { userAgent, metadata } = browserIdentity(headless, "bee", "arm64");
    expect(userAgent).not.toContain("Headless");
    expect(userAgent.endsWith(`Chrome/157.0.0.0 Safari/537.36 Bee/${BEE_VERSION}`)).toBe(true);
    expect(metadata?.brands.map((entry) => entry.brand)).toEqual(["Chromium", "Not_A Brand"]);
    expect(metadata?.architecture).toBe("arm");
  });

  it("says Edge and Chromium for those, each with its own hints", () => {
    const edge = browserIdentity(
      { product: "HeadlessEdg/143.0.3650.80", userAgent: headless.userAgent },
      "edge",
      "x64",
    );
    expect(edge.userAgent).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/143.0.3650.80",
    );
    expect(edge.metadata?.brands[0]).toEqual({ brand: "Microsoft Edge", version: "143" });
    const withEdg = browserIdentity(
      {
        product: "HeadlessEdg/143.0.3650.80",
        userAgent: `${headless.userAgent} HeadlessEdg/143.0.0.0`,
      },
      "edge",
    );
    expect(withEdg.userAgent.endsWith("Safari/537.36 Edg/143.0.0.0")).toBe(true);

    const chromium = browserIdentity(headless, "chromium");
    expect(chromium.userAgent).not.toContain("Headless");
    expect(chromium.userAgent).not.toContain("Bee/");
    expect(chromium.metadata?.brands.map((entry) => entry.brand)).toEqual([
      "Chromium",
      "Not_A Brand",
    ]);
  });

  it("sends no brand hints it can't fill in", () => {
    expect(browserIdentity({ product: "odd", userAgent: "x" }, "chrome").metadata).toBeNull();
  });
});
