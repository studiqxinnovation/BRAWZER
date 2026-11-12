"use client";

import { useEffect, useRef } from "react";

interface Star {
  /** Position as a share of the width and height, so a resize keeps the sky. */
  x: number;
  y: number;
  /** Radius in CSS pixels. */
  r: number;
  /** Brightness at rest, 0 to 1. */
  base: number;
  /** The twinkle: its phase and how fast it breathes. */
  phase: number;
  speed: number;
  /** A tint: white, a cool blue or a warm cream. */
  tint: readonly [number, number, number];
  /** How far the star drifts with the slow pan (the farther, the less). */
  depth: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  length: number;
}

const WHITE: readonly [number, number, number] = [255, 255, 255];
const TINTS: readonly (readonly [number, number, number])[] = [
  WHITE,
  WHITE,
  [205, 222, 255],
  [255, 241, 222],
];

/** A random number from a seed, so the same sky comes back after a resize. */
function mulberry(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStars(count: number, seed: number): Star[] {
  const random = mulberry(seed);
  const stars: Star[] = [];
  for (let index = 0; index < count; index += 1) {
    const size = random();
    // Most stars are faint points; a few are bright enough to flare.
    const r =
      size < 0.86 ? 0.45 + random() * 0.75 : size < 0.97 ? 1.2 + random() * 0.6 : 1.9 + random();
    stars.push({
      x: random(),
      y: random(),
      r,
      base: 0.35 + random() * 0.65,
      phase: random() * Math.PI * 2,
      speed: 0.4 + random() * 1.4,
      tint: TINTS[Math.floor(random() * TINTS.length)] ?? WHITE,
      depth: 0.3 + random() * 0.7,
    });
  }
  return stars;
}

/**
 * A night sky, drawn: stars that twinkle at their own pace, the bright ones
 * with a soft glow and a four-point flare, the whole field panning slowly,
 * and now and then a meteor. Still for anyone who prefers reduced motion,
 * and asleep while the tab is hidden.
 */
export function StarField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const mounted = ref.current;
    const painter = mounted?.getContext("2d");
    if (!mounted || !painter) return;
    // Named again so the hoisted functions below see them as never null.
    const canvas: HTMLCanvasElement = mounted;
    const context: CanvasRenderingContext2D = painter;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let ratio = 1;
    let stars: Star[] = [];
    let meteors: Meteor[] = [];
    let nextMeteor = 2_500 + Math.random() * 4_000;
    let frame = 0;
    let last = performance.now();
    let hidden = document.hidden;

    function resize() {
      const box = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(box.width));
      height = Math.max(1, Math.round(box.height));
      ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      stars = makeStars(Math.min(700, Math.round((width * height) / 3_800)), 7);
      if (reduced) draw(0);
    }

    function draw(time: number) {
      context.clearRect(0, 0, width, height);
      const pan = reduced ? 0 : time * 0.0025;
      for (const star of stars) {
        const twinkle = reduced ? 1 : 0.6 + 0.4 * Math.sin(time * 0.001 * star.speed + star.phase);
        const alpha = star.base * twinkle;
        // The field pans to the left, the deeper stars more slowly; it wraps around.
        const x = (((star.x * width - pan * star.depth) % width) + width) % width;
        const y = star.y * height;
        const [red, green, blue] = star.tint;
        if (star.r >= 1.2) {
          const glow = context.createRadialGradient(x, y, 0, x, y, star.r * 6);
          glow.addColorStop(
            0,
            `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(alpha * 0.55)})`,
          );
          glow.addColorStop(1, `rgba(${String(red)}, ${String(green)}, ${String(blue)}, 0)`);
          context.fillStyle = glow;
          context.fillRect(x - star.r * 6, y - star.r * 6, star.r * 12, star.r * 12);
        }
        if (star.r >= 1.9) {
          // The flare: two thin lines, brighter as the star brightens.
          const reach = star.r * (5 + 3 * twinkle);
          context.strokeStyle = `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(alpha * 0.5)})`;
          context.lineWidth = 0.7;
          context.beginPath();
          context.moveTo(x - reach, y);
          context.lineTo(x + reach, y);
          context.moveTo(x, y - reach);
          context.lineTo(x, y + reach);
          context.stroke();
        }
        context.fillStyle = `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(alpha)})`;
        context.beginPath();
        context.arc(x, y, star.r, 0, Math.PI * 2);
        context.fill();
      }
      for (const meteor of meteors) {
        const fade = Math.sin(Math.min(1, meteor.life) * Math.PI);
        const tailX = meteor.x - meteor.vx * meteor.length;
        const tailY = meteor.y - meteor.vy * meteor.length;
        const trail = context.createLinearGradient(tailX, tailY, meteor.x, meteor.y);
        trail.addColorStop(0, "rgba(255, 255, 255, 0)");
        trail.addColorStop(1, `rgba(255, 255, 255, ${String(0.85 * fade)})`);
        context.strokeStyle = trail;
        context.lineWidth = 1.4;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(meteor.x, meteor.y);
        context.stroke();
      }
    }

    function step(now: number) {
      const elapsed = Math.min(50, now - last);
      last = now;
      if (!hidden) {
        nextMeteor -= elapsed;
        if (nextMeteor <= 0) {
          nextMeteor = 5_000 + Math.random() * 7_000;
          const fromLeft = Math.random() < 0.5;
          const speed = 0.55 + Math.random() * 0.35;
          meteors.push({
            x: fromLeft ? width * (0.1 + Math.random() * 0.4) : width * (0.5 + Math.random() * 0.4),
            y: height * (0.05 + Math.random() * 0.35),
            vx: (fromLeft ? 1 : -1) * speed,
            vy: speed * 0.45,
            life: 0,
            length: 90 + Math.random() * 70,
          });
        }
        for (const meteor of meteors) {
          meteor.x += meteor.vx * elapsed;
          meteor.y += meteor.vy * elapsed;
          meteor.life += elapsed / 1_100;
        }
        meteors = meteors.filter((meteor) => meteor.life < 1);
        draw(now);
      }
      frame = requestAnimationFrame(step);
    }

    const onVisibility = () => {
      hidden = document.hidden;
      last = performance.now();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    if (!reduced) {
      document.addEventListener("visibilitychange", onVisibility);
      frame = requestAnimationFrame(step);
    }
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
