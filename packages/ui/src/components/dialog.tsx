"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import type { WithClassName } from "../lib/types";

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

/** Modal surface: traps focus, closes on Escape and returns focus to the trigger. */
export function DialogContent({
  className,
  children,
  ...props
}: WithClassName<ComponentProps<typeof BaseDialog.Popup>>) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 min-h-dvh bg-overlay transition-opacity duration-(--bw-duration-base) ease-standard data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute" />
      <BaseDialog.Popup
        className={cn(
          "fixed top-1/2 left-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface-raised p-6 text-ink shadow-xl outline-none",
          "transition-[opacity,scale] duration-(--bw-duration-base) ease-emphasized",
          "data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.96] data-starting-style:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogTitle({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseDialog.Title>>) {
  return <BaseDialog.Title className={cn("text-title-3 text-ink", className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseDialog.Description>>) {
  return (
    <BaseDialog.Description
      className={cn("mt-2 text-callout text-ink-secondary", className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
