import { cn } from "@brawzer/ui/lib/cn";
import { ArrowRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function Container({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-6xl px-6 sm:px-8", className)} {...props} />;
}

export function Section({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("py-20 sm:py-28", className)} {...props} />;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-callout font-semibold text-accent-ink", className)}>{children}</p>;
}

export interface SectionIntroProps {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
  id?: string;
  className?: string;
}

/** Eyebrow, heading and lede that open a section. */
export function SectionIntro({ eyebrow, title, children, id, className }: SectionIntroProps) {
  return (
    <div className={cn("max-w-2xl", className)}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 id={id} className="mt-3 text-title-1 text-balance text-ink sm:text-display-2">
        {title}
      </h2>
      {children && (
        <div className="mt-5 text-body-lg text-pretty text-ink-secondary">{children}</div>
      )}
    </div>
  );
}

export interface PageHeroProps {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

/** The opening of every page: one h1, a lede, optional actions and visual. */
export function PageHero({ eyebrow, title, lede, actions, children }: PageHeroProps) {
  return (
    <section className="pt-14 pb-16 sm:pt-24 sm:pb-20">
      <Container>
        <div className="max-w-3xl">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h1 className="mt-3 text-title-1 text-balance text-ink sm:text-display">{title}</h1>
          {lede && (
            <p className="mt-5 max-w-2xl text-body-lg text-pretty text-ink-secondary">{lede}</p>
          )}
          {actions && <div className="mt-8 flex flex-wrap gap-3">{actions}</div>}
        </div>
        {children && <div className="mt-14 sm:mt-20">{children}</div>}
      </Container>
    </section>
  );
}

export function ArrowLink({ href, children }: { href: Route; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1 rounded-sm text-callout font-medium text-accent-ink underline-offset-4 hover:underline"
    >
      {children}
      <ArrowRight
        aria-hidden="true"
        className="size-4 transition-transform duration-(--bw-duration-fast) group-hover:translate-x-0.5"
      />
    </Link>
  );
}

export interface SpecItem {
  icon: ReactNode;
  title: string;
  description: ReactNode;
}

/** A spec-sheet list: name on the left, explanation on the right, hairlines between. */
export function SpecList({ items, className }: { items: readonly SpecItem[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line border-y border-line", className)}>
      {items.map((item) => (
        <div key={item.title} className="grid gap-2 py-6 sm:grid-cols-[15rem_1fr] sm:gap-10">
          <dt className="flex items-center gap-3 text-body font-semibold text-ink [&_svg]:size-[1.125rem] [&_svg]:shrink-0 [&_svg]:text-ink-secondary">
            {item.icon}
            {item.title}
          </dt>
          <dd className="text-body text-pretty text-ink-secondary">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
