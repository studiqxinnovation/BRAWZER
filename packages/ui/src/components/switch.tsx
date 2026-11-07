"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import type { WithClassName } from "../lib/types";

/** On/off setting that applies immediately. Wrap in a <label> or give it an aria-label. */
export function Switch({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseSwitch.Root>>) {
  return (
    <BaseSwitch.Root
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-line-control p-0.5",
        "transition-colors duration-(--bw-duration-fast) ease-standard outline-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        "data-checked:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb className="size-4 rounded-full bg-white shadow-sm transition-[translate] duration-(--bw-duration-base) ease-emphasized data-checked:translate-x-4" />
    </BaseSwitch.Root>
  );
}
