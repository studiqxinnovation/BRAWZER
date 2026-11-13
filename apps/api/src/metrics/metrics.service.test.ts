import { describe, expect, it } from "vitest";
import { MetricsService } from "./metrics.service.js";

describe("metrics", () => {
  it("renders counters, summaries and gauges in the exposition format", async () => {
    const metrics = new MetricsService();
    metrics.count("brawzer_sessions_started_total", "Sessions started.");
    metrics.count("brawzer_sessions_started_total", "Sessions started.");
    metrics.count("brawzer_sessions_ended_total", "Sessions ended, by reason.", { reason: "user" });
    metrics.count("brawzer_sessions_ended_total", "Sessions ended, by reason.", { reason: 'a"b' });
    metrics.observe("brawzer_scan_seconds", "Scanner time per file.", 0.25);
    metrics.observe("brawzer_scan_seconds", "Scanner time per file.", 0.75);
    metrics.gauge("brawzer_sessions_live", "Live sessions, by host.", () =>
      Promise.resolve([{ labels: { host: "local" }, value: 3 }]),
    );
    metrics.gauge("brawzer_broken", "A reader that fails is left out.", () =>
      Promise.reject(new Error("no")),
    );
    const text = await metrics.render();
    expect(text).toContain(
      "# TYPE brawzer_sessions_started_total counter\nbrawzer_sessions_started_total 2",
    );
    expect(text).toContain('brawzer_sessions_ended_total{reason="user"} 1');
    expect(text).toContain('brawzer_sessions_ended_total{reason="a\\"b"} 1');
    expect(text).toContain("brawzer_scan_seconds_sum 1\nbrawzer_scan_seconds_count 2");
    expect(text).toContain('brawzer_sessions_live{host="local"} 3');
    expect(text).not.toContain("brawzer_broken");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("refuses names Prometheus would", () => {
    const metrics = new MetricsService();
    expect(() => metrics.count("sessions started", "x")).toThrow();
  });
});
