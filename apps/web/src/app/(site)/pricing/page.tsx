import { Check, Minus } from "lucide-react";
import type { Metadata } from "next";
import { CtaBand } from "@/components/site/blocks";
import { Container, PageHero } from "@/components/site/layout-primitives";
import { pricing } from "@/content/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "What every Brawzer plan will include. Plans and prices will be announced before launch.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <>
      <PageHero eyebrow="Pricing" title="Plans and pricing" lede={pricing.status} />

      <section aria-label="Plan details" className="pb-20 sm:pb-28">
        <Container className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-xl border border-line bg-surface p-6 sm:p-8">
            <h2 className="text-title-3 text-ink">Every plan will include</h2>
            <ul className="mt-6 divide-y divide-line">
              {pricing.included.map((item) => (
                <li key={item.title} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 size-[1.125rem] shrink-0 text-success"
                  />
                  <div>
                    <p className="text-body font-medium text-ink">{item.title}</p>
                    <p className="mt-0.5 text-callout text-ink-secondary">{item.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-line bg-canvas-subtle p-6 sm:p-8">
            <h2 className="text-title-3 text-ink">What will differ between plans</h2>
            <ul className="mt-6 space-y-3.5">
              {pricing.variesBy.map((item) => (
                <li key={item} className="flex gap-3 text-body text-ink-secondary">
                  <Minus aria-hidden="true" className="mt-1 size-4 shrink-0 text-ink-tertiary" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-8 border-t border-line pt-6 text-callout text-ink-secondary">
              Security protections are part of every plan. They are what Brawzer is for.
            </p>
          </div>
        </Container>
      </section>

      <CtaBand
        title="Be ready when Brawzer opens."
        body="Create an account now to set up your first profile as soon as the cloud browser is available."
        secondary={{ href: "/product", label: "See the product" }}
      />
    </>
  );
}
