"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { popupSurface } from "../lib/popup";
import type { WithClassName } from "../lib/types";

export const Popover = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;
export interface PopoverContentProps {
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
  className?: string;
  children: ReactNode;
}

export function PopoverContent({
  align = "center",
  side = "bottom",
  sideOffset = 8,
  className,
  children,
}: PopoverContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="z-50 outline-none"
      >
        <BasePopover.Popup className={cn(popupSurface, "w-72 p-4", className)}>
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}

export function PopoverTitle({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BasePopover.Title>>) {
  return (
    <BasePopover.Title
      className={cn("text-callout font-semibold text-ink", className)}
      {...props}
    />
  );
}

export function PopoverDescription({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BasePopover.Description>>) {
  return (
    <BasePopover.Description
      className={cn("mt-1 text-footnote text-ink-secondary", className)}
      {...props}
    />
  );
}
