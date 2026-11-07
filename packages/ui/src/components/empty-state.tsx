import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Heading element, chosen to fit the page outline. */
  titleAs?: "h2" | "h3" | "h4" | "p";
  className?: string;
}

/** Shown where content will appear: says what belongs here and how to add it. */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  titleAs: Title = "h3",
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon && (
        <div
          aria-hidden="true"
          className="mb-4 flex size-11 items-center justify-center rounded-full bg-hover text-ink-secondary [&_svg]:size-5"
        >
          {icon}
        </div>
      )}
      <Title className="text-body font-semibold text-ink">{title}</Title>
      {description && (
        <div className="mt-1.5 max-w-sm text-callout text-ink-secondary">{description}</div>
      )}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
