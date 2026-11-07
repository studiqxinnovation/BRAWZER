import { passkeyListSchema } from "@brawzer/contracts";
import { Badge } from "@brawzer/ui/components/badge";
import { DevState } from "@brawzer/ui/components/dev-state";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import { BadgeCheck } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { PasskeysSection } from "@/components/account/passkeys-section";
import {
  PageContainer,
  PageHeader,
  Panel,
  SectionHeading,
  Unavailable,
} from "@/components/app-shell/page";
import { AccentControl, ThemeControl } from "@/components/appearance-controls";
import { LocalDate } from "@/components/local-date";
import { serverGet, signInAgain } from "@/lib/server-api";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Account", robots: { index: false, follow: false } };

async function AccountDetails() {
  const state = await getSession();
  if (state.kind === "signed-out") signInAgain("/app/account");
  if (state.kind === "unavailable") return <Unavailable />;
  const { account } = state.data;

  return (
    <Panel>
      <dl className="divide-y divide-line">
        <div className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-6">
          <dt className="w-40 shrink-0 text-callout text-ink-secondary">Email</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2 text-callout text-ink">
            <span className="break-all">{account.email}</span>
            {account.emailVerified && (
              <Badge tone="success">
                <BadgeCheck aria-hidden="true" />
                Confirmed
              </Badge>
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-6">
          <dt className="w-40 shrink-0 text-callout text-ink-secondary">Account created</dt>
          <dd className="text-callout text-ink">
            <LocalDate iso={account.createdAt} />
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

async function Passkeys() {
  const [state, list] = await Promise.all([
    getSession(),
    serverGet("/auth/passkeys", passkeyListSchema),
  ]);
  if (state.kind === "signed-out" || list.kind === "signed-out") signInAgain("/app/account");
  if (state.kind === "unavailable" || list.kind === "unavailable") return <Unavailable />;
  return (
    <PasskeysSection
      passkeys={list.data.passkeys}
      sharedComputer={!state.data.session.persistent}
      renderedAt={list.receivedAt}
    />
  );
}

export default function AccountPage() {
  return (
    <PageContainer>
      <PageHeader title="Account">
        <p>Your sign-in details and how Brawzer looks on this computer.</p>
      </PageHeader>
      <div className="flex flex-col gap-10">
        <section aria-labelledby="details-heading" className="flex flex-col gap-4">
          <SectionHeading id="details-heading">Details</SectionHeading>
          <Suspense fallback={<Skeleton className="h-28 w-full rounded-xl" />}>
            <AccountDetails />
          </Suspense>
        </section>

        <section aria-labelledby="passkeys-heading" className="flex flex-col gap-4">
          <SectionHeading id="passkeys-heading">Passkeys</SectionHeading>
          <Panel className="p-5 sm:p-6">
            <Suspense fallback={<Skeleton className="h-24 w-full rounded-lg" />}>
              <Passkeys />
            </Suspense>
          </Panel>
        </section>

        <section aria-labelledby="password-heading" className="flex flex-col gap-4">
          <SectionHeading id="password-heading">Password</SectionHeading>
          <Panel className="p-5 sm:p-6">
            <ChangePasswordForm />
          </Panel>
        </section>

        <section aria-labelledby="appearance-heading" className="flex flex-col gap-4">
          <SectionHeading id="appearance-heading">Appearance</SectionHeading>
          <Panel className="flex flex-col gap-5 p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-callout text-ink">Theme</p>
              <ThemeControl />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-callout text-ink">Accent colour</p>
              <AccentControl />
            </div>
            <p className="text-footnote text-ink-secondary">
              Kept in this browser tab only and forgotten when the browser closes, so nothing about
              you stays on a shared computer.
            </p>
          </Panel>
        </section>

        <DevState
          title="More account controls aren’t available yet"
          milestone="Phase 2"
          requires={[
            "Two-factor authentication codes",
            "Changing your email address",
            "Deleting your account",
            "Plans and storage (Phase 6)",
          ]}
        />
      </div>
    </PageContainer>
  );
}
