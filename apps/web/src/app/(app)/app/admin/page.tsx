import { publicPlansSchema } from "@brawzer/contracts";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminAccounts } from "@/components/admin/admin-accounts";
import { AdminReports } from "@/components/admin/admin-reports";
import { AdminRuntimeView } from "@/components/admin/admin-runtime";
import {
  PageContainer,
  PageHeader,
  SectionHeading,
  Unavailable,
} from "@/components/app-shell/page";
import { serverGet, signInAgain } from "@/lib/server-api";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

async function Accounts() {
  const [state, plans] = await Promise.all([
    getSession(),
    serverGet("/billing/plans", publicPlansSchema),
  ]);
  if (state.kind === "signed-out") signInAgain("/app/admin");
  if (state.kind === "unavailable" || plans.kind === "unavailable") return <Unavailable />;
  if (plans.kind === "signed-out") signInAgain("/app/admin");
  // Not an administrator: the page doesn't exist, as far as they can tell.
  if (state.data.account.role !== "admin") notFound();
  return (
    <div className="flex flex-col gap-10">
      <AdminAccounts plans={plans.data.plans} />
      <section aria-labelledby="admin-runtime" className="flex flex-col gap-4">
        <SectionHeading id="admin-runtime">Cloud browser</SectionHeading>
        <AdminRuntimeView />
      </section>
      <section aria-labelledby="admin-reports" className="flex flex-col gap-4">
        <SectionHeading id="admin-reports">Reported pages</SectionHeading>
        <AdminReports />
      </section>
    </div>
  );
}

export default function AdminPage() {
  return (
    <PageContainer>
      <PageHeader title="Admin">
        <p>
          Accounts on this installation and their plans, the cloud browser’s hosts and live
          sessions, and pages people reported. Every action asks you to confirm it’s you; changes to
          an account are recorded in its security history.
        </p>
      </PageHeader>
      <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
        <Accounts />
      </Suspense>
    </PageContainer>
  );
}
