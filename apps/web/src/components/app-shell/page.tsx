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
