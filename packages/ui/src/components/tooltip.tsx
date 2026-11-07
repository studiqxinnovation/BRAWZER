"use client";

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

/** Place once near the root so tooltips share open/close timing. */
export const TooltipProvider = BaseTooltip.Provider;

export interface TooltipProps {
  content: ReactNode;
  /** The element that triggers the tooltip, e.g. an icon button. It still needs its own accessible name. */
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
}

export function Tooltip({ content, children, side = "top", sideOffset = 8 }: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={sideOffset} className="z-50">
          <BaseTooltip.Popup className="origin-(--transform-origin) rounded-md bg-ink px-2 py-1 text-footnote font-medium text-canvas shadow-md transition-[opacity,scale] duration-(--bw-duration-fast) ease-standard data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-[0.96] data-starting-style:opacity-0">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
