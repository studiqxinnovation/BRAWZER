import { connection } from "next/server";
import { isStaffRole } from "@brawzer/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ConfirmIdentityProvider } from "@/components/app-shell/confirm-identity";
import { SessionKeeperLoader } from "@/components/app-shell/session-keeper-loader";
import { AdminShell } from "@/components/admin-console/shell";
import "@/components/admin-console/admin.css";
import { SkipLink } from "@/components/site/site-chrome";
import { signInAgain } from "@/lib/server-api";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: { template: "%s · Brawzer Admin", default: "Brawzer Admin" },
  robots: { index: false, follow: false },
};

/** Rendered for every request, so each response carries its own CSP nonce. */
export const instant = false;

/** The admin console (Phase 11): staff only; everyone else sees nothing here. */
export default async function AdminLayout({ children }: LayoutProps<"/">) {
  await connection();
  const session = await getSession();
  if (session.kind === "signed-out") signInAgain("/admin");
  if (session.kind !== "ok") notFound();
  const { account } = session.data;
  if (!isStaffRole(account.role)) notFound();
  return (
    <>
      <SkipLink />
      <ConfirmIdentityProvider>
        <AdminShell staff={{ id: account.id, email: account.email, role: account.role }}>
          {children}
        </AdminShell>
      </ConfirmIdentityProvider>
      <Suspense fallback={null}>
        <SessionKeeperLoader />
      </Suspense>
    </>
  );
}
