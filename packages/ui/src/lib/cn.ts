import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge needs to know Brawzer's custom theme names; otherwise it
 * cannot tell that `text-callout` (a size) and `text-ink` (a colour) do not
 * conflict.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "caption",
        "footnote",
        "callout",
        "body",
        "body-lg",
        "title-3",
        "title-2",
        "title-1",
        "display-2",
        "display",
      ],
      color: [
        "canvas",
        "canvas-subtle",
        "surface",
        "surface-raised",
        "surface-sunken",
        "line",
        "line-strong",
        "line-control",
        "ink",
        "ink-secondary",
        "ink-tertiary",
        "ink-disabled",
        "accent",
        "accent-hover",
        "accent-ink",
        "accent-soft",
        "on-accent",
        "success",
        "success-soft",
        "warning",
        "warning-soft",
        "danger",
        "danger-soft",
        "danger-fill",
        "hover",
        "pressed",
        "focus",
        "overlay",
      ],
      radius: ["xs", "sm", "md", "lg", "xl", "2xl"],
      shadow: ["xs", "sm", "md", "lg", "xl"],
    },
  },
});

/** Joins class names and resolves conflicting Tailwind utilities (last wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
