import { adminPageByKey, canSee, isStaffRole } from "@brawzer/contracts";
import { Lock } from "lucide-react";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { staffSignInAgain } from "@/lib/server-api";
import { getSession } from "@/lib/session";
import { RefusedPageNotice } from "./refused";

/**
 * A console page's gate (server side): staff only, and only roles that may
 * see this page. Anyone else sees the prototype's "No access" and the
 * attempt goes to the audit log.
 */
export function AdminGate({ page, children }: { page: string; children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Gate page={page}>{children}</Gate>
    </Suspense>
  );
}

async function Gate({ page, children }: { page: string; children: ReactNode }) {
  const session = await getSession();
  if (session.kind === "signed-out") staffSignInAgain("/admin");
  if (session.kind !== "ok") notFound();
  const role = session.data.account.role;
  if (!isStaffRole(role)) notFound();
  if (!canSee(role, page)) {
    const title = adminPageByKey(page)?.title ?? page;
    return (
      <div className="lockv">
        <Lock aria-hidden="true" width={40} height={40} style={{ margin: "0 auto" }} />
        <h2>No access</h2>
        <p className="muted">
          Your role can’t open {title}. Ask the founder if you need it for your work. This attempt
          was logged.
        </p>
        <RefusedPageNotice page={title} />
      </div>
    );
  }
  return <>{children}</>;
}
