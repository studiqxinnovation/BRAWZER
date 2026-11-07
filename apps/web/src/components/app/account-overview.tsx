import { DevState } from "@brawzer/ui/components/dev-state";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import { BadgeCheck, Laptop, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { LocalDate } from "@/components/local-date";
import { getSession } from "@/lib/session";

export function AccountOverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

/** Who is signed in and how long this sign-in lasts, straight from the API. */
export async function AccountOverview() {
  const state = await getSession();
  // The proxy already sent visitors without a cookie to sign in; reaching
  // this point signed out means the session expired or was revoked.
  if (state.kind === "signed-out") redirect("/sign-in?next=%2Fapp&expired=1");
  if (state.kind === "unavailable") {
    return (
      <FormMessage tone="danger" title="Brawzer can’t load your account right now">
        Our servers can’t be reached. Wait a moment, then reload the page.
      </FormMessage>
    );
  }

  const { account, session } = state.data;
  const SessionIcon = session.persistent ? Laptop : Users;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-title-2 text-ink">Your account</h1>
        <p className="mt-2 text-callout text-ink-secondary">
          Signed in as <span className="font-medium text-ink">{account.email}</span>
        </p>
      </div>

      <dl className="divide-y divide-line rounded-xl border border-line bg-surface">
        <div className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-6">
          <dt className="w-40 shrink-0 text-callout text-ink-secondary">Email</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-2 text-callout text-ink">
            <span className="break-all">{account.email}</span>
            {account.emailVerified && (
              <span className="inline-flex items-center gap-1 text-footnote text-success">
                <BadgeCheck aria-hidden="true" className="size-3.5" />
                Confirmed
              </span>
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-6">
          <dt className="w-40 shrink-0 text-callout text-ink-secondary">Account created</dt>
          <dd className="text-callout text-ink">
            <LocalDate iso={account.createdAt} />
          </dd>
        </div>
        <div className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-6">
          <dt className="w-40 shrink-0 text-callout text-ink-secondary">This sign-in</dt>
          <dd className="flex min-w-0 items-start gap-2 text-callout text-ink">
            <SessionIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-secondary" />
            <span className="text-pretty">
              {session.persistent
                ? "Kept signed in on this device for up to 30 days. Sign out if you’re not on your own computer."
                : `Shared-computer mode: you’re signed out when the browser closes, or after ${String(session.idleTimeoutMinutes)} minutes without activity.`}
            </span>
          </dd>
        </div>
      </dl>

      <DevState
        title="The Brawzer workspace isn’t built yet"
        milestone="Milestone 1.5"
        requires={[
          "Signed-in app shell and navigation (milestone 1.5)",
          "Profiles, sessions and the security centre (Phase 2)",
          "Cloud browser sessions (Phase 3)",
        ]}
      >
        Your account works: sign-up, email confirmation, sign-in, sign-out and password reset are
        live. Nothing else in the signed-in area exists yet.
      </DevState>
    </div>
  );
}
