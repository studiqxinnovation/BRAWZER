"use client";

import { useEffect, useState } from "react";

/**
 * How long Brawzer's servers take to answer from this computer, measured
 * here: the best of three quick checks, as the prototype's Latency card.
 */
export function Latency() {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const times: number[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const started = performance.now();
        try {
          await fetch("/api/v1/health", { cache: "no-store", signal: controller.signal });
          times.push(performance.now() - started);
        } catch {
          // Unreachable, or left the page: nothing to measure.
        }
      }
      const best = Math.min(...times);
      if (!controller.signal.aborted && Number.isFinite(best)) setMs(Math.round(best));
    })();
    return () => {
      controller.abort();
    };
  }, []);
  return (
    <p className="ad-stat-big" aria-live="polite">
      {ms === null ? "…" : `${String(ms)} ms`}
    </p>
  );
}
