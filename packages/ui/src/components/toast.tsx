"use client";

import { Toast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { cn } from "../lib/cn";

/** Wrap the app once. Toasts auto-dismiss after five seconds by default. */
export const ToastProvider = Toast.Provider;

/**
 * Shows notifications: `useToast().add({ title, description, type })`.
 * `type` is "success", "error" or omitted for neutral information.
 */
export const useToast = Toast.useToastManager;

function ToastIcon({ type }: { type: string | undefined }) {
  if (type === "success")
    return <CircleCheck aria-hidden="true" className="size-[1.125rem] text-success" />;
  if (type === "error")
    return <CircleAlert aria-hidden="true" className="size-[1.125rem] text-danger" />;
  return <Info aria-hidden="true" className="size-[1.125rem] text-ink-secondary" />;
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className={cn(
        "w-full rounded-xl border border-line bg-surface-raised p-4 text-ink shadow-lg outline-none select-none",
        "[transform:translateX(var(--toast-swipe-movement-x,0px))] transition-[opacity,translate,transform] duration-(--bw-duration-base) ease-emphasized",
        "data-ending-style:opacity-0 data-limited:hidden data-starting-style:translate-y-3 data-starting-style:opacity-0",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-px flex">
          <ToastIcon type={toast.type} />
        </span>
        <div className="min-w-0 flex-1">
          <Toast.Title className="text-callout font-semibold text-ink">{toast.title}</Toast.Title>
          {toast.description && (
            <Toast.Description className="mt-0.5 text-footnote text-ink-secondary">
              {toast.description}
            </Toast.Description>
          )}
        </div>
        <Toast.Close
          aria-label="Dismiss notification"
          className="-mt-1 -mr-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-tertiary outline-none hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          <X aria-hidden="true" className="size-4" />
        </Toast.Close>
      </div>
    </Toast.Root>
  ));
}

/** Renders active toasts in the bottom-right corner. Place once inside <ToastProvider>. */
export function ToastViewport() {
  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 outline-none">
        <ToastList />
      </Toast.Viewport>
    </Toast.Portal>
  );
}
