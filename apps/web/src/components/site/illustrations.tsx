import { StatusDot } from "@brawzer/ui/components/status-dot";
import { cn } from "@brawzer/ui/lib/cn";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CircleCheck,
  Cloud,
  Eye,
  FileArchive,
  FileImage,
  FileText,
  Globe,
  Keyboard,
  Monitor,
  Plus,
  ScanEye,
  Search,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";

/* ── How isolation works ─────────────────────────────────────────────── */

function DiagramPanel({
  icon,
  title,
  items,
  tone,
}: {
  icon: ReactNode;
  title: string;
  items: readonly string[];
  tone: "neutral" | "accent";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-6">
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-full [&_svg]:size-5",
          tone === "accent" ? "bg-accent-soft text-accent-ink" : "bg-hover text-ink-secondary",
        )}
      >
        {icon}
      </div>
      <h3 className="mt-4 text-body font-semibold text-ink">{title}</h3>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-callout text-ink-secondary">
            <Check
              aria-hidden="true"
              className={cn(
                "mt-0.5 size-4 shrink-0",
                tone === "accent" ? "text-success" : "text-ink-tertiary",
              )}
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The public computer sees pixels; the website runs in Brawzer's cloud. */
export function IsolationDiagram() {
  return (
    <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr] md:gap-6">
      <DiagramPanel
        tone="neutral"
        icon={<Monitor aria-hidden="true" />}
        title="The computer in front of you"
        items={[
          "Shows a live picture of the page",
          "Sends your typing and clicks",
          "Holds none of your sites’ cookies or history",
        ]}
      />
      <div className="flex justify-center gap-8 py-1 text-footnote text-ink-secondary md:flex-col md:gap-4 md:py-0">
        <p className="flex items-center gap-2">
          <ArrowUp aria-hidden="true" className="size-4 text-accent-ink md:hidden" />
          <ArrowLeft aria-hidden="true" className="hidden size-4 text-accent-ink md:block" />
          Picture of the page
        </p>
        <p className="flex items-center gap-2">
          <ArrowDown aria-hidden="true" className="size-4 text-accent-ink md:hidden" />
          Typing and clicks
          <ArrowRight aria-hidden="true" className="hidden size-4 text-accent-ink md:block" />
        </p>
      </div>
      <DiagramPanel
        tone="accent"
        icon={<Cloud aria-hidden="true" />}
        title="Your Brawzer browser, in the cloud"
        items={[
          "Loads and runs every website",
          "Keeps your profiles, history and sign-ins",
          "Saves downloads to Brawzer Drive",
        ]}
      />
    </div>
  );
}

/* ── Profiles ────────────────────────────────────────────────────────── */

export const sampleProfiles = [
  { initial: "P", name: "Personal", detail: "4 tabs · Chromium", color: "#4a5bd4" },
  { initial: "W", name: "Work", detail: "Proxy · Frankfurt", color: "#237a6f" },
  {
    initial: "R",
    name: "Research",
    detail: "Proxy · Tokyo · signed out of everything",
    color: "#a2552a",
  },
  {
    initial: "S",
    name: "Shopping",
    detail: "2 tabs · third-party cookies blocked",
    color: "#7b45b8",
  },
] as const;

export function ProfileAvatar({
  initial,
  color,
  size = "md",
}: {
  initial: string;
  color: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        size === "md" ? "size-9 text-callout" : "size-6 text-caption",
      )}
      style={{ backgroundColor: color }}
    >
      {initial}
    </span>
  );
}

