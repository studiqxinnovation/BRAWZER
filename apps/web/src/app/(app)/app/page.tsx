import {
  billingOverviewSchema,
  browserOverviewSchema,
  deviceSessionListSchema,
  engineDetails,
  securityEventPageSchema,
  type UsageWarning,
  usageWarnings,
} from "@brawzer/contracts";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import { Activity, AppWindow, ArrowRight, Laptop, MonitorSmartphone, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageContainer, PageHeader, Panel, Unavailable } from "@/components/app-shell/page";
import { textLinkClassName } from "@/components/auth/auth-ui";
import { describeEvent } from "@/content/app";
import { serverGet, signInAgain } from "@/lib/server-api";
import { getSession } from "@/lib/session";
import { timeAgo } from "@/lib/time";

export const metadata: Metadata = { title: "Home", robots: { index: false, follow: false } };

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
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

function CardLink({
  href,
  children,
}: {
  href: "/app/sessions" | "/app/shield" | "/app/browser" | "/app/account";
  children: string;
}) {
  return (
    <Link
      href={href}
      className={`${textLinkClassName} inline-flex items-center gap-1 text-callout`}
    >
      {children}
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

async function Overview() {
  const [session, devices, activity, browser, billing] = await Promise.all([
    getSession(),
    serverGet("/auth/sessions", deviceSessionListSchema),
    serverGet("/security/events?limit=3", securityEventPageSchema),
    serverGet("/browser", browserOverviewSchema),
    serverGet("/billing", billingOverviewSchema),
  ]);
  if ([session, devices, activity].some((result) => result.kind === "signed-out")) {
    signInAgain("/app");
  }
  if (session.kind !== "ok") return <Unavailable />;

  const now = session.receivedAt;
  const { account, session: current } = session.data;
  const SessionIcon = current.persistent ? Laptop : Users;
  const deviceCount = devices.kind === "ok" ? devices.data.sessions.length : null;
  const live = browser.kind === "ok" ? browser.data.session : null;
  const warnings =
    billing.kind === "ok" ? usageWarnings(billing.data.plan.limits, billing.data.usage) : [];

  return (
    <>
      <PageHeader title="Home">
        <p>
          Signed in as <span className="font-medium text-ink">{account.email}</span>.
        </p>
      </PageHeader>

      <div className="flex flex-col gap-6">
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

        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 text-body font-semibold text-ink">
            <AppWindow aria-hidden="true" className="size-4 text-ink-secondary" />
            Cloud browser
          </h2>
          <p className="text-callout text-pretty text-ink-secondary">
            {live
              ? `A ${engineDetails[live.engine].name} session is running. Its tabs are waiting where you left them.`
              : browser.kind === "ok" && browser.data.runtime === "unavailable"
                ? "The cloud browser can’t be reached right now. Try again in a moment."
                : "Bee Browser or Firefox, running in Brawzer’s cloud with your profiles’ cookies, proxies and extensions. Only the page’s pixels reach this computer."}
          </p>
          <div>
            <CardLink href="/app/browser">{live ? "Return to it" : "Start browsing"}</CardLink>
          </div>
        </Panel>

        <div className="grid gap-6 md:grid-cols-2">
          <Panel className="flex flex-col gap-3 p-5">
            <h2 className="flex items-center gap-2 text-body font-semibold text-ink">
              <SessionIcon aria-hidden="true" className="size-4 text-ink-secondary" />
              This sign-in
            </h2>
            <p className="text-callout text-pretty text-ink-secondary">
              {current.persistent
                ? "Kept signed in on this device for up to 30 days. Sign out if this isn’t your own computer."
                : `Shared-computer mode: you’re signed out when the browser closes, or after ${String(current.idleTimeoutMinutes)} minutes without activity.`}
            </p>
          </Panel>

          <Panel className="flex flex-col gap-3 p-5">
            <h2 className="flex items-center gap-2 text-body font-semibold text-ink">
              <MonitorSmartphone aria-hidden="true" className="size-4 text-ink-secondary" />
              Sessions
            </h2>
            <p className="text-callout text-ink-secondary">
              {deviceCount === null
                ? "Your signed-in devices can’t be loaded right now."
                : deviceCount === 1
                  ? "Only this device is signed in."
                  : `${String(deviceCount)} devices are signed in.`}
            </p>
            <div className="mt-auto">
              <CardLink href="/app/sessions">Review devices</CardLink>
            </div>
          </Panel>
        </div>

        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 text-body font-semibold text-ink">
            <Activity aria-hidden="true" className="size-4 text-ink-secondary" />
            Recent activity
          </h2>
          {activity.kind === "ok" && activity.data.events.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {activity.data.events.map((event) => (
                <li key={event.id} className="flex flex-wrap justify-between gap-x-4 text-callout">
                  <span className="text-ink">{describeEvent(event).title}</span>
                  <time dateTime={event.occurredAt} className="text-ink-secondary">
                    {timeAgo(event.occurredAt, now)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-callout text-ink-secondary">
              {activity.kind === "ok" ? "No activity yet." : "Activity can’t be loaded right now."}
            </p>
          )}
          <div>
            <CardLink href="/app/shield">See all activity in Shield</CardLink>
          </div>
        </Panel>
      </div>
    </>
  );
}

export default function HomePage() {
  return (
    <PageContainer>
      <Suspense fallback={<HomeSkeleton />}>
        <Overview />
      </Suspense>
    </PageContainer>
  );
}
