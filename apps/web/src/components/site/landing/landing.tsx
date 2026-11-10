import { buttonVariants } from "@brawzer/ui/lib/button-variants";
import { cn } from "@brawzer/ui/lib/cn";
import type { Route } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Steps } from "@/components/site/blocks";
import { BrowserPreview } from "@/components/site/browser-preview";
import { ProtectionLists } from "@/components/site/illustrations";
import { ArrowLink, Container, SectionIntro } from "@/components/site/layout-primitives";
import { accountLinks, places } from "@/content/site";
import { styles } from "./styles";
import { MotionRoot, Reveal, TiltCard, TiltStage } from "./motion";

const vars = (values: Record<string, string>) => values as CSSProperties;

function Emoji({ children, className }: { children: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn(styles.emoji, className)}>
      {children}
    </span>
  );
}

/** Things Brawzer does today, each one real: the band under the hero. */
const capabilities = [
  ["🐝", "Bee Browser, built on Chromium"],
  ["🦊", "Firefox, if you prefer"],
  ["🎭", "Profiles with their own cookies"],
  ["📁", "Downloads saved to Drive, scanned"],
  ["🌍", "A proxy for any profile"],
  ["🛡️", "Site rules you set"],
  ["🔑", "Passkeys and two-factor"],
  ["🕘", "History only you can read"],
  ["🔀", "Continue on another device"],
  ["👥", "Team accounts"],
  ["🧩", "Reviewed extensions"],
  ["🔊", "Sound from the page"],
] as const;

const placeEmoji: Record<(typeof places)[number], string> = {
  "Internet cafés": "☕",
  Libraries: "📚",
  Hotels: "🏨",
  Universities: "🎓",
  "Shared offices": "🏢",
  "Co-working spaces": "💻",
};

