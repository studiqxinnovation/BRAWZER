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
 * Brawzer's own: a bee on honey.
 */
const LOGOS: Record<Exclude<BrowserEngine, "bee">, StaticImageData> = {
  chrome: chromeLogo,
  edge: edgeLogo,
  chromium: chromiumLogo,
  firefox: firefoxLogo as StaticImageData,
};

const INK = "#1c1b19";
const POLLEN = "#ffd84a";

/** Bee Browser's bee, drawn in a 64-unit square, on whatever is behind it. */
export function BeeArt({ size, className }: { size: number | string; className?: string }) {
  const id = useId();
  const body = `${id}-body`;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <defs>
        <clipPath id={body}>
          <ellipse cx="32" cy="41.5" rx="11.5" ry="10.2" />
        </clipPath>
      </defs>
      {/* Wings, behind everything. */}
      <g fill="#fff" fillOpacity="0.94" stroke={INK} strokeOpacity="0.14" strokeWidth="0.8">
        <ellipse cx="19.6" cy="32.6" rx="10.4" ry="6.8" transform="rotate(-24 19.6 32.6)" />
        <ellipse cx="44.4" cy="32.6" rx="10.4" ry="6.8" transform="rotate(24 44.4 32.6)" />
      </g>
      {/* Antennae. */}
      <g stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M28.6 19.4 Q26.4 14.2 23.6 12.6" />
        <path d="M35.4 19.4 Q37.6 14.2 40.4 12.6" />
      </g>
      <circle cx="23.3" cy="12.4" r="1.9" fill={INK} />
      <circle cx="40.7" cy="12.4" r="1.9" fill={INK} />
      {/* Striped body and sting. */}
      <path d="M29.8 50.6 L32 55.2 L34.2 50.6 Z" fill={INK} />
      <ellipse cx="32" cy="41.5" rx="11.5" ry="10.2" fill={POLLEN} />
      <g clipPath={`url(#${body})`} fill={INK}>
        <rect x="18" y="38.4" width="28" height="3.8" />
        <rect x="18" y="45.6" width="28" height="3.8" />
      </g>
      {/* Head, eyes and a smile. */}
      <circle cx="32" cy="26.2" r="9.2" fill={INK} />
      <circle cx="28.3" cy="25.4" r="3.1" fill="#fff" />
      <circle cx="35.7" cy="25.4" r="3.1" fill="#fff" />
      <circle cx="28.9" cy="26" r="1.55" fill={INK} />
      <circle cx="36.3" cy="26" r="1.55" fill={INK} />
      <circle cx="29.4" cy="25.4" r="0.55" fill="#fff" />
      <circle cx="36.8" cy="25.4" r="0.55" fill="#fff" />
      <path
        d="M29.6 30.4 Q32 32.2 34.4 30.4"
        stroke={POLLEN}
        strokeWidth="1.3"
        strokeLinecap="round"
        fill="none"
      />
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
      <BeeArt size={Math.round(size * 0.86)} />
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
        <BeeArt size="76%" />
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
