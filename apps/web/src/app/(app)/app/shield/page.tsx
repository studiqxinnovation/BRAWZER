import { securityEventPageSchema, securityOverviewSchema } from "@brawzer/contracts";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";
import {
  PageContainer,
  PageHeader,
  SectionHeading,
  Unavailable,
} from "@/components/app-shell/page";
import { ActivityList } from "@/components/shield/activity-list";
import { SecurityOverviewSections } from "@/components/shield/security-overview";
import { serverGet, signInAgain } from "@/lib/server-api";

export const metadata: Metadata = { title: "Shield", robots: { index: false, follow: false } };

async function Activity() {
  const result = await serverGet("/security/events?limit=20", securityEventPageSchema);
  if (result.kind === "signed-out") signInAgain("/app/shield");
  if (result.kind === "unavailable") return <Unavailable />;
  return <ActivityList initial={result.data} renderedAt={result.receivedAt} />;
}

async function Overview() {
  const result = await serverGet("/security/overview", securityOverviewSchema);
  if (result.kind === "signed-out") signInAgain("/app/shield");
  if (result.kind === "unavailable") return <Unavailable />;
  return <SecurityOverviewSections overview={result.data} renderedAt={result.receivedAt} />;
}

export default function ShieldPage() {
  return (
    <PageContainer>
      <PageHeader title="Shield">
        <p>
          Your security centre: how your account is protected, sign-ins from new places, and
          everything that happened on your account. It never records the sites you visit.
        </p>
      </PageHeader>
      <div className="flex flex-col gap-10">
        <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
          <Overview />
        </Suspense>
        <section aria-labelledby="activity-heading" className="flex flex-col gap-4">
          <SectionHeading id="activity-heading">Activity</SectionHeading>
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            <Activity />
          </Suspense>
        </section>
      </div>
    </PageContainer>
  );
}
