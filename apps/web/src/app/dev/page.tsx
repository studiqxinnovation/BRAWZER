import { Logo } from "@brawzer/ui/brand";
import { DevState } from "@brawzer/ui/components/dev-state";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ThemeControl } from "@/components/appearance-controls";
import { SystemStatus } from "@/components/system-status";

export const metadata: Metadata = {
  title: "Development console",
  robots: { index: false, follow: false },
};

const apiOrigin = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100";
const mailpitUrl = `http://localhost:${process.env.MAILPIT_UI_PORT ?? "8125"}`;

const linkCard =
  "group flex flex-col rounded-xl border border-line bg-surface p-5 transition-[border-color,box-shadow] duration-(--bw-duration-fast) ease-standard hover:border-line-strong hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Development console: live stack status and links to developer tools. Not in production builds. */
export default function DevConsolePage() {
  if (process.env.NODE_ENV === "production" && process.env.BRAWZER_DEV_PAGES !== "enabled") {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pt-8 pb-12 sm:px-8 sm:pt-10">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" aria-label="Brawzer home" className="rounded-md">
          <Logo size={22} />
        </Link>
        <ThemeControl />
      </header>

      <main className="flex-1 pt-14 sm:pt-20">
        <h1 className="text-title-1 text-ink">Development console</h1>
        <p className="mt-3 max-w-xl text-body-lg text-ink-secondary">
          The state of your local Brawzer stack, and the tools that go with it.
        </p>

        <DevState className="mt-8" title="Development-only page" milestone="Phase 1">
          Excluded from production builds. It reads the API’s health through the web app, exactly as
          the browser would.
        </DevState>

        <SystemStatus className="mt-6" />

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Link href="/design" className={linkCard}>
            <span className="flex items-center justify-between text-callout font-semibold text-ink">
              Design system
              <ArrowRight aria-hidden="true" className="size-4 text-ink-tertiary" />
            </span>
            <span className="mt-1 text-footnote text-ink-secondary">
              Brand, tokens and components.
            </span>
          </Link>
          <a href={`${apiOrigin}/api/docs`} className={linkCard}>
            <span className="flex items-center justify-between text-callout font-semibold text-ink">
              API reference
              <ArrowUpRight aria-hidden="true" className="size-4 text-ink-tertiary" />
            </span>
            <span className="mt-1 text-footnote text-ink-secondary">Interactive OpenAPI docs.</span>
          </a>
          <a href={mailpitUrl} className={linkCard}>
            <span className="flex items-center justify-between text-callout font-semibold text-ink">
              Email inbox
              <ArrowUpRight aria-hidden="true" className="size-4 text-ink-tertiary" />
            </span>
            <span className="mt-1 text-footnote text-ink-secondary">
              Every email the stack sends.
            </span>
          </a>
        </div>
      </main>
    </div>
  );
}
