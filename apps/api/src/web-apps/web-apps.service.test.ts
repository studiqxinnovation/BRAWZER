import { describe, expect, it } from "vitest";
import { WebAppsService } from "./web-apps.service.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

describe("WebAppsService", () => {
  it("asks a site once, keeps the answer, and knows no other site", async () => {
    const service = new WebAppsService();
    let asked = 0;
    service.fetchImpl = (input) => {
      asked += 1;
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(
        url.endsWith("/apple-touch-icon.png")
          ? new Response(PNG, { status: 200 })
          : new Response("", { status: 404 }),
      );
    };
    const [first, second] = await Promise.all([
      service.icon("wikipedia"),
      service.icon("wikipedia"),
    ]);
    expect(first?.type).toBe("image/png");
    expect(second).toBe(first);
    const askedOnce = asked;
    expect(await service.icon("wikipedia")).toBe(first);
    expect(asked).toBe(askedOnce);
    expect(service.icon("not-a-listed-app")).toBeNull();
  });
});
