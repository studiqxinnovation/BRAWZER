import { isStaffRole } from "@brawzer/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginScreen } from "@/components/auth/login-screen";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Admin console sign-in",
  description: "Sign in to Brawzer’s admin console. Staff only.",
  robots: { index: false, follow: false },
};

/** Why someone is here: their console session ended, or they aren't staff. */
async function Notice({ searchParams }: Pick<PageProps<"/admin/sign-in">, "searchParams">) {
  const params = await searchParams;
  if (params.expired === "1") {
    return (
      <div className="lg-err lg-info" role="status">
        <b>Your session has ended</b>
        Sign in again to continue.
      </div>
    );
  }
  return null;
}

/**
 * The admin console's own door. The same account and the same checks as the
 * customer sign-in (password, passkey or authenticator), but it lands on the
 * console and offers nothing a customer would need. Everything done past this
 * point is recorded in the audit log.
 */
export default async function AdminSignInPage({ searchParams }: PageProps<"/admin/sign-in">) {
  const session = await getSession();
  if (session.kind === "ok") {
    if (isStaffRole(session.data.account.role)) redirect("/admin");
    return (
      <LoginScreen>
        <h1 className="lg-name">Admin console</h1>
        <div className="lg-err" role="alert">
          <b>This isn’t a staff account</b>
          You’re signed in as {session.data.account.email}, which has no role in the console. Ask
          the founder for one, or sign out and use your staff account.
        </div>
        <div className="lg-links">
          <Link href="/app" className="lg-link">
            Back to Brawzer
          </Link>
          <SignOutButton className="lg-link" />
        </div>
      </LoginScreen>
    );
  }
  return (
    <LoginScreen
      notice={
        <Suspense fallback={null}>
          <Notice searchParams={searchParams} />
        </Suspense>
      }
    >
      <h1 className="lg-name">Admin console</h1>
      <div className="lg-err lg-info" role="note">
        <b>Staff only</b>
        Everything you do past this point goes in the audit log.
      </div>
      <SignInForm screen staff />
    </LoginScreen>
  );
}
