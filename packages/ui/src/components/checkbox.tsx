"use client";

import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import type { WithClassName } from "../lib/types";

/** Wrap in a <label> with visible text, or give it an aria-label. */
export function Checkbox({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseCheckbox.Root>>) {
  return (
    <BaseCheckbox.Root
      className={cn(
        "flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border border-line-control bg-surface text-on-accent shadow-xs",
        "transition-[background-color,border-color] duration-(--bw-duration-fast) ease-standard outline-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        "data-checked:border-accent data-checked:bg-accent",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        "pointer-coarse:size-5",
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator className="flex data-unchecked:hidden">
        <Check aria-hidden="true" className="size-3 pointer-coarse:size-3.5" strokeWidth={3} />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}
