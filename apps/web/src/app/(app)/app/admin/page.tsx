import { publicPlansSchema } from "@brawzer/contracts";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminAccounts } from "@/components/admin/admin-accounts";
import { PageContainer, PageHeader, Unavailable } from "@/components/app-shell/page";
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
  return <AdminAccounts plans={plans.data.plans} />;
}

export default function AdminPage() {
  return (
    <PageContainer>
      <PageHeader title="Admin">
        <p>
          Accounts on this installation and their plans. Setting a plan by hand asks you to confirm
          it’s you and is recorded in that account’s security history.
        </p>
      </PageHeader>
      <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
        <Accounts />
      </Suspense>
    </PageContainer>
  );
}
