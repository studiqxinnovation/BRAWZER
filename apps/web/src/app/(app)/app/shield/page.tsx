import {
  profileListSchema,
  securityEventPageSchema,
  securityOverviewSchema,
} from "@brawzer/contracts";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";
import {
  InfoHead,
  PageContainer,
  PageHeader,
  Panel,
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
  const [result, profiles] = await Promise.all([
    serverGet("/security/overview", securityOverviewSchema),
    serverGet("/profiles", profileListSchema),
  ]);
  if (result.kind === "signed-out") signInAgain("/app/shield");
  if (result.kind === "unavailable") return <Unavailable />;
  return (
    <SecurityOverviewSections
      overview={result.data}
      profile={profiles.kind === "ok" ? (profiles.data.profiles[0] ?? null) : null}
      renderedAt={result.receivedAt}
    />
  );
}

export default function ShieldPage() {
  return (
    <PageContainer>
      <PageHeader title="Shield">
        <p>Protection applies to every cloud browser and every profile.</p>
      </PageHeader>
      <div className="flex flex-col gap-[14px]">
        <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
          <Overview />
        </Suspense>
        <Panel>
          <InfoHead id="activity-heading" title="Activity">
            <span className="ad-info-count">Everything that happened on your account</span>
          </InfoHead>
          <div className="p-4">
            <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
              <Activity />
            </Suspense>
          </div>
        </Panel>
      </div>
    </PageContainer>
  );
}
