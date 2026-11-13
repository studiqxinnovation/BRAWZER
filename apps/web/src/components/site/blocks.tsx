import { buttonVariants } from "@brawzer/ui/lib/button-variants";
import { cn } from "@brawzer/ui/lib/cn";
import { Info } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { accountLinks } from "@/content/site";
import { Container } from "./layout-primitives";

export interface CtaBandProps {
  title: string;
  body: string;
  secondary?: { href: Route; label: string };
}

/** Closing call to action on every marketing page. */
export function CtaBand({ title, body, secondary }: CtaBandProps) {
  return (
    <section aria-labelledby="cta-title" className="border-t border-line bg-canvas-subtle">
      <Container className="flex flex-col gap-8 py-20 sm:py-24 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h2 id="cta-title" className="text-title-1 text-balance text-ink sm:text-display-2">
            {title}
          </h2>
          <p className="mt-4 text-body-lg text-pretty text-ink-secondary">{body}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <a
            href={accountLinks.createAccount}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            Get started
          </a>
          {secondary && (
            <Link href={secondary.href} className={buttonVariants({ size: "lg" })}>
              {secondary.label}
            </Link>
          )}
        </div>
      </Container>
    </section>
  );
}

/** A quiet note for context that readers should not miss. */
export function Callout({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-xl border border-line bg-surface p-5 text-callout text-ink-secondary",
        className,
      )}
    >
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-ink" />
      <div>{children}</div>
    </div>
  );
}

export interface Step {
  title: string;
  body: string;
}

/** Numbered steps in a row, divided by hairlines. */
export function Steps({ steps, className }: { steps: readonly Step[]; className?: string }) {
  return (
    <ol className={cn("grid gap-8 md:grid-cols-3 md:gap-0 md:divide-x md:divide-line", className)}>
      {steps.map((step, index) => (
        <li key={step.title} className="md:px-8 md:first:pl-0 md:last:pr-0">
          <span className="font-mono text-footnote text-accent-ink">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h3 className="mt-2 text-body font-semibold text-ink">{step.title}</h3>
          <p className="mt-2 text-callout text-pretty text-ink-secondary">{step.body}</p>
        </li>
      ))}
    </ol>
  );
}
