import { Construction } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface DevStateProps {
  title: string;
  children?: ReactNode;
  /** When the real implementation lands, e.g. "Milestone 1.3". */
  milestone?: string;
  /** Integrations still missing, in plain words. */
  requires?: readonly string[];
  className?: string;
}

/**
 * Marks anything that is not yet connected to real infrastructure, so a
 * placeholder can never be mistaken for a working feature. Remove it only
 * when the feature is implemented and tested.
 */
export function DevState({ title, children, milestone, requires, className }: DevStateProps) {
  return (
    <div
      role="note"
      aria-label={`Development state: ${title}`}
      className={cn(
        "rounded-lg border border-dashed border-[color-mix(in_srgb,var(--bw-warning)_45%,transparent)] bg-warning-soft px-4 py-3.5",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-caption font-semibold tracking-[0.06em] text-warning uppercase">
        <Construction aria-hidden="true" className="size-3.5" />
        <span>Development state</span>
        {milestone && (
          <span className="ml-auto font-medium tracking-normal text-ink-secondary normal-case">
            {milestone}
          </span>
        )}
      </div>
      <p className="mt-2 text-callout font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 text-footnote text-ink-secondary">{children}</div>}
      {requires && requires.length > 0 && (
        <div className="mt-3">
          <p className="text-footnote font-medium text-ink">Still needed:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-footnote text-ink-secondary">
            {requires.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
