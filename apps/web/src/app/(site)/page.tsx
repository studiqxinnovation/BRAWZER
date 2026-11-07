import { buttonVariants } from "@brawzer/ui/lib/button-variants";
import type { Metadata } from "next";
import { CtaBand, FeatureSplit, Steps } from "@/components/site/blocks";
import { BrowserPreview } from "@/components/site/browser-preview";
import {
  DrivePanel,
  IsolationDiagram,
  ProfileStack,
  ProtectionLists,
  ProxyRoute,
} from "@/components/site/illustrations";
import { ArrowLink, Container, Eyebrow, SectionIntro } from "@/components/site/layout-primitives";
import { accountLinks, places } from "@/content/site";

export const metadata: Metadata = {
  title: { absolute: "Brawzer — Browse anywhere. Leave nothing behind." },
  description:
    "Brawzer runs your browser in the cloud. On a computer you don’t own, the screen is only a window: your profiles, history and downloads stay with you.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <section className="pt-16 pb-16 sm:pt-24 sm:pb-24">
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>The cloud browser</Eyebrow>
            <h1 className="mt-4 text-title-1 text-balance text-ink sm:text-display">
              Browse anywhere. Leave nothing behind.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-body-lg text-pretty text-ink-secondary">
              Brawzer runs your browser in the cloud. On a computer you don’t own — in a café, a
              library, a hotel — the screen in front of you is only a window. Your profiles, history
              and downloads stay with you.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <a
                href={accountLinks.createAccount}
                className={buttonVariants({ variant: "primary", size: "lg" })}
              >
                Get started
              </a>
              <a href="#how-it-works" className={buttonVariants({ size: "lg" })}>
                See how it works
              </a>
            </div>
          </div>
          <BrowserPreview className="mx-auto mt-16 max-w-5xl sm:mt-20" idPrefix="home" />
        </Container>
      </section>

      <section
        id="how-it-works"
        aria-labelledby="how-title"
        className="scroll-mt-20 border-y border-line bg-canvas-subtle py-20 sm:py-28"
      >
        <Container>
          <SectionIntro
            id="how-title"
            eyebrow="How it works"
            title="Your browser lives in the cloud. The computer only shows it."
          />
          <div className="mt-12">
            <IsolationDiagram />
          </div>
          <Steps
            className="mt-16"
            steps={[
              {
                title: "Sign in on any computer",
                body: "Open Brawzer in the computer’s browser and sign in. With a passkey on your phone, you never type a password on a shared keyboard.",
              },
              {
                title: "Open your browser",
                body: "Choose a profile and your Brawzer browser opens right in the page, with your tabs, bookmarks and sign-ins as you left them.",
              },
              {
                title: "Walk away",
                body: "Sign out when you’re done. Your cookies, history and downloads go with you: they were never on that computer.",
              },
            ]}
          />
        </Container>
      </section>

      <FeatureSplit
        id="profiles-title"
        eyebrow="Browser profiles"
        title="A separate browser for every part of your life."
        link={{ href: "/profiles", label: "Explore profiles" }}
        visual={<ProfileStack className="mx-auto max-w-md" />}
      >
        Work, personal, research, shopping. Each profile keeps its own cookies, history, bookmarks,
        extensions and proxy, completely apart from the others.
      </FeatureSplit>

      <FeatureSplit
        reverse
        id="drive-title"
        eyebrow="Brawzer Drive"
        title="Downloads that never touch the computer."
        link={{ href: "/drive", label: "Explore Drive" }}
        visual={<DrivePanel className="mx-auto max-w-md" />}
      >
        Files you download are saved to your Drive, scanned, and ready on your next device. Saving
        one to the computer in front of you is always your decision.
      </FeatureSplit>

      <FeatureSplit
        id="proxy-title"
        eyebrow="Proxy"
        title="Choose where your browsing comes from."
        link={{ href: "/product", label: "See everything in Brawzer" }}
        visual={<ProxyRoute className="mx-auto max-w-md" />}
      >
        Give any profile its own SOCKS5 or HTTP proxy. Credentials stay encrypted on Brawzer’s
        servers, and the connection status is always in view.
      </FeatureSplit>

      <section
        aria-labelledby="security-title"
        className="border-y border-line bg-canvas-subtle py-20 sm:py-28"
      >
        <Container>
          <SectionIntro
            id="security-title"
            eyebrow="Security"
            title="Clear about what we protect, and what we can’t."
          >
            Brawzer keeps your browsing off the computer you’re using. It can’t make that computer
            trustworthy, and we won’t pretend otherwise.
          </SectionIntro>
          <div className="mt-12">
            <ProtectionLists />
          </div>
          <div className="mt-8">
            <ArrowLink href="/security">Read how Brawzer is built</ArrowLink>
          </div>
        </Container>
      </section>

      <section aria-labelledby="places-title" className="py-20 sm:py-28">
        <Container className="text-center">
          <h2 id="places-title" className="text-title-1 text-balance text-ink sm:text-display-2">
            Made for the computers you don’t own.
          </h2>
          <ul className="mx-auto mt-10 flex max-w-4xl flex-wrap justify-center gap-3">
            {places.map((place) => (
              <li
                key={place}
                className="rounded-full border border-line bg-surface px-4 py-2 text-body text-ink"
              >
                {place}
              </li>
            ))}
          </ul>
          <p className="mx-auto mt-8 max-w-xl text-body-lg text-pretty text-ink-secondary">
            Anywhere you need a browser but can’t vouch for the machine.
          </p>
        </Container>
      </section>

      <CtaBand
        title="Your browser, wherever you are."
        body="Create an account, set up your first profile, and pick up where you left off on any computer."
        secondary={{ href: "/security", label: "Read about security" }}
      />
    </>
  );
}
