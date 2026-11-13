"use client";

import { useEffect, useState } from "react";

/**
 * A figure that counts up to its value as the page arrives (decimals kept),
 * the way the design has it. With "reduce motion", or without JavaScript, it
 * is simply the value.
 */
export function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (value === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now() + 200;
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(Math.max((now - start) / 700, 0), 1);
      setShown(value * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [value]);
  return (
    <span className="hm-count">
      <span className="sr-only">{value.toFixed(decimals)}</span>
      <span aria-hidden="true">
        {decimals > 0 ? shown.toFixed(decimals) : String(Math.floor(shown))}
      </span>
    </span>
  );
}
