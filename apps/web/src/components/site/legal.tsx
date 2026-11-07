import { DevState } from "@brawzer/ui/components/dev-state";
import type { ReactNode } from "react";
import { Container } from "./layout-primitives";

export interface LegalSection {
  title: string;
  body: ReactNode;
}

/** Layout for draft legal pages, clearly marked as not yet in force. */
export function LegalDraft({
  title,
  summary,
  sections,
}: {
  title: string;
  summary: string;
  sections: readonly LegalSection[];
}) {
  return (
    <Container className="max-w-3xl py-14 sm:py-24">
      <h1 className="text-title-1 text-ink sm:text-display-2">{title}</h1>
      <p className="mt-4 text-body-lg text-pretty text-ink-secondary">{summary}</p>
      <DevState
        className="mt-8"
        title="Draft for legal review. Not in force."
        milestone="Before launch"
        requires={[
          "Review by a qualified lawyer",
          "Company name, address and contact details",
          "Final hosting regions and retention periods",
        ]}
      >
        This draft describes how Brawzer is designed to handle these matters. It is not a legal
        agreement and does not bind you or Brawzer.
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
