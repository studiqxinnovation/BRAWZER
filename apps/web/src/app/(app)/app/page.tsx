import {
  billingOverviewSchema,
  type BrowserEngine,
  browserOverviewSchema,
  deviceSessionListSchema,
  engineDetails,
  profileListSchema,
  proxyListSchema,
  securityEventPageSchema,
  securityOverviewSchema,
  siteRuleListSchema,
  type UsageWarning,
  usageWarnings,
} from "@brawzer/contracts";
import { Badge } from "@brawzer/ui/components/badge";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import { cn } from "@brawzer/ui/lib/cn";
import { ArrowRight, TriangleAlert } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Unavailable } from "@/components/app-shell/page";
import { textLinkClassName } from "@/components/auth/auth-ui";
import { AdBlockerSwitch } from "@/components/home/ad-blocker-switch";
import { CountUp } from "@/components/home/count-up";
import { Greeting } from "@/components/home/greeting";
import { HomeActions } from "@/components/home/home-actions";
import { HomeApps } from "@/components/home/home-apps";
import { toNotices } from "@/components/home/notices";
import { HomeBrowsers } from "@/components/home/home-browsers";
import { LaunchedAgo } from "@/components/home/launched-ago";
import { SessionsToday } from "@/components/home/sessions-today";
import "@/components/home/home.css";
import { formatBytes } from "@/lib/drive";
import { serverGet, signInAgain } from "@/lib/server-api";
import { getSession } from "@/lib/session";
import { timeAgo } from "@/lib/time";

export const metadata: Metadata = { title: "Home", robots: { index: false, follow: false } };

/** Each browser's colour in the usage bars: its logo's own. */
const ENGINE_COLOURS: Record<BrowserEngine, string> = {
  bee: "#e9a43c",
  chrome: "#1a73e8",
  firefox: "#ff4f5e",
  edge: "#0f9bd7",
  chromium: "#5b7fd6",
};

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-12 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-52 w-full rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-72 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

/** What a usage warning says on Home; the email says the same in more words. */
function warningText(warning: UsageWarning): { title: string; body: string } {
  const reached = warning.percent >= 100;
  switch (warning.kind) {
    case "browsing":
      return {
        title: reached
          ? "This month’s browsing hours are used up"
          : `${String(warning.percent)}% of this month’s browsing hours used`,
        body: reached
          ? "New cloud browser sessions can start again on the 1st (UTC)."
          : "When they run out, new sessions wait until the 1st (UTC).",
      };
    case "storage":
      return {
        title: reached ? "Drive is full" : `Drive is ${String(warning.percent)}% full`,
        body: reached
          ? "New uploads and downloads are refused until there is room."
          : "When it’s full, new uploads and downloads are refused.",
      };
    case "files":
      return {
        title: reached
          ? "Drive holds as many files as it can"
          : `${String(warning.percent)}% of Drive’s file limit used`,
        body: "Delete files you no longer need to make room.",
      };
  }
}

