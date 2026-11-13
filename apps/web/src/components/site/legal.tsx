import { DevState } from "@brawzer/ui/components/dev-state";
import type { ReactNode } from "react";
import { Container } from "./layout-primitives";

export interface LegalSection {
  title: string;
  body: ReactNode;
}

/**
 * Layout for the legal pages. Their facts are checked against the code; what
 * is still open is the operator's legal identity and the clauses only a
 * lawyer can settle, and the notice says so until they are.
 */
export function LegalDraft({
  title,
  summary,
  updated,
  sections,
}: {
  title: string;
  summary: string;
  /** The date of the current version, as shown. */
  updated: string;
  sections: readonly LegalSection[];
}) {
  return (
    <Container className="max-w-3xl py-14 sm:py-24">
      <h1 className="text-title-1 text-ink sm:text-display-2">{title}</h1>
      <p className="mt-4 text-body-lg text-pretty text-ink-secondary">{summary}</p>
      <p className="mt-3 text-footnote text-ink-tertiary">Version of {updated}</p>
      <DevState
        className="mt-8"
        title="Draft for legal review. Not in force."
        milestone="Before launch"
        requires={[
          "Review by a qualified lawyer",
          "The operator’s legal name, registered address and governing law",
        ]}
      >
        Everything factual here describes what Brawzer does today and is kept in step with the code.
        The parts in brackets wait for the operator’s lawyer. Until then this is a draft, not an
        agreement.
      </DevState>
      <div className="mt-12 space-y-10">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-title-3 text-ink">{section.title}</h2>
            <div className="mt-3 space-y-3 text-body text-pretty text-ink-secondary [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5">
              {section.body}
            </div>
          </section>
        ))}
      </div>
    </Container>
  );
}