/** Illustration of the profile switcher. */
export function ProfileStack({ className }: { className?: string }) {
  return (
    <figure
      role="img"
      aria-label="Illustration: four browser profiles named Personal, Work, Research and Shopping, each with its own settings."
      className={cn("rounded-xl border border-line bg-surface shadow-lg", className)}
    >
      <div aria-hidden="true">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="text-callout font-semibold text-ink">Profiles</span>
          <span className="text-footnote text-ink-tertiary">4 profiles</span>
        </div>
        <ul className="p-2">
          {sampleProfiles.map((profile, index) => (
            <li
              key={profile.name}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5",
                index === 0 && "bg-accent-soft",
              )}
            >
              <ProfileAvatar initial={profile.initial} color={profile.color} />
              <div className="min-w-0 flex-1">
                <p className="text-callout font-medium text-ink">{profile.name}</p>
                {/* Tertiary text is too faint on the tinted row; use secondary there. */}
                <p
                  className={cn(
                    "truncate text-footnote",
                    index === 0 ? "text-ink-secondary" : "text-ink-tertiary",
                  )}
                >
                  {profile.detail}
                </p>
              </div>
              {index === 0 && (
                <span className="text-caption font-medium text-accent-ink">Open</span>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 border-t border-line px-5 py-3 text-footnote text-ink-secondary">
          <Plus className="size-4" />
          New profile
        </div>
      </div>
    </figure>
  );
}

/* ── Drive ───────────────────────────────────────────────────────────── */

const sampleFiles = [
  {
    icon: FileText,
    name: "Aurora-forecast.pdf",
    size: "284 KB",
    scanned: true,
    tint: "bg-danger-soft text-danger",
  },
  {
    icon: FileImage,
    name: "Boarding-pass.png",
    size: "1.2 MB",
    scanned: true,
    tint: "bg-accent-soft text-accent-ink",
  },
  {
    icon: FileText,
    name: "Lecture-notes.docx",
    size: "96 KB",
    scanned: true,
    tint: "bg-accent-soft text-accent-ink",
  },
  {
    icon: FileArchive,
    name: "Trip-photos.zip",
    size: "48 MB",
    scanned: false,
    tint: "bg-warning-soft text-warning",
  },
] as const;

/** Illustration of Brawzer Drive with scanned downloads. */
export function DrivePanel({ className }: { className?: string }) {
  return (
    <figure
      role="img"
      aria-label="Illustration: Brawzer Drive listing four downloaded files, three already scanned and one being scanned."
      className={cn("rounded-xl border border-line bg-surface shadow-lg", className)}
    >
      <div aria-hidden="true">
        <div className="flex items-center gap-4 border-b border-line px-5 py-3.5">
          <span className="text-callout font-semibold text-ink">Brawzer Drive</span>
          <span className="ml-auto flex h-8 w-44 items-center gap-2 rounded-md bg-canvas-subtle px-2.5 text-footnote text-ink-tertiary">
            <Search className="size-3.5" />
            Search files
          </span>
        </div>
        <ul className="divide-y divide-line">
          {sampleFiles.map((file) => (
            <li key={file.name} className="flex items-center gap-3 px-5 py-3">
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-md",
                  file.tint,
                )}
              >
                <file.icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-callout font-medium text-ink">{file.name}</p>
                <p className="text-footnote text-ink-tertiary">{file.size}</p>
              </div>
              {file.scanned ? (
                <span className="flex items-center gap-1.5 text-footnote text-success">
                  <CircleCheck className="size-4" />
                  Scanned
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-footnote text-ink-secondary">
                  <StatusDot tone="warning" pulse />
                  Scanning…
                </span>
              )}
            </li>
          ))}
        </ul>
        <div className="border-t border-line px-5 py-3.5">
          <div className="flex justify-between text-footnote text-ink-secondary">
            <span>Storage</span>
            <span>3.1 GB used</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover">
            <div className="h-full w-[31%] rounded-full bg-accent" />
          </div>
        </div>
      </div>
    </figure>
  );
}

/* ── Proxy route ─────────────────────────────────────────────────────── */

/** Illustration of a profile's traffic leaving through its proxy. */
export function ProxyRoute({ className }: { className?: string }) {
  const steps = [
    { icon: <UserRound />, title: "Work profile", detail: "Opens daily.example" },
    {
      icon: <Globe />,
      title: "Proxy · Frankfurt, Germany",
      detail: "SOCKS5 · credentials encrypted on Brawzer’s servers",
    },
    { icon: <Eye />, title: "What the website sees", detail: "Visitor from 203.0.113.42" },
  ];
  return (
    <figure
      role="img"
      aria-label="Illustration: a Work profile reaching a website through a proxy in Frankfurt, so the website sees the proxy's address."
      className={cn("rounded-xl border border-line bg-surface p-6 shadow-lg", className)}
    >
      <ol aria-hidden="true" className="relative space-y-6">
        <span className="absolute top-5 bottom-5 left-[1.1875rem] w-px bg-line-strong" />
        {steps.map((step) => (
          <li key={step.title} className="relative flex items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-secondary [&_svg]:size-[1.125rem]">
              {step.icon}
            </span>
            <div className="pt-1">
              <p className="text-callout font-semibold text-ink">{step.title}</p>
              <p className="mt-0.5 text-footnote text-ink-secondary">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <div
        aria-hidden="true"
        className="mt-6 flex items-center gap-2 border-t border-line pt-4 text-footnote text-ink-secondary"
      >
        <StatusDot tone="success" />
        Connected · checked 12 seconds ago
      </div>
    </figure>
  );
}

/* ── What Brawzer protects ───────────────────────────────────────────── */

const protectsItems = [
  {
    title: "Websites run in the cloud, not on the computer.",
    detail:
      "Scripts, plug-ins and downloads from a website never execute on the machine in front of you.",
  },
  {
    title: "Cookies, history and sign-ins stay in your account.",
    detail: "They live with your profile in Brawzer’s cloud and are encrypted at rest.",
  },
  {
    title: "Downloads go to Brawzer Drive.",
    detail: "Nothing lands on the computer’s disk unless you deliberately save it there.",
  },
  {
    title: "Proxy passwords never leave Brawzer’s servers.",
    detail: "They are encrypted and used only by your cloud browser’s connection.",
  },
  {
    title: "You can end every session from anywhere.",
    detail: "Forgot to sign out? Disconnect that computer from any other device, instantly.",
  },
] as const;

const residualItems = [
  {
    icon: <Keyboard />,
    title: "Record what you type.",
    detail:
      "A keylogger on the computer can capture keystrokes. Sign in with a passkey on your phone to avoid typing a password.",
  },
  {
    icon: <ScanEye />,
    title: "Capture what’s on screen.",
    detail:
      "Screen-recording software can see the picture of your page, just as a person behind you could.",
  },
  {
    icon: <Eye />,
    title: "Show that you used Brawzer.",
    detail:
      "The computer’s own browser keeps a history entry for the Brawzer site and some cached files from it.",
  },
] as const;

/** Two honest lists: what Brawzer protects, and what an untrusted computer can still do. */
export function ProtectionLists({ detailed = false }: { detailed?: boolean }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-line bg-surface p-6 sm:p-8">
        <h3 className="flex items-center gap-2.5 text-body font-semibold text-ink">
          <CircleCheck aria-hidden="true" className="size-5 text-success" />
          What Brawzer protects
        </h3>
        <ul className="mt-5 space-y-4">
          {protectsItems.map((item) => (
            <li key={item.title} className="flex gap-3">
              <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-success" />
              <div>
                <p className="text-callout font-medium text-ink">{item.title}</p>
                {detailed && <p className="mt-1 text-callout text-ink-secondary">{item.detail}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-line bg-surface p-6 sm:p-8">
        <h3 className="flex items-center gap-2.5 text-body font-semibold text-ink">
          <Eye aria-hidden="true" className="size-5 text-warning" />
          What a shared computer can still do
        </h3>
        <ul className="mt-5 space-y-4">
          {residualItems.map((item) => (
            <li key={item.title} className="flex gap-3">
              <span
                className="mt-0.5 flex text-warning [&_svg]:size-4 [&_svg]:shrink-0"
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <div>
                <p className="text-callout font-medium text-ink">{item.title}</p>
                {detailed && <p className="mt-1 text-callout text-ink-secondary">{item.detail}</p>}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-6 border-t border-line pt-5 text-callout text-ink-secondary">
          No website can make an untrusted computer trustworthy. Brawzer keeps your browsing off the
          machine; it can’t stop the machine from watching you use it.
        </p>
      </div>
    </div>
  );
}
