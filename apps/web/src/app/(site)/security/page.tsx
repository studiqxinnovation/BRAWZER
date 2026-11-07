import {
  Box,
  Cookie,
  HardDriveDownload,
  KeyRound,
  Lock,
  Network,
  ShieldCheck,
  Ticket,
  UserRound,
  Waypoints,
} from "lucide-react";
import type { Metadata } from "next";
import { Callout, CtaBand } from "@/components/site/blocks";
import { IsolationDiagram, ProtectionLists } from "@/components/site/illustrations";
import { Container, PageHero, SectionIntro, SpecList } from "@/components/site/layout-primitives";

export const metadata: Metadata = {
  title: "Security",
  description:
    "What Brawzer protects on computers you don’t own, what it can’t protect against, and how it is built.",
  alternates: { canonical: "/security" },
};

const dataHandling = [
  {
    icon: <Cookie />,
    title: "Browsing data",
    description:
      "Cookies, site storage, history and bookmarks are stored with your profile and encrypted at rest.",
  },
  {
    icon: <HardDriveDownload />,
    title: "Downloads",
    description: "Stored in Brawzer Drive and scanned before you can open them.",
  },
  {
    icon: <KeyRound />,
    title: "Proxy credentials",
    description: "Encrypted on Brawzer’s servers and never sent to the computer you’re using.",
  },
  {
    icon: <UserRound />,
    title: "Security events",
    description:
      "Sign-ins, new devices and ended sessions are recorded so you can review them. The pages you visit are not part of this record.",
  },
  {
    icon: <ShieldCheck />,
    title: "Third parties",
    description:
      "Brawzer’s own pages load nothing from other companies: no advertising trackers, no external scripts, no external fonts.",
  },
];

const underTheHood = [
  {
    icon: <Box />,
    title: "One browser per session",
    description:
      "Every live session runs in its own isolated container. Containers are never shared between people.",
  },
  {
    icon: <ShieldCheck />,
    title: "Sandboxes stay on",
    description: "The browser’s own security sandbox stays enabled inside that container.",
  },
  {
    icon: <Ticket />,
    title: "Short-lived tickets",
    description:
      "Your screen connects to your session with a single-use ticket that expires within a minute.",
  },
  {
    icon: <Network />,
    title: "Filtered network access",
    description: "Your cloud browser can reach the internet, but not Brawzer’s internal network.",
  },
  {
    icon: <Waypoints />,
    title: "Encrypted in transit",
    description:
      "HTTPS for the website and API, and encrypted streams between your screen and your browser.",
  },
  {
    icon: <Lock />,
    title: "Encrypted at rest",
    description: "Profiles and Drive files are encrypted in storage.",
  },
];

const habits = [
  {
    title: "Sign in with your phone",
    body: "A passkey on your phone means you never type your password on a shared keyboard.",
  },
  {
    title: "Say it’s a shared computer",
    body: "Brawzer then forgets the sign-in when the browser closes and locks sooner when idle.",
  },
  {
    title: "Sign out when you’re done",
    body: "Or end the session later from any other device, if you forget.",
  },
  {
    title: "Check your devices",
    body: "Sessions shows every place you’re signed in. End anything you don’t recognise.",
  },
];

export default function SecurityPage() {
  return (
    <>
      <PageHero
        eyebrow="Security"
        title="Security, explained plainly."
        lede="Brawzer is built for computers you can’t trust. Here is what it protects, what it can’t, and how it works."
      >
        <Callout className="max-w-3xl">
          Brawzer is in development. This page describes how it is being built. An independent
          security review will be published before launch.
        </Callout>
      </PageHero>

      <section
        aria-labelledby="isolation-title"
        className="border-y border-line bg-canvas-subtle py-20 sm:py-28"
      >
        <Container>
          <SectionIntro
            id="isolation-title"
            eyebrow="Isolation"
            title="Websites run in the cloud. Your screen shows a picture."
          >
            When you open a website in Brawzer, it loads and runs on Brawzer’s servers, in a browser
            that belongs to you alone. The computer you’re using receives a live picture of the page
            and sends back your typing and clicks. The website’s code never reaches it.
          </SectionIntro>
          <div className="mt-12">
            <IsolationDiagram />
          </div>
        </Container>
      </section>

      <section aria-labelledby="limits-title" className="py-20 sm:py-28">
        <Container>
          <SectionIntro
            id="limits-title"
            eyebrow="Honest limits"
            title="What Brawzer protects, and what it can’t."
          >
            No service can make an untrusted computer safe. Brawzer keeps your browsing off it, and
            is clear about the risks that remain.
          </SectionIntro>
          <div className="mt-12">
            <ProtectionLists detailed />
          </div>
        </Container>
      </section>

      <section aria-labelledby="data-title" className="border-t border-line py-20 sm:py-28">
        <Container>
          <SectionIntro
            id="data-title"
            eyebrow="Your data"
            title="How Brawzer handles your data."
          />
          <SpecList className="mt-12" items={dataHandling} />
        </Container>
      </section>

      <section
        aria-labelledby="hood-title"
        className="border-y border-line bg-canvas-subtle py-20 sm:py-28"
      >
        <Container>
          <SectionIntro id="hood-title" eyebrow="For technical readers" title="Under the hood." />
          <SpecList className="mt-12" items={underTheHood} />
        </Container>
      </section>

      <section aria-labelledby="habits-title" className="py-20 sm:py-28">
        <Container>
          <SectionIntro id="habits-title" eyebrow="Good habits" title="On a shared computer." />
          <ol className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {habits.map((habit, index) => (
              <li key={habit.title} className="flex gap-4">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-footnote font-semibold text-accent-ink">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-body font-semibold text-ink">{habit.title}</h3>
                  <p className="mt-1 text-callout text-pretty text-ink-secondary">{habit.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <CtaBand
        title="Browse on any computer, carefully."
        body="Brawzer moves your browsing off machines you don’t control, and tells you plainly what it can and can’t do."
        secondary={{ href: "/product", label: "See the product" }}
      />
    </>
  );
}
