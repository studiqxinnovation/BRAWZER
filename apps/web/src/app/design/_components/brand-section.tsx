import { AppIcon, brandConcepts, type BrandConceptId, Logo, Mark } from "@brawzer/ui/brand";
import { Badge } from "@brawzer/ui/components/badge";
import { X } from "lucide-react";
import { Section } from "./section";

/** A browser tab, so the favicon can be judged where it will actually live. */
function TabPreview({ concept, theme }: { concept: BrandConceptId; theme: "light" | "dark" }) {
  return (
    <div data-theme={theme} className="min-w-0 rounded-lg bg-canvas-subtle px-2 pt-2">
      <div className="flex h-8 items-center gap-2 rounded-t-md bg-surface px-2.5 shadow-xs">
        <AppIcon concept={concept} size={16} title="" />
        <span className="min-w-0 flex-1 truncate text-footnote text-ink">
          Brawzer — Browse anywhere
        </span>
        <X aria-hidden="true" className="size-3 text-ink-tertiary" />
      </div>
    </div>
  );
}

function ConceptCard({
  id,
  name,
  summary,
  rationale,
  recommended,
}: (typeof brandConcepts)[number]) {
  return (
    <article
      aria-labelledby={`concept-${id}`}
      className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface"
    >
      <div className="relative flex aspect-[4/3] items-center justify-center bg-canvas-subtle">
        {recommended && (
          <Badge tone="accent" className="absolute top-3 left-3">
            Recommended
          </Badge>
        )}
        <Mark concept={id} size={96} className="text-ink" />
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 id={`concept-${id}`} className="text-body font-semibold text-ink">
          {name}
        </h3>
        <p className="mt-1 text-callout text-ink-secondary">{summary}</p>
        <p className="mt-3 text-footnote text-ink-tertiary">{rationale}</p>

        <div
          className="mt-6 flex items-end gap-4"
          aria-label={`${name} app icon at 64, 32 and 16 pixels`}
          role="group"
        >
          <AppIcon concept={id} size={64} title={`${name} app icon, 64 px`} />
          <AppIcon concept={id} size={32} title={`${name} app icon, 32 px`} />
          <AppIcon concept={id} size={16} title={`${name} app icon, 16 px`} />
          <AppIcon
            concept={id}
            size={32}
            tone="accent"
            title={`${name} app icon on the accent colour`}
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2">
          <div
            data-theme="light"
            className="flex items-center justify-center rounded-lg border border-line bg-canvas py-5"
          >
            <Logo concept={id} size={17} />
          </div>
          <div
            data-theme="dark"
            className="flex items-center justify-center rounded-lg bg-canvas py-5"
          >
            <Logo concept={id} size={17} />
          </div>
        </div>

        <div className="mt-2 grid gap-2">
          <TabPreview concept={id} theme="light" />
          <TabPreview concept={id} theme="dark" />
        </div>
      </div>
    </article>
  );
}

export function BrandSection() {
  return (
    <Section
      id="logo"
      index="01"
      title="Logo"
      description={
        <>
          Three original directions, each drawn on a 32-unit grid so strokes land on whole pixels at
          favicon size. Every concept is shown at real sizes, on both themes, and in a browser tab.
          <strong className="font-semibold text-ink"> Your call: pick one</strong>, and it replaces
          the placeholder everywhere at once.
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {brandConcepts.map((concept) => (
          <ConceptCard key={concept.id} {...concept} />
        ))}
      </div>
      <p className="mt-4 max-w-2xl text-footnote text-ink-tertiary">
        The wordmark is set in Inter for now. Once a concept is chosen, the wordmark is drawn as
        outlines with custom spacing, so it no longer depends on a font file.
      </p>
    </Section>
  );
}
