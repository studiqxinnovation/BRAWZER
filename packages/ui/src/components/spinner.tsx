import { cn } from "../lib/cn";

export interface SpinnerProps {
  className?: string;
  /** Announced to screen readers. Omit when a parent already conveys the busy state. */
  label?: string;
}

export function Spinner({ className, label }: SpinnerProps) {
  const icon = (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      data-motion="essential"
      className={cn("size-4 animate-spin", className)}
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.5" />
      <path
        d="M14.25 8A6.25 6.25 0 0 0 8 1.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );

  if (!label) return icon;
  return (
    <span role="status" className="inline-flex">
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
