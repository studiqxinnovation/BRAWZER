"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { motion } from "motion/react";
import { type ReactNode, useId } from "react";
import { cn } from "../lib/cn";

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
  icon?: ReactNode;
  /** Show only the icon; the label remains the accessible name. */
  iconOnly?: boolean;
}

export interface SegmentedControlProps<Value extends string> {
  "aria-label": string;
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  className?: string;
}

/**
 * A row of mutually exclusive options with a sliding selection, like a macOS
 * segmented control. One option is always selected.
 */
export function SegmentedControl<Value extends string>({
  "aria-label": ariaLabel,
  options,
  value,
  onValueChange,
  className,
}: SegmentedControlProps<Value>) {
  const indicatorId = useId();

  return (
    <ToggleGroup
      aria-label={ariaLabel}
      value={[value]}
      onValueChange={(next: unknown[]) => {
        const selected = options.find((option) => next.includes(option.value));
        // Pressing the active option would leave nothing selected; keep it.
        if (selected && selected.value !== value) onValueChange(selected.value);
      }}
      className={cn("inline-flex rounded-lg border border-line bg-canvas-subtle p-0.5", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Toggle
            key={option.value}
            value={option.value}
            aria-label={option.iconOnly ? option.label : undefined}
            className={cn(
              "relative inline-flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 text-footnote font-medium text-ink-secondary",
              "transition-colors duration-(--bw-duration-fast) ease-standard outline-none hover:text-ink data-pressed:text-ink",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
              "[&_svg]:size-3.5 [&_svg]:shrink-0",
              option.iconOnly && "w-8 px-0",
            )}
          >
            {selected && (
              <motion.span
                layoutId={indicatorId}
                aria-hidden="true"
                // z-0 + labels at z-[1]: while sliding past other options the
                // highlight stays underneath every label, not just its own.
                className="absolute inset-0 z-0 rounded-md bg-surface shadow-sm ring-1 ring-line"
                transition={{ type: "spring", bounce: 0.12, duration: 0.32 }}
              />
            )}
            <span className="relative z-[1] inline-flex items-center gap-1.5">
              {option.icon}
              {option.iconOnly ? null : option.label}
            </span>
          </Toggle>
        );
      })}
    </ToggleGroup>
  );
}
