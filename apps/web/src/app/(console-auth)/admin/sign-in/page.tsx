import { isStaffRole } from "@brawzer/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Vault } from "@/components/admin-console/vault";
import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { SignInForm } from "@/components/auth/sign-in-form";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Admin console sign-in",
  description: "Sign in to Brawzer’s admin console. Staff only.",
  robots: { index: false, follow: false },
};

const RULES = [
  "Your own staff account, with a passkey or an authenticator.",
  "Personal details stay masked until revealed with a reason.",
  "Sessions end after inactivity; changes ask you to confirm it’s you.",
];

/** Why someone is here: their console session ended, or they're new to the door. */
async function Notice({ searchParams }: Pick<PageProps<"/admin/sign-in">, "searchParams">) {
  const params = await searchParams;
  if (params.expired === "1") {
    return (
      <div className="vault-notice" role="status">
        <div>
          <b>Session ended</b>
          Sign in again to continue.
        </div>
      </div>
    );
  }
  return (
    <div className="vault-notice" role="note">
      <div>
        <b>Staff only</b>
        Everything you do past this point goes in the audit log, with your name and address.
      </div>
    </div>
  );
}

/**
 * The admin console's own door. The same account and the same checks as the
 * customer sign-in (password, passkey or authenticator), but it lands on the
 * console and offers nothing a customer would need.
 */
export default async function AdminSignInPage({ searchParams }: PageProps<"/admin/sign-in">) {
  const session = await getSession();
  if (session.kind === "ok") {
    if (isStaffRole(session.data.account.role)) redirect("/admin");
    return (
      <Vault
        title="Admin console"
        subtitle="Access refused"
        notice={
          <div className="vault-notice danger" role="alert">
            <div>
              <b>This isn’t a staff account</b>
              You’re signed in as {session.data.account.email}, which has no role in the console.
              Ask the founder for one, or sign out and use your staff account. This attempt was
              logged.
            </div>
          </div>
        }
        links={
          <>
            <Link href="/app">Back to Brawzer</Link>
            <SignOutButton />
          </>
        }
      >
        <p className="vault-mono vault-dim">No role · no access</p>
      </Vault>
    );
  }
  return (
    <Vault
      title="Admin console"
      subtitle="Identify yourself to open it"
      notice={
        <Suspense fallback={null}>
          <Notice searchParams={searchParams} />
        </Suspense>
      }
      rules={RULES}
      links={<Link href="/recover">Lost your passkey or authenticator?</Link>}
    >
      <SignInForm staff />
    </Vault>
  );
}
