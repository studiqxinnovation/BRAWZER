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

interface Satellite {
  /** Its orbit: the ring's size relative to the planet, its tilt, and where it is on it. */
  ring: number;
  tilt: number;
  angle: number;
  /** Radians per second. */
  rate: number;
  size: number;
}

interface Station {
  /** Where on the planet's limb, in radians from straight up. */
  bearing: number;
  phase: number;
}

const SATELLITES: readonly Satellite[] = [
  { ring: 1.1, tilt: -0.22, angle: 0.4, rate: 0.085, size: 1.3 },
  { ring: 1.22, tilt: 0.14, angle: 2.6, rate: -0.06, size: 1.5 },
  { ring: 1.22, tilt: 0.14, angle: 5.1, rate: -0.06, size: 1.2 },
  { ring: 1.36, tilt: -0.06, angle: 3.9, rate: 0.045, size: 1.6 },
  { ring: 1.36, tilt: -0.06, angle: 1.1, rate: 0.045, size: 1.25 },
];

/** How flat the rings look: seen almost side-on, so they pass over the planet's face. */
const RING_SQUASH = 0.9;

const STATIONS: readonly Station[] = [
  { bearing: -0.42, phase: 0 },
  { bearing: 0.08, phase: 0.9 },
  { bearing: 0.5, phase: 1.6 },
];

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

