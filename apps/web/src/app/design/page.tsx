import { DevState } from "@brawzer/ui/components/dev-state";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandSection } from "./_components/brand-section";
import { ColorSection } from "./_components/color-section";
import { ComponentsSection } from "./_components/components-section";
import { DesignHeader, DesignNav } from "./_components/design-header";
import { LayoutSection } from "./_components/layout-section";
import { MotionSection } from "./_components/motion-section";
import { TypographySection } from "./_components/typography-section";

export const metadata: Metadata = { title: "Design system" };

const reviewSteps = [
  { href: "#logo", text: "Pick a logo concept: Stack, Aperture or Sweep." },
  { href: "#colour", text: "Pick an accent with the control at the top. The whole page follows." },
  { href: "#components", text: "Try the components in light and dark." },
] as const;

/** Development-only design review page. Excluded from production builds. */
export default function DesignPage() {
  if (process.env.NODE_ENV === "production" && process.env.BRAWZER_DEV_PAGES !== "enabled") {
    notFound();
  }

  return (
    <>
      <DesignHeader />
      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-12 px-5 sm:px-8 lg:grid-cols-[10rem_minmax(0,1fr)]">
        <DesignNav />
        <main id="content" tabIndex={-1} className="min-w-0 outline-none">
          <div className="pt-12 pb-14">
            <h1 className="text-title-1 text-ink sm:text-display-2">Design system</h1>
            <p className="mt-4 max-w-2xl text-body-lg text-pretty text-ink-secondary">
              The foundations every Brawzer screen is built from. Change the theme and accent at the
              top; everything on this page follows, including the measured contrast values.
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-line bg-surface p-5">
                <h2 className="text-callout font-semibold text-ink">Your review</h2>
                <ol className="mt-3 space-y-2">
                  {reviewSteps.map((step, index) => (
                    <li key={step.href} className="flex gap-3 text-callout text-ink-secondary">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-caption font-semibold text-accent-ink">
                        {index + 1}
                      </span>
                      <a href={step.href} className="rounded-sm hover:text-ink">
                        {step.text}
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
              <DevState title="Development-only page" milestone="Milestone 1.2">
                Excluded from production builds. Nothing here is connected to an account, and
                nothing is stored except your theme choice for this tab.
              </DevState>
            </div>
          </div>

          <BrandSection />
          <ColorSection />
          <TypographySection />
          <LayoutSection />
          <MotionSection />
          <ComponentsSection />
        </main>
      </div>
    </>
  );
}
