"use client";

import { useCallback, useState } from "react";
import { Section, SubHeading } from "./section";

// Class names are listed in full so Tailwind can find them.
const scale = [
  { name: "Display", className: "text-display", sample: "Browse anywhere." },
  { name: "Display 2", className: "text-display-2", sample: "Leave nothing behind." },
  { name: "Title 1", className: "text-title-1", sample: "Your browser, in the cloud" },
  { name: "Title 2", className: "text-title-2", sample: "Browser profiles" },
  { name: "Title 3", className: "text-title-3", sample: "Proxy settings" },
  {
    name: "Body large",
    className: "text-body-lg",
    sample: "Profiles keep work, shopping and research apart.",
  },
  {
    name: "Body",
    className: "text-body",
    sample: "Downloads go to Brawzer Drive, not this computer.",
  },
  { name: "Callout", className: "text-callout", sample: "Labels, buttons and menus." },
  { name: "Footnote", className: "text-footnote", sample: "Supporting details and table text." },
  { name: "Caption", className: "text-caption", sample: "Timestamps, badges and fine print." },
] as const;

/** Reports the size the browser actually renders, so this page can't drift from the CSS. */
function Specimen({ name, className, sample }: (typeof scale)[number]) {
  const [spec, setSpec] = useState("…");
  const measure = useCallback((node: HTMLParagraphElement | null) => {
    if (!node) return;
    const style = getComputedStyle(node);
    const size = Number.parseFloat(style.fontSize);
    const tracking = Number.parseFloat(style.letterSpacing) / size;
    const next = `${String(size)}/${style.lineHeight.replace("px", "")} · ${style.fontWeight} · ${
      Number.isFinite(tracking) ? tracking.toFixed(3) : "0"
    }em`;
    setSpec((previous) => (previous === next ? previous : next));
  }, []);

  return (
    <li className="grid gap-2 py-5 sm:grid-cols-[11.5rem_1fr] sm:gap-8">
      <div>
        <p className="text-callout font-medium text-ink">{name}</p>
        <p className="font-mono text-caption text-ink-tertiary">{spec}</p>
      </div>
      <p ref={measure} className={`${className} min-w-0 text-ink`}>
        {sample}
      </p>
    </li>
  );
}

export function TypographySection() {
  return (
    <Section
      id="typography"
      index="03"
      title="Typography"
      description="Inter for everything people read, with its optical sizes switching on automatically at display sizes; Geist Mono for addresses, keys and other technical values. Weights stay between 400 and 600."
    >
      <ul className="divide-y divide-line border-y border-line">
        {scale.map((entry) => (
          <Specimen key={entry.name} {...entry} />
        ))}
      </ul>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-6">
          <SubHeading>Inter · interface and reading</SubHeading>
          <p className="text-display text-ink" aria-hidden="true">
            Aa
          </p>
          <div className="mt-4 space-y-1 text-body text-ink">
            <p className="font-normal">Regular 400 — continuous reading</p>
            <p className="font-medium">Medium 500 — labels and controls</p>
            <p className="font-semibold">Semibold 600 — titles and emphasis</p>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6">
          <SubHeading>Geist Mono · technical values</SubHeading>
          <p className="font-mono text-display text-ink" aria-hidden="true">
            01
          </p>
          <div className="mt-4 space-y-1 font-mono text-callout text-ink">
            <p>socks5://203.0.113.42:1080</p>
            <p>a3f9-21c0-77de-41b8</p>
            <p>Session 2 h 14 min · 1.4 GB</p>
          </div>
        </div>
      </div>
    </Section>
  );
}
