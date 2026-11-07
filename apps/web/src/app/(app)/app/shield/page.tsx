import { securityEventPageSchema } from "@brawzer/contracts";
import { DevState } from "@brawzer/ui/components/dev-state";
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
import { serverGet, signInAgain } from "@/lib/server-api";

export const metadata: Metadata = { title: "Shield", robots: { index: false, follow: false } };

async function Activity() {
  const result = await serverGet("/security/events?limit=20", securityEventPageSchema);
  if (result.kind === "signed-out") signInAgain("/app/shield");
  if (result.kind === "unavailable") return <Unavailable />;
  return <ActivityList initial={result.data} renderedAt={result.receivedAt} />;
}

export default function ShieldPage() {
  return (
    <PageContainer>
      <PageHeader title="Shield">
        <p>
          Your security centre. Every sign-in, failed attempt and password change on your account,
          newest first. It never records the sites you visit.
        </p>
      </PageHeader>
      <div className="flex flex-col gap-10">
        <section aria-labelledby="activity-heading" className="flex flex-col gap-4">
          <SectionHeading id="activity-heading">Activity</SectionHeading>
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            <Activity />
          </Suspense>
        </section>
        <DevState
          title="Alerts and recommendations aren’t available yet"
          milestone="Phase 2"
          requires={[
            "Email and in-app alerts when a new device signs in",
            "Recommendations, such as adding a passkey",
          ]}
        >
          Shield will tell you about unusual activity instead of waiting for you to look.
        </DevState>
      </div>
    </PageContainer>
  );
}
