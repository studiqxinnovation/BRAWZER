import { canSee, homeOf, isStaffRole } from "@brawzer/contracts";
import { notFound, redirect } from "next/navigation";
import { AdminGate } from "@/components/admin-console/gate";
import { OverviewPage } from "@/components/admin-console/pages/overview";
import { getSession } from "@/lib/session";
import { Suspense } from "react";

export const metadata = { title: "Company overview" };

/** The console's front door: founders get the overview, everyone else their own first page. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <FrontDoor />
    </Suspense>
  );
}

async function FrontDoor() {
  const session = await getSession();
  if (session.kind === "ok") {
    const role = session.data.account.role;
    if (!isStaffRole(role)) notFound();
    if (!canSee(role, "overview")) redirect(`/admin/${homeOf(role)}` as never);
  }
  return (
    <AdminGate page="overview">
      <OverviewPage />
    </AdminGate>
  );
}
