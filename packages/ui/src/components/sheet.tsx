"use client";

import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { type ComponentProps, createContext, type ReactNode, useContext } from "react";
import { cn } from "../lib/cn";
import type { WithClassName } from "../lib/types";

type Side = "left" | "right";
const SideContext = createContext<Side>("left");

export interface SheetProps extends Omit<ComponentProps<typeof BaseDrawer.Root>, "swipeDirection"> {
  /** Edge the panel slides in from; it can be swiped back the same way. */
  side?: Side;
}

/** A panel that slides in from the edge of the screen, e.g. navigation on small screens. */
export function Sheet({ side = "left", ...props }: SheetProps) {
  return (
    <SideContext value={side}>
      <BaseDrawer.Root swipeDirection={side} {...props} />
    </SideContext>
  );
}

export const SheetTrigger = BaseDrawer.Trigger;
export const SheetClose = BaseDrawer.Close;

export function SheetContent({ className, children }: { className?: string; children: ReactNode }) {
  const side = useContext(SideContext);
  return (
    <BaseDrawer.Portal>
      <BaseDrawer.Backdrop className="fixed inset-0 min-h-dvh bg-overlay opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-[420ms] ease-emphasized data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0 supports-[-webkit-touch-callout:none]:absolute" />
      <BaseDrawer.Viewport
        className={cn("fixed inset-0 flex", side === "left" ? "justify-start" : "justify-end")}
      >
        <BaseDrawer.Popup
          className={cn(
            "h-full w-[min(20rem,calc(100vw-3rem))] overflow-y-auto overscroll-contain bg-surface-raised text-ink shadow-xl outline-none",
            "[transform:translateX(var(--drawer-swipe-movement-x,0px))] transition-transform duration-[420ms] ease-emphasized data-swiping:duration-0 data-swiping:select-none",
            side === "left"
              ? "border-r border-line data-ending-style:[transform:translateX(-100%)] data-starting-style:[transform:translateX(-100%)]"
              : "border-l border-line data-ending-style:[transform:translateX(100%)] data-starting-style:[transform:translateX(100%)]",
            className,
          )}
        >
          <BaseDrawer.Content className="flex min-h-full flex-col p-5">
            {children}
          </BaseDrawer.Content>
        </BaseDrawer.Popup>
      </BaseDrawer.Viewport>
    </BaseDrawer.Portal>
  );
}

export function SheetTitle({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseDrawer.Title>>) {
  return <BaseDrawer.Title className={cn("text-title-3 text-ink", className)} {...props} />;
}

export function SheetDescription({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseDrawer.Description>>) {
  return (
    <BaseDrawer.Description
      className={cn("mt-1 text-callout text-ink-secondary", className)}
      {...props}
    />
  );
}
