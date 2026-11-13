"use client";

import type { BrowserEngine } from "@brawzer/contracts";
import { cn } from "@brawzer/ui/lib/cn";
import type { StaticImageData } from "next/image";
import { useId } from "react";
import chromeLogo from "./logos/chrome.png";
import chromiumLogo from "./logos/chromium.png";
import edgeLogo from "./logos/edge.png";
import firefoxLogo from "./logos/firefox.svg";

/*
 * Each browser's own logo, taken from the browser itself (see logos/README.md),
 * to say which browser a profile or session is. The marks belong to their
 * makers and are used here only to name their browsers. Bee Browser's icon is
 * its own: a bee on honey, drawn here.
 */
const LOGOS: Record<Exclude<BrowserEngine, "bee">, StaticImageData> = {
  chrome: chromeLogo,
  edge: edgeLogo,
  chromium: chromiumLogo,
  firefox: firefoxLogo as StaticImageData,
};

const INK = "#1c1b19";
const HONEY_STRIPE = "#f6cf63";

/**
 * Bee Browser's own mark: a bee, drawn as a few plain shapes in ink on its
 * honey, with paper wings. Its own, not Brawzer's stack: the browser is one
 * of the browsers a Brawzer computer runs, beside Chrome and Firefox.
 */
export function BeeArt({ size, className }: { size: number | string; className?: string }) {
  const id = useId();
  // The body: an egg, wider at the shoulders, with the stripes clipped to it.
  const body =
    "M16 12.4c4.6 0 6.8 3.9 6.8 7.7 0 4.5-3 8.1-6.8 8.1s-6.8-3.6-6.8-8.1c0-3.8 2.2-7.7 6.8-7.7z";
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <defs>
        <clipPath id={`${id}-body`}>
          <path d={body} />
        </clipPath>
      </defs>
      {/* Wings, one each side, from the shoulders */}
      <ellipse
        cx="8.2"
        cy="15.4"
        rx="6.2"
        ry="3.4"
        transform="rotate(-40 8.2 15.4)"
        fill="#fff"
        fillOpacity="0.95"
      />
      <ellipse
        cx="23.8"
        cy="15.4"
        rx="6.2"
        ry="3.4"
        transform="rotate(40 23.8 15.4)"
        fill="#fff"
        fillOpacity="0.95"
      />
      {/* Antennae */}
      <path
        d="M14.3 6.6c-.4-1.9-1.5-3.2-3.3-3.8M17.7 6.6c.4-1.9 1.5-3.2 3.3-3.8"
        fill="none"
        stroke={INK}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Head */}
      <circle cx="16" cy="9.6" r="3.9" fill={INK} />
      {/* Body, two honey stripes, the sting */}
      <path d={body} fill={INK} />
      <g clipPath={`url(#${id}-body)`}>
        <rect x="8" y="16.8" width="16" height="2.5" fill={HONEY_STRIPE} />
        <rect x="8" y="21.4" width="16" height="2.5" fill={HONEY_STRIPE} />
      </g>
      <path d="M14.6 27.6 16 30l1.4-2.4z" fill={INK} />
    </svg>
  );
}

/** The honey tile Bee Browser's bee sits on, as an app icon would. */
const HONEY =
  "rounded-[24%] bg-[linear-gradient(150deg,#fbe27e_0%,#f4c55a_48%,#e9a43c_100%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.55),inset_0_-1px_0_rgb(160_90_0/0.25)]";

/** Bee's honey tile at any size: Bee Browser's icon, and Brawzer's in the app. */
export function BeeTile({ size, className }: { size: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-grid shrink-0 place-items-center", HONEY, className)}
      style={{ width: size, height: size }}
    >
      <BeeArt size={Math.round(size * 0.8)} />
    </span>
  );
}

/** An engine's logo, sized for chips (sm), lists (md) and cards (lg). */
export function EngineLogo({
  engine,
  size = "md",
  className,
}: {
  engine: BrowserEngine;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const pixels = size === "sm" ? 18 : size === "md" ? 26 : 44;
  if (engine === "bee") return <BeeTile size={pixels} {...(className ? { className } : {})} />;
  return (
    // A fixed-size local file: next/image's optimiser has nothing to add here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGOS[engine].src}
      width={pixels}
      height={pixels}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 select-none", className)}
    />
  );
}

/**
 * A browser's app icon, as a desktop shows it: Bee's bee on its honey tile,
 * and each other browser's own logo on a white tile.
 */
export function AppIconArt({ engine, className }: { engine: BrowserEngine; className?: string }) {
  if (engine === "bee") {
    return (
      <span aria-hidden="true" className={cn("bl-tile", HONEY, className)}>
        <BeeArt size="72%" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={cn("bl-tile bl-tile-logo", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGOS[engine].src} alt="" draggable={false} className="bl-tile-image" />
    </span>
  );
}