function Hero() {
  return (
    <section aria-labelledby="hero-title" className={cn(styles.stage, "pb-14 sm:pb-20")}>
      <div aria-hidden="true" className={styles.aurora}>
        <div className={cn(styles.blob, styles.blobBlue)} />
        <div className={cn(styles.blob, styles.blobViolet)} />
        <div className={cn(styles.blob, styles.blobHoney)} />
        <div className={cn(styles.blob, styles.blobTeal)} />
      </div>
      <div aria-hidden="true" className={styles.stars} />
      <div aria-hidden="true" className={cn(styles.stars, styles.starsFar)} />
      <div aria-hidden="true" className={styles.floor} />

      <Container className="relative pt-16 sm:pt-24">
        <div className="mx-auto max-w-4xl text-center">
          <p
            className={cn(
              styles.rise,
              styles.glass,
              "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-footnote font-semibold",
            )}
          >
            <Emoji>🐝</Emoji>
            Bee Browser · your browser, in Brawzer’s cloud
          </p>
          <h1
            id="hero-title"
            className={cn(
              styles.rise,
              "mt-7 text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-[4.5rem] lg:text-[5.75rem]",
            )}
            style={vars({ "--delay": "80ms" })}
          >
            <span className="block text-white">Browse anywhere.</span>{" "}
            <span className={styles.sheen} data-text="Leave nothing behind.">
              Leave nothing behind.
            </span>
          </h1>
          <p
            className={cn(
              styles.rise,
              "mx-auto mt-7 max-w-2xl text-body-lg text-pretty text-[#c3c8d6] sm:text-[1.3rem] sm:leading-8",
            )}
            style={vars({ "--delay": "180ms" })}
          >
            Brawzer runs your browser in the cloud. On a computer you don’t own, in a café, a
            library or a hotel, the screen in front of you is only a window. Your profiles, history
            and downloads stay with you.
          </p>
          <div
            className={cn(styles.rise, "mt-10 flex flex-wrap justify-center gap-3")}
            style={vars({ "--delay": "280ms" })}
          >
            <a
              href={accountLinks.createAccount}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), styles.glow)}
            >
              Get started
            </a>
            <a
              href="#how-it-works"
              className={cn(
                styles.glass,
                "inline-flex h-11 items-center justify-center rounded-lg px-5 text-callout font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
              )}
            >
              See how it works
            </a>
          </div>
        </div>

        <div
          className={cn(styles.rise, "relative mx-auto mt-16 max-w-5xl sm:mt-20")}
          style={vars({ "--delay": "380ms" })}
        >
          <TiltStage>
            <div className={styles.float}>
              <div aria-hidden="true" className={styles.halo} />
              <div className={styles.window}>
                <BrowserPreview idPrefix="home" />
              </div>
              <div aria-hidden="true">
                <span
                  className={cn(styles.chip, "top-[52%] -left-[7%] hidden sm:flex")}
                  style={vars({ "--z": "140px", "--delay": "-1s" })}
                >
                  <Emoji>🛡️</Emoji> Isolated in the cloud
                </span>
                <span
                  className={cn(styles.chip, "-top-4 right-[6%] hidden md:flex")}
                  style={vars({ "--z": "190px", "--delay": "-3s" })}
                >
                  <Emoji>🔐</Emoji> History only you can read
                </span>
                <span
                  className={cn(styles.chip, "-right-[4%] bottom-[12%] hidden md:flex")}
                  style={vars({ "--z": "170px", "--delay": "-2s" })}
                >
                  <Emoji>📁</Emoji> Saved to Brawzer Drive
                </span>
                <span
                  className={cn(styles.chip, "-bottom-5 left-[8%] flex")}
                  style={vars({ "--z": "120px", "--delay": "-4s" })}
                >
                  <Emoji>✨</Emoji> Only pixels reach this screen
                </span>
              </div>
            </div>
          </TiltStage>
        </div>
      </Container>

      <div className={cn(styles.marquee, "relative mt-20 sm:mt-28")}>
        <ul aria-label="What Brawzer does" className={styles.track}>
          {[...capabilities, ...capabilities].map(([emoji, label], index) => (
            <li
              key={`${label}-${String(index)}`}
              aria-hidden={index >= capabilities.length ? true : undefined}
              className={cn(
                styles.glass,
                "flex items-center gap-2 rounded-full px-4 py-2 text-callout font-medium whitespace-nowrap",
              )}
            >
              <Emoji>{emoji}</Emoji>
              {label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const flowNodes = [
  {
    emoji: "💻",
    title: "The computer in front of you",
    body: "Shows the page’s pixels and sends your clicks and keys. Nothing else.",
    turn: "14deg",
  },
  {
    emoji: "🐝",
    title: "Your browser, in Brawzer’s cloud",
    body: "Runs in its own isolated container, with your profile’s cookies and sign-ins.",
    turn: "0deg",
  },
  {
    emoji: "🌐",
    title: "The web",
    body: "Websites see Brawzer’s cloud, or the proxy you chose, never that computer.",
    turn: "-14deg",
  },
] as const;

function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 py-20 sm:py-28">
      <Container>
        <Reveal>
          <SectionIntro
            id="how-title"
            eyebrow="How it works"
            title="Your browser lives in the cloud. The computer only shows it."
          />
        </Reveal>
        <Reveal delay={120}>
          <div
            className={cn(
              styles.flow,
              "mt-14 flex flex-col items-stretch md:flex-row md:items-center",
            )}
          >
            {flowNodes.map((node, index) => (
              <div key={node.title} className="contents">
                {index > 0 && (
                  <div aria-hidden="true" className="flex items-center md:w-24 md:shrink-0 md:px-1">
                    <div className={styles.beam}>
                      <span className={styles.packet} style={vars({ "--delay": "0ms" })} />
                      <span className={styles.packet} style={vars({ "--delay": "-1300ms" })} />
                    </div>
                  </div>
                )}
                <div
                  className={cn(
                    styles.node,
                    "flex-1 rounded-2xl border border-line bg-surface p-6 text-center shadow-sm",
                  )}
                  style={vars({ "--turn": node.turn })}
                >
                  <span
                    className={cn(styles.tile, "mx-auto")}
                    style={vars({
                      "--from": index === 1 ? "#ffd27a" : "#9db8ff",
                      "--to": index === 1 ? "#e8a020" : "#3366e8",
                    })}
                  >
                    <Emoji>{node.emoji}</Emoji>
                  </span>
                  <h3 className="mt-4 text-body font-semibold text-ink">{node.title}</h3>
                  <p className="mt-2 text-callout text-pretty text-ink-secondary">{node.body}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={200}>
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
        </Reveal>
      </Container>
    </section>
  );
}

function FeatureCard({
  emoji,
  colors,
  title,
  link,
  visual,
  className,
  delay,
  children,
}: {
  emoji: string;
  colors: [string, string];
  title: string;
  link?: { href: Route; label: string };
  visual?: ReactNode;
  className?: string;
  delay: number;
  children: ReactNode;
}) {
  return (
    <Reveal delay={delay} className={className}>
      <TiltCard className="flex h-full flex-col rounded-[1.75rem] border border-line bg-surface p-7 shadow-sm sm:p-8">
        <span className={styles.tile} style={vars({ "--from": colors[0], "--to": colors[1] })}>
          <Emoji>{emoji}</Emoji>
        </span>
        <h3 className="mt-6 text-title-3 text-balance text-ink">{title}</h3>
        <p className="mt-3 text-callout text-pretty text-ink-secondary">{children}</p>
        {visual && <div className="mt-6 flex-1">{visual}</div>}
        {link && (
          <div className="mt-6">
            <ArrowLink href={link.href}>{link.label}</ArrowLink>
          </div>
        )}
      </TiltCard>
    </Reveal>
  );
}

const fan = [
  { name: "Work", from: "#5b8cff", to: "#2b4fc7", r: "-10deg", x: "-62%", z: "0px" },
  { name: "Personal", from: "#3fd0b4", to: "#0f7a80", r: "-3deg", x: "-20%", z: "20px" },
  { name: "Research", from: "#b794ff", to: "#6d3fd6", r: "4deg", x: "22%", z: "40px" },
  { name: "Shopping", from: "#ffb27a", to: "#c25a22", r: "11deg", x: "62%", z: "60px" },
] as const;

function ProfileFan() {
  return (
    <div aria-hidden="true" className={styles.fan}>
      {fan.map((card) => (
        <div
          key={card.name}
          className={styles.fanCard}
          style={vars({
            "--from": card.from,
            "--to": card.to,
            "--r": card.r,
            "--x": card.x,
            "--z": card.z,
          })}
        >
          <span className="flex items-center gap-2 text-callout">
            <span className="grid size-6 place-items-center rounded-full bg-white/25 text-footnote">
              {card.name[0]}
            </span>
            {card.name}
          </span>
          <span className="mt-3 block h-1.5 w-3/4 rounded-full bg-white/35" />
          <span className="mt-1.5 block h-1.5 w-1/2 rounded-full bg-white/25" />
        </div>
      ))}
    </div>
  );
}

function DriveDrop() {
  return (
    <div aria-hidden="true" className="flex items-end justify-center gap-3 pt-6">
      {[
        ["📄", "0ms"],
        ["🖼️", "-1200ms"],
        ["📊", "-2400ms"],
      ].map(([icon, delay]) => (
        <span
          key={icon}
          className={cn(
            styles.drop,
            "text-2xl grid size-12 place-items-center rounded-xl border border-line bg-canvas-subtle",
          )}
          style={vars({ "--delay": delay ?? "0ms" })}
        >
          <Emoji>{icon ?? ""}</Emoji>
        </span>
      ))}
      <span className="ml-2 flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-footnote font-medium text-success">
        ✓ Scanned
      </span>
    </div>
  );
}

const teamMembers = [
  ["🧑‍💻", "#9db8ff", "#3366e8"],
  ["👩‍🎨", "#ffb3c7", "#d6336c"],
  ["🧑‍🔬", "#7ee0cf", "#0f7a80"],
  ["👨‍🏫", "#ffd27a", "#e07a1f"],
  ["👩‍💼", "#c4b5fd", "#7c3aed"],
] as const;

function TeamVisual() {
  return (
    <div aria-hidden="true" className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <div className="flex -space-x-3">
        {teamMembers.map(([emoji, from, to], index) => (
          <span
            key={emoji}
            className={cn(
              styles.drop,
              "text-2xl grid size-12 place-items-center rounded-full border-2 border-surface shadow-md",
            )}
            style={vars({
              background: `linear-gradient(150deg, ${from}, ${to})`,
              "--delay": `${String(-index * 300)}ms`,
            })}
          >
            <Emoji>{emoji}</Emoji>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          ["💳", "One plan"],
          ["🌍", "Shared proxies"],
          ["📁", "Shared Drive"],
        ].map(([emoji, label]) => (
          <span
            key={label}
            className="flex items-center gap-1.5 rounded-full border border-line bg-canvas-subtle px-3 py-1.5 text-footnote font-medium text-ink"
          >
            <Emoji>{emoji ?? ""}</Emoji>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Features() {
  return (
    <section
      aria-labelledby="features-title"
      className="border-y border-line bg-canvas-subtle py-20 sm:py-28"
    >
      <Container>
        <Reveal>
          <SectionIntro
            id="features-title"
            eyebrow="Everything in one browser"
            title="Built for people who use other people’s computers."
          >
            Profiles, files, history and the people you work with, all kept in your account and
            nowhere else.
          </SectionIntro>
        </Reveal>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          <FeatureCard
            className="md:col-span-2"
            delay={0}
            emoji="🎭"
            colors={["#c4b5fd", "#7c3aed"]}
            title="A separate browser for every part of your life."
            link={{ href: "/profiles", label: "Explore profiles" }}
            visual={<ProfileFan />}
          >
            Work, personal, research, shopping. Each profile keeps its own cookies, history,
            bookmarks, extensions and proxy, completely apart from the others.
          </FeatureCard>
          <FeatureCard
            delay={100}
            emoji="📁"
            colors={["#9db8ff", "#3366e8"]}
            title="Downloads that never touch the computer."
            link={{ href: "/drive", label: "Explore Drive" }}
            visual={<DriveDrop />}
          >
            Files you download are saved to your Drive, scanned, and ready on your next device.
          </FeatureCard>
          <FeatureCard
            delay={0}
            emoji="🦊"
            colors={["#ffd27a", "#e07a1f"]}
            title="Bee Browser, or Firefox."
            link={{ href: "/product", label: "See everything in Brawzer" }}
          >
            Bee is Brawzer’s own browser, built on Chromium. Prefer Firefox? Choose it for any
            profile.
          </FeatureCard>
          <FeatureCard
            delay={100}
            emoji="🕘"
            colors={["#7ee0cf", "#0f7a80"]}
            title="History only you can read."
          >
            Each profile’s history and bookmarks are encrypted with its own key. Search them across
            sessions, forget one page, or clear the lot.
          </FeatureCard>
          <FeatureCard
            delay={200}
            emoji="🔀"
            colors={["#ffb3c7", "#d6336c"]}
            title="Pick up on the next computer."
          >
            Hand a session’s open tabs to your next device and carry on exactly where you left off.
          </FeatureCard>
          <FeatureCard
            className="md:col-span-3"
            delay={0}
            emoji="👥"
            colors={["#a5f3a1", "#2f9e44"]}
            title="Bring your team."
            visual={<TeamVisual />}
          >
            One plan for everyone, with shared proxies and a shared Drive. Each person’s profiles,
            sign-ins and sessions stay their own.
          </FeatureCard>
        </div>
      </Container>
    </section>
  );
}

function Security() {
  return (
    <section aria-labelledby="security-title" className="py-20 sm:py-28">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_auto]">
          <Reveal>
            <SectionIntro
              id="security-title"
              eyebrow="Security"
              title="Clear about what we protect, and what we can’t."
            >
              Brawzer keeps your browsing off the computer you’re using. It can’t make that computer
              trustworthy, and we won’t pretend otherwise.
            </SectionIntro>
          </Reveal>
          <div aria-hidden="true" className="relative mx-auto hidden size-48 lg:block">
            <div className={styles.ring} />
            <div className="absolute inset-4 grid place-items-center rounded-full bg-surface shadow-lg">
              <span className={cn(styles.emoji, "text-6xl")}>🛡️</span>
            </div>
          </div>
        </div>
        <Reveal delay={120}>
          <div className="mt-12">
            <ProtectionLists />
          </div>
          <div className="mt-8">
            <ArrowLink href="/security">Read how Brawzer is built</ArrowLink>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

function Places() {
  return (
    <section
      aria-labelledby="places-title"
      className="relative overflow-hidden border-y border-line bg-canvas-subtle py-20 sm:py-28"
    >
      <Container className="text-center">
        <div aria-hidden="true" className="relative mx-auto size-64 sm:size-72">
          <div className="absolute inset-[18%] rounded-full border border-dashed border-line-strong" />
          <div className="absolute inset-[38%] grid place-items-center rounded-full bg-surface shadow-lg">
            <span className={cn(styles.emoji, "text-4xl")}>🐝</span>
          </div>
          <div className={styles.orbit}>
            {places.map((place, index) => (
              <span
                key={place}
                className={styles.orbitItem}
                style={vars({
                  "--a": `${String((360 / places.length) * index)}deg`,
                  "--radius": "7.5rem",
                })}
              >
                <span className={cn(styles.emoji, "border border-line bg-surface shadow-sm")}>
                  {placeEmoji[place]}
                </span>
              </span>
            ))}
          </div>
        </div>
        <Reveal>
          <h2
            id="places-title"
            className="mt-10 text-title-1 text-balance text-ink sm:text-display-2"
          >
            Made for the computers you don’t own.
          </h2>
          <ul className="mx-auto mt-10 flex max-w-4xl flex-wrap justify-center gap-3">
            {places.map((place) => (
              <li
                key={place}
                className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-body text-ink"
              >
                <Emoji>{placeEmoji[place]}</Emoji>
                {place}
              </li>
            ))}
          </ul>
          <p className="mx-auto mt-8 max-w-xl text-body-lg text-pretty text-ink-secondary">
            Anywhere you need a browser but can’t vouch for the machine.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}

function FinalCall() {
  return (
    <section aria-labelledby="cta-title" className="py-20 sm:py-28">
      <Container>
        <Reveal>
          <div className={styles.border}>
            <div
              className={cn(
                styles.stage,
                "rounded-[calc(2rem-1.5px)] px-6 py-16 text-center sm:px-12 sm:py-20",
              )}
            >
              <div aria-hidden="true" className={styles.aurora}>
                <div className={cn(styles.blob, styles.blobBlue)} />
                <div className={cn(styles.blob, styles.blobHoney)} />
              </div>
              <h2
                id="cta-title"
                className="text-[2.25rem] leading-tight font-semibold tracking-[-0.035em] text-balance text-white sm:text-[3.25rem]"
              >
                Your browser, wherever you are.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-body-lg text-pretty text-[#c3c8d6]">
                Create an account, set up your first profile, and pick up where you left off on any
                computer.
              </p>
              <div className="mt-9 flex flex-wrap justify-center gap-3">
                <a
                  href={accountLinks.createAccount}
                  className={cn(buttonVariants({ variant: "primary", size: "lg" }), styles.glow)}
                >
                  Get started
                </a>
                <Link
                  href="/security"
                  className={cn(
                    styles.glass,
                    "inline-flex h-11 items-center justify-center rounded-lg px-5 text-callout font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                  )}
                >
                  Read about security
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

/** The home page: a dark 3D stage, then the product in the site's own theme. */
export function Landing() {
  return (
    <div className={styles.landing}>
      <MotionRoot />
      <Hero />
      <HowItWorks />
      <Features />
      <Security />
      <Places />
      <FinalCall />
    </div>
  );
}
