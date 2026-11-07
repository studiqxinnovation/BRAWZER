import { cn } from "../lib/cn";
import { activeConcept, type BrandConceptId } from "./concepts";
import { ConceptGlyph, Mark } from "./mark";

export interface LogoProps {
  concept?: BrandConceptId;
  /** Wordmark font size in pixels. The mark scales with it. */
  size?: number;
  className?: string;
}

/**
 * Mark and wordmark lockup. The text is real text, so it is read by screen
 * readers and inherits colour; the mark beside it is decorative.
 */
export function Logo({ concept = activeConcept, size = 20, className }: LogoProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.38em] leading-none font-semibold tracking-[-0.032em] text-ink",
        className,
      )}
      style={{ fontSize: size }}
    >
      <Mark concept={concept} size="1.2em" />
      <span>Brawzer</span>
    </span>
  );
}

export interface AppIconProps {
  concept?: BrandConceptId;
  size?: number;
  /** graphite: the primary icon. accent: uses the active accent colour. */
  tone?: "graphite" | "accent";
  className?: string;
  /** Accessible name. Pass an empty string when the icon is decorative (e.g. next to a visible title). */
  title?: string;
}

/** Rounded-square app icon: the mark on a solid tile with a hairline highlight. */
export function AppIcon({
  concept = activeConcept,
  size = 64,
  tone = "graphite",
  className,
  title = "Brawzer",
}: AppIconProps) {
  const accessibility = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      {...accessibility}
    >
      <rect
        width="64"
        height="64"
        rx="14.4"
        fill={tone === "graphite" ? "#1c1b19" : "var(--bw-accent)"}
      />
      <rect
        x="0.5"
        y="0.5"
        width="63"
        height="63"
        rx="13.9"
        fill="none"
        stroke="rgb(255 255 255 / 0.09)"
      />
      <g transform="translate(12 12) scale(1.25)" color="#f8f7f4">
        <ConceptGlyph concept={concept} />
      </g>
    </svg>
  );
}
