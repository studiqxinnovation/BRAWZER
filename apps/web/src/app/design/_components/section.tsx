import type { ReactNode } from "react";

export interface SectionProps {
  id: string;
  index: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

export function Section({ id, index, title, description, children }: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 border-t border-line pt-12 pb-16"
    >
      <header className="mb-8 max-w-2xl">
        <p className="font-mono text-footnote text-ink-tertiary">{index}</p>
        <h2 id={`${id}-title`} className="mt-1 text-title-2 text-ink">
          {title}
        </h2>
        {description && (
          <div className="mt-2 text-body text-pretty text-ink-secondary">{description}</div>
        )}
      </header>
      {children}
    </section>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-4 text-callout font-semibold text-ink">{children}</h3>;
}

export const designSections = [
  { id: "logo", title: "Logo" },
  { id: "colour", title: "Colour" },
  { id: "typography", title: "Typography" },
  { id: "layout", title: "Layout" },
  { id: "motion", title: "Motion" },
  { id: "components", title: "Components" },
] as const;
