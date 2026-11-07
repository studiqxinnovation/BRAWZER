import { deviceSessionListSchema, securityEventPageSchema } from "@brawzer/contracts";
import { DevState } from "@brawzer/ui/components/dev-state";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import { Activity, ArrowRight, Laptop, MonitorSmartphone, Users } from "lucide-react";
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

function CardLink({ href, children }: { href: "/app/sessions" | "/app/shield"; children: string }) {
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
  const [session, devices, activity] = await Promise.all([
    getSession(),
    serverGet("/auth/sessions", deviceSessionListSchema),
    serverGet("/security/events?limit=3", securityEventPageSchema),
  ]);
  if ([session, devices, activity].some((result) => result.kind === "signed-out")) {
    signInAgain("/app");
  }
  if (session.kind !== "ok") return <Unavailable />;

  const now = session.receivedAt;
  const { account, session: current } = session.data;
  const SessionIcon = current.persistent ? Laptop : Users;
  const deviceCount = devices.kind === "ok" ? devices.data.sessions.length : null;

  return (
    <>
      <PageHeader title="Home">
        <p>
          Signed in as <span className="font-medium text-ink">{account.email}</span>.
        </p>
      </PageHeader>

      <div className="flex flex-col gap-6">
        <DevState title="The cloud browser isn’t available yet" milestone="Phase 3">
          This is where Brawzer’s browser will open. Your account, devices and security history
          already work.{" "}
          <Link href="/app/browser" className={textLinkClassName}>
            See what’s planned
          </Link>
        </DevState>

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
