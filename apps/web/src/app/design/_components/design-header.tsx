import { Logo } from "@brawzer/ui/brand";
import { Badge } from "@brawzer/ui/components/badge";
import Link from "next/link";
import { AccentControl, ThemeControl } from "@/components/appearance-controls";
import { designSections } from "./section";

export function DesignHeader() {
  return (
    <>
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-callout font-medium text-ink shadow-md focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <header className="z-40 border-b border-line bg-canvas sm:sticky sm:top-0">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3 sm:px-8">
          <Link href="/" aria-label="Brawzer home" className="rounded-md">
            <Logo size={19} />
          </Link>
          <span aria-hidden="true" className="h-4 w-px bg-line-strong" />
          <span className="text-callout font-medium text-ink">Design system</span>
          <Badge tone="warning" className="hidden sm:inline-flex">
            Development preview
          </Badge>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <AccentControl />
            <ThemeControl />
          </div>
        </div>
      </header>
    </>
  );
}

export function DesignNav() {
  return (
    <nav aria-label="Design system sections" className="hidden lg:block">
      <ul className="sticky top-24 flex flex-col gap-0.5 pt-12">
        {designSections.map((section, index) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="flex items-center gap-3 rounded-md px-2.5 py-1.5 text-callout text-ink-secondary transition-colors duration-(--bw-duration-fast) hover:bg-hover hover:text-ink"
            >
              <span className="font-mono text-caption text-ink-tertiary">
                {String(index + 1).padStart(2, "0")}
              </span>
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
