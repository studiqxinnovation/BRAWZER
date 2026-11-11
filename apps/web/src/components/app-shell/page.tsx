import { FormMessage } from "@brawzer/ui/components/form-message";
import { cn } from "@brawzer/ui/lib/cn";
import type { ReactNode } from "react";
import { PageCrumb } from "./page-crumb";

export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ad-page mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12", className)}>
      {children}
    </div>
  );
}

/**
 * A page's title and what it's for. On the desktop it's drawn as the
 * prototype's page head: the menu it's in ("Browse"), then the title.
 */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="ad-page-head mb-8 sm:mb-10">
      <PageCrumb />
      <h1 className="text-title-1 text-balance text-ink">{title}</h1>
      {children && (
        <div className="mt-2 max-w-2xl text-body text-pretty text-ink-secondary">{children}</div>
      )}
    </div>
  );
}

export function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-title-3 text-ink">
      {children}
    </h2>
  );
}

/** The prototype's row of stat cards at the top of a page (.pg-grid). */
export function StatCards({ children }: { children: ReactNode }) {
  return <div className="ad-stats">{children}</div>;
}

/** One stat card (.pg-card): a label, a big figure, and a line or a bar under it. */
export function StatCard({
  label,
  value,
  children,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="ad-stat" aria-label={label}>
      <h2 className="ad-stat-label">{label}</h2>
      <p className="ad-stat-big">{value}</p>
      {children && <div className="ad-stat-small">{children}</div>}
    </section>
  );
}

/** A plain bordered surface for one block of content. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface", className)}>{children}</div>
  );
}

/** Shown when the API can't be reached while rendering a signed-in page. */
export function Unavailable() {
  return (
    <FormMessage tone="danger" title="This can’t be loaded right now">
      Brawzer’s servers can’t be reached. Wait a moment, then reload the page.
    </FormMessage>
  );
}