/** "45 min", "2 h 5 min". */
function duration(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

function StatCard({
  label,
  figure,
  tone = "ink",
  children,
}: {
  label: string;
  figure: ReactNode;
  tone?: "ink" | "success" | "accent";
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="hm-card hm-rise hm-lift flex flex-col gap-3 p-4 sm:p-5">
      <h2 className="hm-eyebrow">{label}</h2>
      <p
        className={cn(
          "hm-figure",
          tone === "success" ? "text-success" : tone === "accent" ? "text-accent-ink" : "text-ink",
        )}
      >
        {figure}
      </p>
      <div className="text-footnote text-ink-secondary">{children}</div>
    </section>
  );
}

function Panel({
  title,
  heading,
  emoji,
  link,
  className,
  children,
}: {
  title: string;
  /** What the heading shows, when it's more than the title. */
  heading?: ReactNode;
  emoji: string;
  link?: { href: Route; label: string };
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className={cn("hm-card hm-rise flex flex-col", className)}>
      <div className="hm-panel-head">
        <h2 className="flex items-center gap-2 text-body font-semibold text-ink">
          <span aria-hidden="true" className="hm-emoji">
            {emoji}
          </span>
          {heading ?? title}
        </h2>
        {link && (
          <Link href={link.href} className="hm-link">
            {link.label}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

async function Dashboard() {
  const [session, devices, activity, browser, billing, security, profiles, proxies, siteRules] =
    await Promise.all([
      getSession(),
      serverGet("/auth/sessions", deviceSessionListSchema),
      serverGet("/security/events?limit=3", securityEventPageSchema),
      serverGet("/browser", browserOverviewSchema),
      serverGet("/billing", billingOverviewSchema),
      serverGet("/security/overview", securityOverviewSchema),
      serverGet("/profiles", profileListSchema),
      serverGet("/proxies", proxyListSchema),
      serverGet("/site-rules", siteRuleListSchema),
    ]);
  if (
    [session, devices, activity, browser, billing, security, profiles].some(
      (result) => result.kind === "signed-out",
    )
  ) {
    signInAgain("/app");
  }
  if (session.kind !== "ok") return <Unavailable />;

  const now = session.receivedAt;
  const current = session.data.session;
  const overview = browser.kind === "ok" ? browser.data : null;
  const plan = billing.kind === "ok" ? billing.data : null;
  const shield = security.kind === "ok" ? security.data : null;
  const profileList = profiles.kind === "ok" ? profiles.data.profiles : [];
  const firstProfile = profileList[0] ?? null;
  const warnings = plan ? usageWarnings(plan.plan.limits, plan.usage) : [];
  const live = overview?.sessions ?? [];
  const available = overview?.runtime === "available";
  const deviceCount = devices.kind === "ok" ? devices.data.sessions.length : null;
  const lastEnded = overview?.activity.lastEndedAt ?? null;

  const usedBytes = plan?.usage.driveBytes ?? 0;
  const limitBytes = plan?.plan.limits.driveBytes ?? 0;
  const [usedNumber, usedUnit] = formatBytes(usedBytes).split(" ");

  const minutes = overview?.activity.minutesThisMonth ?? [];
  const busiest = Math.max(1, ...minutes.map((entry) => entry.minutes));
  const monthTotal = plan?.usage.browsingMinutesThisMonth ?? 0;
  const monthLimit = plan?.plan.limits.browsingMinutesPerMonth ?? null;

  const proxy =
    proxies.kind === "ok" && firstProfile?.proxyId
      ? (proxies.data.proxies.find((candidate) => candidate.id === firstProfile.proxyId) ?? null)
      : null;
  const rules = siteRules.kind === "ok" ? siteRules.data.rules : [];
  const blocked = rules.filter((rule) => rule.kind === "block").length;
  const allowed = rules.length - blocked;
  const issues = shield?.recommendations.length ?? 0;
  const notices = activity.kind === "ok" ? toNotices(activity.data.events, now) : [];

  return (
    <div className="flex flex-col gap-6">
      <header className="ad-page-head flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Greeting />
          <p className="flex items-center gap-2 text-callout text-ink-secondary">
            <span
              aria-hidden="true"
              className={cn("hm-dot", available ? "text-success" : "text-danger")}
            />
            {available
              ? "Cloud is running · only pixels reach this device"
              : "The cloud browser can’t be reached right now"}
          </p>
        </div>
        <HomeActions notices={notices} />
      </header>

      {!current.persistent && (
        <div
          role="note"
          aria-label="Shared-computer mode"
          className="hm-rise flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-danger/25 bg-danger-soft px-5 py-4"
        >
          <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-danger" />
          <div className="min-w-[13rem] flex-1">
            <p className="text-callout font-semibold text-danger">Shared-computer mode is on</p>
            <p className="text-footnote text-ink-secondary">
              You’re signed out when this browser closes, or after{" "}
              {String(current.idleTimeoutMinutes)} minutes without activity.
            </p>
          </div>
          <Link href="/app/shield" className="hm-link text-danger max-sm:ml-9">
            Review in Shield
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
      )}

      {warnings.map((warning) => {
        const text = warningText(warning);
        return (
          <FormMessage
            key={warning.kind}
            tone={warning.percent >= 100 ? "danger" : "info"}
            title={text.title}
          >
            {text.body}{" "}
            <Link href="/app/account" className={textLinkClassName}>
              See your plan
            </Link>
          </FormMessage>
        );
      })}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Sessions today"
          tone="success"
          figure={<SessionsToday starts={overview?.activity.recentStarts ?? []} />}
        >
          <p className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("hm-dot", live.length > 0 ? "text-accent-ink" : "text-success")}
            />
            {live.length > 0
              ? `${String(live.length)} open now`
              : lastEnded
                ? `Last ended ${timeAgo(lastEnded, now)}`
                : "None yet"}
          </p>
        </StatCard>
        <StatCard
          label="Active profiles"
          tone="accent"
          figure={<CountUp value={profileList.length} />}
        >
          <p className="flex items-center gap-1.5">
            <span aria-hidden="true" className="hm-dot text-accent-ink" />
            {firstProfile
              ? `“${firstProfile.name}” is the default · ${plan ? `of ${String(plan.plan.limits.profiles)}` : ""}`.replace(
                  / · $/,
                  "",
                )
              : "None yet"}
          </p>
        </StatCard>
        <StatCard
          label="Devices signed in"
          figure={deviceCount === null ? "–" : <CountUp value={deviceCount} />}
        >
          <p className="flex items-center gap-1.5">
            <span aria-hidden="true" className="hm-dot text-success" />
            {deviceCount === null
              ? "Can’t be loaded right now"
              : deviceCount <= 1
                ? "Only this device"
                : `This one and ${String(deviceCount - 1)} more`}
          </p>
        </StatCard>
        <StatCard
          label="Drive storage"
          figure={
            <>
              {usedNumber}
              <span className="ml-1 text-body font-medium text-ink-tertiary">{usedUnit}</span>
            </>
          }
        >
          <div
            className="hm-meter"
            role="meter"
            aria-label="Drive storage used"
            aria-valuemin={0}
            aria-valuemax={limitBytes}
            aria-valuenow={usedBytes}
            aria-valuetext={`${formatBytes(usedBytes)} of ${formatBytes(limitBytes)}`}
          >
            <span
              style={{
                width: `${String(limitBytes ? Math.min(100, (usedBytes / limitBytes) * 100) : 0)}%`,
              }}
            />
          </div>
          <p className="mt-2">
            {formatBytes(Math.max(0, limitBytes - usedBytes))} free of {formatBytes(limitBytes)}
          </p>
        </StatCard>
      </div>

      <Panel
        title="Your browsers"
        heading={<LaunchedAgo since={overview?.activity.recentStarts[0] ?? null} />}
        emoji="🖥️"
        link={{ href: "/app/browser?new=1" as Route, label: "Manage" }}
      >
        <p className="px-5 pt-4 text-footnote text-ink-secondary">
          {live.length > 0
            ? `${String(live.length)} of ${String(overview?.limits.liveSessions ?? live.length)} open now. Click one to go back to it, or open another.`
            : lastEnded
              ? `Last used ${timeAgo(lastEnded, now)}. Click a browser to open it.`
              : "Click a browser to open it in Brawzer’s cloud."}
        </p>
        {overview ? (
          <HomeBrowsers
            engines={overview.engines}
            profiles={profileList}
            sessions={live}
            limit={overview.limits.liveSessions}
            available={available}
          />
        ) : (
          <p className="px-5 py-6 text-callout text-ink-secondary">
            Your browsers can’t be loaded right now.
          </p>
        )}
      </Panel>

      <HomeApps />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Shield" emoji="🛡️" link={{ href: "/app/shield", label: "Open" }}>
          <div className="hm-rows py-2">
            <div>
              <span>Security status</span>
              {shield ? (
                issues > 0 ? (
                  <Badge tone="warning">
                    {issues === 1 ? "1 to do" : `${String(issues)} to do`}
                  </Badge>
                ) : (
                  <Badge tone="success">All set</Badge>
                )
              ) : (
                <Badge>Unknown</Badge>
              )}
            </div>
            {firstProfile && (
              <div>
                <span className="min-w-0">
                  Ad and tracker blocker
                  <span className="block truncate text-footnote text-ink-secondary">
                    In “{firstProfile.name}”
                  </span>
                </span>
                <AdBlockerSwitch profile={firstProfile} />
              </div>
            )}
            <div>
              <span>Two-factor authentication</span>
              {shield?.twoFactorEnabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
            </div>
            <div>
              <span>Passkeys</span>
              <span className="font-medium">
                {shield ? (shield.passkeys === 0 ? "None" : String(shield.passkeys)) : "–"}
              </span>
            </div>
            <div>
              <span>Failed sign-ins, 7 days</span>
              <span className="font-medium">{String(shield?.recentFailedAttempts ?? 0)}</span>
            </div>
          </div>
        </Panel>

        <Panel title="Network" emoji="🌐" link={{ href: "/app/proxy", label: "Configure" }}>
          <div className="hm-rows py-2">
            <div>
              <span className="min-w-0">
                Proxy
                {firstProfile && (
                  <span className="block truncate text-footnote text-ink-secondary">
                    For “{firstProfile.name}”{proxy ? `: ${proxy.name}` : ""}
                  </span>
                )}
              </span>
              {!firstProfile?.proxyId ? (
                <Badge>Direct</Badge>
              ) : proxy?.lastTest?.ok ? (
                <Badge tone="success">Working</Badge>
              ) : proxy?.lastTest ? (
                <Badge tone="danger">Failing</Badge>
              ) : (
                <Badge>Not tested</Badge>
              )}
            </div>
            <div>
              <span>Sign-in mode</span>
              <span className="font-medium">
                {current.persistent ? "Kept on this device" : "Shared computer"}
              </span>
            </div>
            <div>
              <span>Signed out when the browser closes</span>
              <span className="font-medium">{current.persistent ? "No" : "Yes"}</span>
            </div>
            <div>
              <span>Signed out when idle</span>
              <span className="font-medium">
                {current.persistent ? "No" : `${String(current.idleTimeoutMinutes)} min`}
              </span>
            </div>
            <div>
              <span>Site rules</span>
              <span className="font-medium">
                {rules.length === 0
                  ? "None"
                  : [
                      blocked > 0 ? `${String(blocked)} blocked` : null,
                      allowed > 0 ? `${String(allowed)} allowed` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Usage" emoji="📊" link={{ href: "/app/account", label: "Report" }}>
          <div className="flex flex-1 flex-col gap-4 px-5 py-4">
            <h3 className="hm-eyebrow">Browsing time by browser, this month</h3>
            {minutes.length > 0 ? (
              <ul aria-label="Browsing time by browser" className="flex flex-col gap-3">
                {minutes.map((entry) => (
                  <li
                    key={entry.engine}
                    className="grid grid-cols-[6rem_1fr_auto] items-center gap-3"
                  >
                    <span className="truncate text-callout text-ink">
                      {engineDetails[entry.engine].short}
                    </span>
                    <span className="hm-meter" aria-hidden="true">
                      <span
                        style={{
                          width: `${String(Math.max(2, (entry.minutes / busiest) * 100))}%`,
                          ["--hm-fill" as string]: ENGINE_COLOURS[entry.engine],
                        }}
                      />
                    </span>
                    <span className="text-callout font-medium text-ink tabular-nums">
                      {duration(entry.minutes)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-callout text-ink-secondary">No browsing yet this month.</p>
            )}
            <div className="mt-auto border-t border-line pt-3">
              <p className="flex justify-between text-footnote text-ink-secondary">
                <span>Total</span>
                <span>
                  {duration(monthTotal)}
                  {monthLimit !== null ? ` of ${duration(monthLimit)}` : " · no monthly limit"}
                </span>
              </p>
              {monthLimit !== null && (
                <div className="hm-meter mt-2" aria-hidden="true">
                  <span
                    style={{ width: `${String(Math.min(100, (monthTotal / monthLimit) * 100))}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <Suspense fallback={<HomeSkeleton />}>
        <Dashboard />
      </Suspense>
    </div>
  );
}
