"use client";

import { type ComponentProps, useSyncExternalStore } from "react";
import { cn } from "../lib/cn";
import { isApplePlatform } from "../lib/platform";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line bg-surface px-1 font-sans text-[0.75rem] leading-none font-medium text-ink-secondary shadow-[inset_0_-1px_0_var(--bw-line)]",
        className,
      )}
      {...props}
    />
  );
}

const subscribe = () => () => undefined;

/** "⌘" on Apple devices and "Ctrl" elsewhere. The server renders "Ctrl", then the client corrects it. */
export function useModifierKey(): "⌘" | "Ctrl" {
  return useSyncExternalStore(
    subscribe,
    () => (isApplePlatform() ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}

export function ModifierKey({ className }: { className?: string }) {
  const key = useModifierKey();
  return (
    <Kbd className={className}>
      <span aria-hidden="true">{key}</span>
      <span className="sr-only">{key === "⌘" ? "Command" : "Control"}</span>
    </Kbd>
  );
}
