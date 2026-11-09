import { teamOverviewSchema } from "@brawzer/contracts";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer, PageHeader, Unavailable } from "@/components/app-shell/page";
import { TeamManager } from "@/components/team/team-manager";
import { serverGet, signInAgain } from "@/lib/server-api";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Team", robots: { index: false, follow: false } };

async function Team() {
  const [overview, session] = await Promise.all([
    serverGet("/team", teamOverviewSchema),
    getSession(),
  ]);
  if (overview.kind === "signed-out" || session.kind === "signed-out") signInAgain("/app/team");
  if (overview.kind === "unavailable" || session.kind === "unavailable") return <Unavailable />;
  return <TeamManager initial={overview.data} me={session.data.account.email} />;
}

export default function TeamPage() {
  return (
    <PageContainer>
      <PageHeader title="Team">
        <p>
          Work with others on one plan. Everyone in a team uses its owner’s plan and shares its
          proxies and its Drive space; each person’s own profiles, files and sessions stay their
          own.
        </p>
      </PageHeader>
      <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
        <Team />
      </Suspense>
    </PageContainer>
  );
}
