import { AppWindow, Ban, KeyRound, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { Callout, CtaBand } from "@/components/site/blocks";
import { Container, PageHero, SectionIntro, SpecList } from "@/components/site/layout-primitives";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why Brawzer exists: a safer way to use the internet on computers you don’t own, without leaving your browsing behind.",
  alternates: { canonical: "/about" },
};

const principles = [
  {
    icon: <AppWindow />,
    title: "The browser is the product",
    description:
      "Brawzer is a browser, not a remote computer. Everything is designed to feel like browsing, because that’s what you came to do.",
  },
  {
    icon: <ShieldCheck />,
    title: "Security, explained honestly",
    description:
      "We say exactly what Brawzer protects and what it can’t. No “invisible”, no “zero footprint”, no promises a website can’t keep.",
  },
  {
    icon: <KeyRound />,
    title: "Your data is yours",
    description:
      "Your profiles and files exist to serve you. We keep what’s needed to run the service and protect your account, and nothing for advertising.",
  },
  {
    icon: <Ban />,
    title: "Nothing from third parties",
    description:
      "Brawzer’s pages load no outside trackers, scripts or fonts. What you see comes from Brawzer alone.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About"
        title="Why Brawzer exists."
        lede="Millions of people go online every day on computers they don’t own. Brawzer is built so they can do that without leaving their browsing behind."
      />

      <section aria-labelledby="story-title" className="border-t border-line py-20 sm:py-28">
        <Container className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:gap-20">
          <h2 id="story-title" className="text-title-1 text-balance text-ink">
            A shared computer shouldn’t keep your life.
          </h2>
          <div className="space-y-5 text-body-lg text-pretty text-ink-secondary">
            <p>
              Internet cafés, libraries, hotels, universities and shared offices put a computer in
              front of people who need one. Using it means trusting software you can’t see, and
              leaving behind traces you can’t fully remove: cookies, saved sign-ins, history,
              downloads.
            </p>
            <p>
              Brawzer moves the browser off the computer. The websites you open run in a browser
              that belongs to you, in the cloud. The computer in front of you shows the page and
              passes on your typing. When you leave, your browsing leaves with you.
            </p>
            <p>
              It can’t make an untrusted computer safe, and we’ll always say so. What it can do is
              keep the most valuable part of your online life somewhere that machine can’t reach.
            </p>
          </div>
        </Container>
      </section>

      <section
        aria-labelledby="principles-title"
        className="border-y border-line bg-canvas-subtle py-20 sm:py-28"
      >
        <Container>
          <SectionIntro id="principles-title" eyebrow="Principles" title="How we build Brawzer." />
          <SpecList className="mt-12" items={principles} />
        </Container>
      </section>

      <section aria-labelledby="status-title" className="py-20 sm:py-28">
        <Container className="max-w-3xl">
          <h2 id="status-title" className="text-title-2 text-ink">
            Where Brawzer is today
          </h2>
          <Callout className="mt-6">
            Brawzer is in development. The website, accounts and the cloud browser are being built
            in stages, each tested before the next begins. This site will say plainly when Brawzer
            is ready to use.
          </Callout>
        </Container>
      </section>

      <CtaBand
        title="Browse anywhere. Leave nothing behind."
        body="See how the cloud browser works, and what it means for the computers you use every day."
        secondary={{ href: "/product", label: "See the product" }}
      />
    </>
  );
}
