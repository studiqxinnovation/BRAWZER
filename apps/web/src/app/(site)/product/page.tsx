import {
  AppWindow,
  Bookmark,
  Clock,
  Download,
  EyeOff,
  Globe,
  HardDriveDownload,
  Keyboard,
  KeyRound,
  Layers,
  Maximize2,
  MonitorSmartphone,
  PanelTop,
  Puzzle,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { Metadata } from "next";
import { CtaBand } from "@/components/site/blocks";
import { BrowserPreview } from "@/components/site/browser-preview";
import { Container, PageHero, SectionIntro, SpecList } from "@/components/site/layout-primitives";

export const metadata: Metadata = {
  title: "Product",
  description:
    "Brawzer is a complete browser that runs on Brawzer’s servers and appears inside your web page, so websites never run on the computer you’re using.",
  alternates: { canonical: "/product" },
};

const browserFeatures = [
  {
    icon: <PanelTop />,
    title: "Tabs",
    description: "Open, reorder and restore tabs. Your session is waiting when you come back.",
  },
  {
    icon: <Search />,
    title: "Address bar",
    description:
      "Search or type an address, with the padlock and connection details always in view.",
  },
  {
    icon: <Bookmark />,
    title: "Bookmarks and history",
    description: "Kept separately for each profile and available on any computer you sign in to.",
  },
  {
    icon: <Download />,
    title: "Downloads",
    description: "Saved straight to Brawzer Drive instead of the computer’s disk.",
  },
  {
    icon: <Keyboard />,
    title: "Keyboard shortcuts",
    description:
      "Familiar shortcuts, adapted so they don’t collide with those of the computer’s own browser.",
  },
  {
    icon: <Maximize2 />,
    title: "Full screen",
    description: "Hide the computer’s own browser around Brawzer for a focused window.",
  },
  {
    icon: <EyeOff />,
    title: "Private windows",
    description: "Browse without keeping history, cookies or downloads, even in the cloud.",
  },
];

const modules = [
  {
    icon: AppWindow,
    title: "Browser",
    description: "Tabs, address bar, bookmarks, history and downloads in Brawzer’s own interface.",
  },
  {
    icon: Layers,
    title: "Profiles",
    description: "Separate browsers for work, personal life, research and anything else.",
  },
  {
    icon: Globe,
    title: "Proxy",
    description: "SOCKS5 and HTTP proxies for each profile, with live connection status.",
  },
  {
    icon: HardDriveDownload,
    title: "Drive",
    description: "Every download saved to the cloud, scanned and searchable.",
  },
  {
    icon: ShieldCheck,
    title: "Shield",
    description: "Your security centre: sessions, devices, alerts and activity.",
  },
  {
    icon: Puzzle,
    title: "Extensions",
    description: "Supported extensions, installed for each profile separately.",
  },
  {
    icon: MonitorSmartphone,
    title: "Sessions",
    description: "Every device that’s signed in, and the power to end any of them.",
  },
  {
    icon: KeyRound,
    title: "Account",
    description: "Passkeys, two-factor authentication, your plan and your storage.",
  },
];

const engines = [
  { name: "Chromium", basis: "Blink", status: "First release" },
  { name: "Firefox", basis: "Gecko", status: "Planned" },
  { name: "WebKit", basis: "WebKit", status: "Exploring" },
];

export default function ProductPage() {
  return (
    <>
      <PageHero
        eyebrow="Product"
        title="A real browser, running somewhere safer."
        lede="Brawzer is a complete browser with tabs, bookmarks, history, extensions and downloads. It runs on Brawzer’s servers and appears inside your web page, so websites never run on the computer you’re using."
      >
        <BrowserPreview idPrefix="product" />
      </PageHero>

      <section aria-labelledby="features-title" className="border-t border-line py-20 sm:py-28">
        <Container>
          <SectionIntro
            id="features-title"
            eyebrow="The browser"
            title="Everything you expect from a browser."
          >
            Brawzer draws its own tabs, address bar and menus on your screen. Only the page itself
            comes from the cloud, so it feels like a browser, not a remote computer.
          </SectionIntro>
          <SpecList className="mt-12" items={browserFeatures} />
        </Container>
      </section>

      <section
        aria-labelledby="modules-title"
        className="border-y border-line bg-canvas-subtle py-20 sm:py-28"
      >
        <Container>
          <SectionIntro
            id="modules-title"
            eyebrow="Your account"
            title="One account. Everything in it."
          >
            Each part of Brawzer has one job, and they work together in a single account.
          </SectionIntro>
          <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((module) => (
              <li key={module.title}>
                <module.icon aria-hidden="true" className="size-5 text-accent-ink" />
                <h3 className="mt-3 text-body font-semibold text-ink">{module.title}</h3>
                <p className="mt-1.5 text-callout text-pretty text-ink-secondary">
                  {module.description}
                </p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section aria-labelledby="engines-title" className="py-20 sm:py-28">
        <Container className="grid gap-12 lg:grid-cols-2 lg:gap-20">
          <SectionIntro id="engines-title" eyebrow="Engines" title="Chromium first. Firefox next.">
            Brawzer’s interface stays the same whichever engine runs underneath. Browsers such as
            Microsoft Edge are built on Chromium too, so they aren’t listed separately.
          </SectionIntro>
          <div className="self-end overflow-hidden rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-callout">
              <caption className="sr-only">Browser engines and their status</caption>
              <thead className="border-b border-line bg-canvas-subtle text-footnote text-ink-secondary">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Engine
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Built on
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {engines.map((engine) => (
                  <tr key={engine.name}>
                    <th scope="row" className="px-5 py-3.5 font-medium text-ink">
                      {engine.name}
                    </th>
                    <td className="px-5 py-3.5 text-ink-secondary">{engine.basis}</td>
                    <td className="px-5 py-3.5 text-ink-secondary">{engine.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      <section aria-labelledby="devices-title" className="border-t border-line py-20 sm:py-28">
        <Container className="grid gap-12 lg:grid-cols-2 lg:gap-20">
          <SectionIntro
            id="devices-title"
            eyebrow="Any device"
            title="Start in a library. Finish at home."
          >
            Your profiles live in your account, not on a computer. Sign in anywhere and they’re
            exactly as you left them. A profile runs on one device at a time, so nothing gets out of
            step.
          </SectionIntro>
          <ol className="self-end rounded-xl border border-line bg-surface">
            {[
              {
                place: "Library computer",
                time: "2:14 PM",
                what: "You sign out. Your tabs are saved with your profile.",
              },
              {
                place: "Your laptop",
                time: "6:40 PM",
                what: "You sign in. Same tabs, same sign-ins, same downloads.",
              },
              {
                place: "Any device",
                time: "Anytime",
                what: "Forgot to sign out somewhere? End that session from Sessions.",
              },
            ].map((step, index) => (
              <li
                key={step.place}
                className={index > 0 ? "border-t border-line px-5 py-4" : "px-5 py-4"}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-callout font-semibold text-ink">{step.place}</span>
                  <span className="flex items-center gap-1.5 text-footnote text-ink-tertiary">
                    <Clock aria-hidden="true" className="size-3.5" />
                    {step.time}
                  </span>
                </div>
                <p className="mt-1 text-callout text-ink-secondary">{step.what}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <CtaBand
        title="A browser that goes where you go."
        body="Set up your profiles once and use them on any computer, without leaving them behind."
        secondary={{ href: "/profiles", label: "Explore profiles" }}
      />
    </>
  );
}
