"use client";

import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import type { WithClassName } from "../lib/types";

export const AlertDialog = BaseAlertDialog.Root;
export const AlertDialogTrigger = BaseAlertDialog.Trigger;
export const AlertDialogClose = BaseAlertDialog.Close;

/**
 * A dialog that needs an answer: confirming something consequential, or
 * reacting before time runs out. Unlike Dialog it doesn't close when the
 * backdrop is clicked.
 */
export function AlertDialogContent({
  className,
  children,
  ...props
}: WithClassName<ComponentProps<typeof BaseAlertDialog.Popup>>) {
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop className="fixed inset-0 min-h-dvh bg-overlay transition-opacity duration-(--bw-duration-base) ease-standard data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute" />
      <BaseAlertDialog.Popup
        className={cn(
          "fixed top-1/2 left-1/2 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface-raised p-6 text-ink shadow-xl outline-none",
          "transition-[opacity,scale] duration-(--bw-duration-base) ease-emphasized",
          "data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.96] data-starting-style:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
      </BaseAlertDialog.Popup>
    </BaseAlertDialog.Portal>
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseAlertDialog.Title>>) {
  return <BaseAlertDialog.Title className={cn("text-title-3 text-ink", className)} {...props} />;
}

export function AlertDialogDescription({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseAlertDialog.Description>>) {
  return (
    <BaseAlertDialog.Description
      className={cn("mt-2 text-callout text-ink-secondary", className)}
      {...props}
    />
  );
}

export function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
