import { buttonVariants } from "@brawzer/ui/lib/button-variants";
import { cn } from "@brawzer/ui/lib/cn";
import { Info } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { accountLinks } from "@/content/site";
import { ArrowLink, Container, Eyebrow } from "./layout-primitives";

export interface FeatureSplitProps {
  eyebrow: string;
  title: string;
  children: ReactNode;
  link?: { href: Route; label: string };
  visual: ReactNode;
  /** Put the visual on the left on large screens. */
  reverse?: boolean;
  id?: string;
}

/** Text on one side, an illustration on the other. Stacks on small screens. */
export function FeatureSplit({
  eyebrow,
  title,
  children,
  link,
  visual,
  reverse = false,
  id,
}: FeatureSplitProps) {
  return (
    <section aria-labelledby={id} className="py-16 sm:py-24">
      <Container className="grid items-center gap-10 lg:grid-cols-2 lg:gap-20">
        <div className={cn(reverse && "lg:order-2")}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 id={id} className="mt-3 text-title-1 text-balance text-ink">
            {title}
          </h2>
          <div className="mt-4 text-body-lg text-pretty text-ink-secondary">{children}</div>
          {link && (
            <div className="mt-6">
              <ArrowLink href={link.href}>{link.label}</ArrowLink>
            </div>
          )}
        </div>
        <div className={cn("min-w-0", reverse && "lg:order-1")}>{visual}</div>
      </Container>
    </section>
  );
}

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
          <Link
            href={accountLinks.createAccount}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            Get started
          </Link>
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
