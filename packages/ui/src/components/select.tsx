"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "../lib/cn";
import { popupSurface } from "../lib/popup";
import { inputClassName } from "./field";

export interface SelectOption<Value extends string = string> {
  value: Value;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<Value extends string> {
  label: string;
  options: readonly SelectOption<Value>[];
  value?: Value;
  defaultValue?: Value;
  onValueChange?: (value: Value) => void;
  placeholder?: string;
  name?: string;
  disabled?: boolean;
  /** Keeps the label for assistive technology while hiding it visually. */
  hideLabel?: boolean;
  className?: string;
}

/** A labelled select. Like a native macOS menu, the list opens aligned to the chosen item. */
export function Select<Value extends string>({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Select…",
  name,
  disabled,
  hideLabel = false,
  className,
}: SelectProps<Value>) {
  const isOption = (candidate: unknown): candidate is Value =>
    options.some((option) => option.value === candidate);

  return (
    <BaseSelect.Root
      items={options}
      value={value}
      defaultValue={defaultValue}
      name={name}
      disabled={disabled}
      onValueChange={(next) => {
        if (isOption(next)) onValueChange?.(next);
      }}
    >
      <div className={cn("flex flex-col gap-1.5", className)}>
        <BaseSelect.Label
          className={cn("text-callout font-medium text-ink", hideLabel && "sr-only")}
        >
          {label}
        </BaseSelect.Label>
        <BaseSelect.Trigger
          className={cn(
            inputClassName,
            "flex cursor-pointer items-center justify-between gap-2 text-left focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--bw-accent-soft)] data-popup-open:border-accent",
          )}
        >
          <BaseSelect.Value
            placeholder={placeholder}
            className="truncate data-placeholder:text-ink-tertiary"
          />
          <BaseSelect.Icon className="flex text-ink-tertiary">
            <ChevronsUpDown aria-hidden="true" className="size-4" />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      </div>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={6} className="z-50 outline-none select-none">
          <BaseSelect.Popup className={cn(popupSurface, "min-w-(--anchor-width) p-1")}>
            <BaseSelect.List className="max-h-[min(20rem,var(--available-height))] overflow-y-auto">
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-md py-1.5 pr-3 pl-2 text-callout text-ink outline-none select-none data-disabled:opacity-50 data-highlighted:bg-hover"
                >
                  <BaseSelect.ItemIndicator className="col-start-1 flex text-accent-ink">
                    <Check aria-hidden="true" className="size-4" />
                  </BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText className="col-start-2">{option.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