/** Points on the planet's visible cap: cities, as lights at night. */
function makeCities(count: number, seed: number): { a: number; d: number; w: number }[] {
  const random = mulberry(seed);
  const cities: { a: number; d: number; w: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    // Clustered: most lights sit together, as coasts and cities do.
    const cluster = Math.floor(random() * 6);
    const centre = -0.75 + cluster * 0.3 + (random() - 0.5) * 0.08;
    cities.push({
      a: centre + (random() - 0.5) * 0.22,
      d: 0.955 + random() * 0.04,
      w: 0.3 + random() * 0.7,
    });
  }
  return cities;
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
 * and now and then a meteor; with `earth`, the planet along the bottom,
 * satellites on their rings and the network between them. Still for anyone
 * who prefers reduced motion, and asleep while the tab is hidden.
 */
export function StarField({ className, earth = false }: { className?: string; earth?: boolean }) {
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
    const cities = makeCities(140, 11);
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
      if (earth) drawEarth(time);
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

    /** Where a satellite is now, on its tilted ring around the planet. */
    function place(satellite: Satellite, seconds: number, cx: number, cy: number, radius: number) {
      const angle = satellite.angle + satellite.rate * seconds;
      const rx = radius * satellite.ring;
      const ry = rx * RING_SQUASH;
      const ox = Math.cos(angle) * rx;
      const oy = Math.sin(angle) * ry;
      return {
        x: cx + ox * Math.cos(satellite.tilt) - oy * Math.sin(satellite.tilt),
        y: cy + ox * Math.sin(satellite.tilt) + oy * Math.cos(satellite.tilt),
        // The near half of the ring passes in front of the planet.
        front: Math.sin(angle) > 0,
      };
    }

    /**
     * The planet's limb along the bottom, lit from the left with its night
     * side to the right, the atmosphere glowing over it, city lights on the
     * dark side; satellites on three rings, ground stations, and the faint
     * links and pulses of a network between them.
     */
    function drawEarth(time: number) {
      const seconds = reduced ? 0 : time / 1000;
      const radius = Math.max(width * 0.58, height * 0.85);
      const cx = width * 0.5;
      const cy = height + radius * 0.78;
      const inside = (x: number, y: number) => Math.hypot(x - cx, y - cy) < radius;

      // Rings behind the planet first, dashed and faint.
      for (const ring of [1.1, 1.22, 1.36]) {
        const tilt = SATELLITES.find((satellite) => satellite.ring === ring)?.tilt ?? 0;
        context.save();
        context.translate(cx, cy);
        context.rotate(tilt);
        context.strokeStyle = "rgba(160, 190, 255, 0.16)";
        context.lineWidth = 0.8;
        context.setLineDash([3, 9]);
        context.beginPath();
        context.ellipse(0, 0, radius * ring, radius * ring * RING_SQUASH, 0, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
      const positions = SATELLITES.map((satellite) => place(satellite, seconds, cx, cy, radius));
      // Satellites on the far side, dimmer, before the planet covers them.
      drawSatellites(positions, false, seconds);

      // The atmosphere: a halo outside the limb.
      const halo = context.createRadialGradient(cx, cy, radius * 0.94, cx, cy, radius * 1.12);
      halo.addColorStop(0, "rgba(90, 160, 255, 0)");
      halo.addColorStop(0.3, "rgba(100, 170, 255, 0.42)");
      halo.addColorStop(1, "rgba(90, 160, 255, 0)");
      context.fillStyle = halo;
      context.fillRect(0, 0, width, height);

      // The planet itself: deep blue, lit from the upper left.
      const body = context.createRadialGradient(
        cx - radius * 0.55,
        cy - radius * 0.9,
        radius * 0.1,
        cx,
        cy,
        radius,
      );
      body.addColorStop(0, "#1b4f9c");
      body.addColorStop(0.35, "#0d2d64");
      body.addColorStop(0.7, "#071a3c");
      body.addColorStop(1, "#040d20");
      context.fillStyle = body;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.fill();
      // Night falls across the right-hand side.
      const night = context.createLinearGradient(cx - radius * 0.2, 0, cx + radius * 0.7, 0);
      night.addColorStop(0, "rgba(2, 6, 16, 0)");
      night.addColorStop(1, "rgba(2, 6, 16, 0.85)");
      context.fillStyle = night;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.fill();
      // The bright limb where the atmosphere catches the sun.
      const limb = context.createLinearGradient(cx - radius, 0, cx + radius, 0);
      limb.addColorStop(0, "rgba(150, 200, 255, 0.9)");
      limb.addColorStop(0.55, "rgba(150, 200, 255, 0.55)");
      limb.addColorStop(1, "rgba(150, 200, 255, 0.05)");
      context.strokeStyle = limb;
      context.lineWidth = 1.6;
      context.beginPath();
      context.arc(cx, cy, radius, Math.PI * 1.05, Math.PI * 1.95);
      context.stroke();

      // City lights, brightest on the night side, each flickering a little.
      for (const [index, city] of cities.entries()) {
        const x = cx + Math.sin(city.a) * radius * city.d;
        const y = cy - Math.cos(city.a) * radius * city.d;
        if (y > height) continue;
        const dark = Math.min(1, Math.max(0.15, (x - (cx - radius * 0.2)) / (radius * 0.9)));
        const flicker = reduced ? 1 : 0.75 + 0.25 * Math.sin(seconds * 2.2 + index);
        context.fillStyle = `rgba(255, 214, 150, ${String(0.45 * city.w * dark * flicker + 0.12)})`;
        context.beginPath();
        context.arc(x, y, 0.8 + city.w * 0.9, 0, Math.PI * 2);
        context.fill();
      }

      // Ground stations on the limb: a mark and a ring that spreads and fades.
      const stationPoints = STATIONS.map((station) => ({
        x: cx + Math.sin(station.bearing) * radius,
        y: cy - Math.cos(station.bearing) * radius,
        phase: station.phase,
      }));
      for (const station of stationPoints) {
        const pulse = reduced ? 0.5 : (seconds * 0.5 + station.phase) % 1;
        context.strokeStyle = `rgba(120, 220, 255, ${String(0.5 * (1 - pulse))})`;
        context.lineWidth = 1;
        context.beginPath();
        context.arc(station.x, station.y, 3 + pulse * 18, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = "rgba(170, 235, 255, 0.95)";
        context.beginPath();
        context.arc(station.x, station.y, 2, 0, Math.PI * 2);
        context.fill();
      }

      // The network: links between what can see each other, with pulses along them.
      const nodes = [
        ...positions.filter((point) => point.front || !inside(point.x, point.y)),
        ...stationPoints,
      ];
      let link = 0;
      for (let a = 0; a < nodes.length; a += 1) {
        for (let b = a + 1; b < nodes.length; b += 1) {
          const from = nodes[a];
          const to = nodes[b];
          if (!from || !to) continue;
          const distance = Math.hypot(from.x - to.x, from.y - to.y);
          const reach = Math.min(width, height) * 0.42;
          if (distance > reach) continue;
          // No link through the planet.
          if (inside((from.x + to.x) / 2, (from.y + to.y) / 2)) continue;
          const strength = 1 - distance / reach;
          context.strokeStyle = `rgba(140, 190, 255, ${String(0.08 + strength * 0.22)})`;
          context.lineWidth = 0.8;
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.lineTo(to.x, to.y);
          context.stroke();
          const along = reduced ? 0.5 : (seconds * 0.35 + link * 0.29) % 1;
          context.fillStyle = `rgba(190, 225, 255, ${String(0.5 + strength * 0.5)})`;
          context.beginPath();
          context.arc(
            from.x + (to.x - from.x) * along,
            from.y + (to.y - from.y) * along,
            1.6,
            0,
            Math.PI * 2,
          );
          context.fill();
          link += 1;
        }
      }
      // Satellites on the near side, over everything.
      drawSatellites(positions, true, seconds);
    }

    /** A satellite: its body, two solar panels, and a light that blinks. */
    function drawSatellites(
      positions: readonly { x: number; y: number; front: boolean }[],
      front: boolean,
      seconds: number,
    ) {
      for (const [index, point] of positions.entries()) {
        if (point.front !== front) continue;
        const satellite = SATELLITES[index];
        if (!satellite) continue;
        const scale = (front ? 1 : 0.8) * satellite.size;
        const alpha = front ? 1 : 0.45;
        context.save();
        context.translate(point.x, point.y);
        context.rotate(satellite.tilt + (front ? 0.35 : -0.35));
        context.scale(scale, scale);
        context.fillStyle = `rgba(214, 226, 245, ${String(alpha)})`;
        context.fillRect(-3.5, -2.5, 7, 5);
        context.fillStyle = `rgba(90, 140, 230, ${String(alpha)})`;
        context.fillRect(-15, -2, 9, 4);
        context.fillRect(6, -2, 9, 4);
        context.strokeStyle = `rgba(214, 226, 245, ${String(alpha * 0.9)})`;
        context.lineWidth = 0.8;
        context.beginPath();
        context.moveTo(-6, 0);
        context.lineTo(-3.5, 0);
        context.moveTo(3.5, 0);
        context.lineTo(6, 0);
        context.stroke();
        const blink = reduced ? 1 : 0.5 + 0.5 * Math.sin(seconds * 3 + index * 1.7);
        context.fillStyle = `rgba(120, 220, 255, ${String(alpha * blink)})`;
        context.beginPath();
        context.arc(0, -4.5, 1.2, 0, Math.PI * 2);
        context.fill();
        context.restore();
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
  }, [earth]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
