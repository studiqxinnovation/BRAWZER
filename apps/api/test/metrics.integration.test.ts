import { describe, expect, it } from "vitest";
import { createHarness } from "./support/harness.js";

describe("metrics", () => {
  it("serves the runbook's figures in Prometheus's text format, behind the token when one is set", async () => {
    const open = await createHarness({ ipPrefix: "100.76.0" });
    await open.listen();
    try {
      const scrape = await open.browser().get("/metrics");
      expect(scrape.statusCode, scrape.body).toBe(200);
      expect(scrape.headers["content-type"]).toContain("text/plain");
      expect(scrape.body).toContain("# TYPE brawzer_sessions_live gauge");
      expect(scrape.body).toContain("brawzer_build_info{version=");
      expect(scrape.body).toContain('brawzer_runtime_host_capacity{host="local"}');
      expect(scrape.body).toContain("brawzer_stream_viewers 0");
    } finally {
      await open.close();
    }

    const guarded = await createHarness({
      ipPrefix: "100.76.1",
      env: { METRICS_TOKEN: "scrape-me-if-you-can-0001" },
    });
    await guarded.listen();
    try {
      const client = guarded.browser();
      expect((await client.get("/metrics")).statusCode).toBe(401);
      expect(
        (await client.get("/metrics", { authorization: "Bearer not-the-token-at-all-00" }))
          .statusCode,
      ).toBe(401);
      const scrape = await client.get("/metrics", {
        authorization: "Bearer scrape-me-if-you-can-0001",
      });
      expect(scrape.statusCode, scrape.body).toBe(200);
      expect(scrape.body).toContain("brawzer_sessions_live");
    } finally {
      await guarded.close();
    }
  });
});
