import {
  Bookmark,
  Clock,
  Cookie,
  Database,
  Globe,
  HardDrive,
  Puzzle,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import type { Metadata } from "next";
import { CtaBand } from "@/components/site/blocks";
import { ProfileAvatar, ProfileStack } from "@/components/site/illustrations";
import { Container, PageHero, SectionIntro, SpecList } from "@/components/site/layout-primitives";

export const metadata: Metadata = {
  title: "Browser profiles",
  description:
    "Profiles are separate browsers inside your Brawzer account, each with its own cookies, history, bookmarks, extensions and proxy.",
  alternates: { canonical: "/profiles" },
};

const keptApart = [
  {
    icon: Cookie,
    title: "Cookies and sign-ins",
    description: "Signed in to your bank in one profile, signed out in all the others.",
  },
  {
    icon: HardDrive,
    title: "Cache",
    description: "Each profile keeps its own copies of the sites it visits.",
  },
  {
    icon: Database,
    title: "Site storage",
    description: "Local and session storage never cross between profiles.",
  },
  {
    icon: Clock,
    title: "History",
    description: "What you visit in one profile doesn’t appear in another.",
  },
  {
    icon: Bookmark,
    title: "Bookmarks",
    description: "Organised for each profile, on any computer.",
  },
  {
    icon: SlidersHorizontal,
    title: "Preferences",
    description: "Home page, search engine, language and more.",
  },
  {
    icon: Puzzle,
    title: "Extensions",
    description: "Install an extension in one profile without exposing the rest.",
  },
  {
    icon: Globe,
    title: "Proxy",
    description: "A different network route for each profile, or none at all.",
  },
  {
    icon: ShieldCheck,
    title: "Privacy settings",
    description: "Cookie rules, permissions and tracking protection.",
  },
];

const ideas = [
  {
    icon: <ProfileAvatar initial="P" color="#4a5bd4" size="sm" />,
    title: "Personal",
    description: "Email, banking and social accounts, kept away from everything else.",
  },
  {
    icon: <ProfileAvatar initial="W" color="#237a6f" size="sm" />,
    title: "Work",
    description: "Company tools and sign-ins, with your employer’s proxy if you need one.",
  },
  {
    icon: <ProfileAvatar initial="R" color="#a2552a" size="sm" />,
    title: "Research",
    description: "Signed out of everything, browsing through a proxy in another country.",
  },
  {
    icon: <ProfileAvatar initial="S" color="#7b45b8" size="sm" />,
    title: "Shopping",
    description: "Store accounts and loyalty cards, with third-party cookies blocked.",
  },
  {
    icon: <ProfileAvatar initial="D" color="#2b4a8b" size="sm" />,
    title: "Development",
    description: "Test sites and developer extensions, separate from your real accounts.",
  },
];

export default function ProfilesPage() {
  return (
    <>
      <PageHero
        eyebrow="Browser profiles"
        title="One browser for every part of your life."
        lede="Profiles are separate browsers inside your Brawzer account. Sign in to your bank in Personal and your work tools in Work: they never see each other."
      >
        <ProfileStack className="max-w-lg" />
      </PageHero>

      <section
        aria-labelledby="apart-title"
        className="border-y border-line bg-canvas-subtle py-20 sm:py-28"
      >
        <Container>
          <SectionIntro
            id="apart-title"
            eyebrow="Isolation"
            title="What each profile keeps to itself."
          />
          <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {keptApart.map((item) => (
              <li key={item.title}>
                <item.icon aria-hidden="true" className="size-5 text-accent-ink" />
                <h3 className="mt-3 text-body font-semibold text-ink">{item.title}</h3>
                <p className="mt-1.5 text-callout text-pretty text-ink-secondary">
                  {item.description}
                </p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section aria-labelledby="ideas-title" className="py-20 sm:py-28">
        <Container>
          <SectionIntro id="ideas-title" eyebrow="Ideas" title="Profiles people tend to create." />
          <SpecList className="mt-12" items={ideas} />
        </Container>
      </section>

      <section aria-labelledby="anywhere-title" className="border-t border-line py-20 sm:py-28">
        <Container>
          <SectionIntro
            id="anywhere-title"
            eyebrow="On any computer"
            title="Your profiles travel with your account."
          >
            Profiles live in your account, not on a device. Open one on any computer and it’s
            exactly as you left it.
          </SectionIntro>
          <ul className="mt-10 grid max-w-3xl gap-4 text-body text-ink-secondary">
            <li className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent"
              />
              A profile runs on one device at a time. Opening it somewhere else moves it there, so
              nothing gets out of step.
            </li>
            <li className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent"
              />
              Forgot to close a profile on a shared computer? End that session from any other
              device.
            </li>
            <li className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent"
              />
              Profile data is encrypted and stored in Brawzer’s cloud, never on the computers you
              use.
            </li>
          </ul>
        </Container>
      </section>

      <CtaBand
        title="Set up your first profile."
        body="Start with one. Add more as you need them, each with its own settings and proxy."
        secondary={{ href: "/drive", label: "Explore Drive" }}
      />
    </>
  );
}
