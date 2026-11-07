import { cn } from "../lib/cn";

const toneClasses = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  accent: "bg-accent",
  neutral: "bg-ink-tertiary",
} as const;

export type StatusTone = keyof typeof toneClasses;

export interface StatusDotProps {
  tone?: StatusTone;
  /** A soft ripple for live states such as "connecting". Stops when reduced motion is on. */
  pulse?: boolean;
  /**
   * Accessible name. Omit it when visible text next to the dot already
   * states the status; colour alone must never carry meaning.
   */
  label?: string;
  className?: string;
}

export function StatusDot({ tone = "neutral", pulse = false, label, className }: StatusDotProps) {
  const accessibility = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} {...accessibility}>
      {pulse && (
        <span className={cn("absolute inset-0 animate-bw-pulse rounded-full", toneClasses[tone])} />
      )}
      <span className={cn("relative size-2 rounded-full", toneClasses[tone])} />
    </span>
  );
}
