import type { SVGProps } from "react";
import { cn } from "../lib/cn";
import {
  activeConcept,
  APERTURE_PATH,
  type BrandConceptId,
  STACK_PATH,
  SWEEP_DOT,
  SWEEP_PATH,
  SWEEP_STROKE_WIDTH,
} from "./concepts";

/** The shapes of one concept, in `currentColor`, for use inside a 32-unit SVG. */
export function ConceptGlyph({ concept }: { concept: BrandConceptId }) {
  switch (concept) {
    case "stack":
      return <path d={STACK_PATH} fill="currentColor" />;
    case "aperture":
      return <path d={APERTURE_PATH} fill="currentColor" fillRule="evenodd" />;
    case "sweep":
      return (
        <>
          <path
            d={SWEEP_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth={SWEEP_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={SWEEP_DOT.cx} cy={SWEEP_DOT.cy} r={SWEEP_DOT.r} fill="currentColor" />
        </>
      );
  }
}

export interface MarkProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  concept?: BrandConceptId;
  size?: number | string;
  /**
   * Accessible name. Leave it out when the mark sits next to the "Brawzer"
   * wordmark: it is then decorative and hidden from assistive technology.
   */
  title?: string;
}

/** The Brawzer symbol on its own. Inherits colour from the surrounding text. */
export function Mark({
  concept = activeConcept,
  size = 32,
  title,
  className,
  ...props
}: MarkProps) {
  const accessibility = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      focusable="false"
      className={cn("shrink-0", className)}
      {...accessibility}
      {...props}
    >
      <ConceptGlyph concept={concept} />
    </svg>
  );
}
