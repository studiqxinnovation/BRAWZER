import {
  billingOverviewSchema,
  deviceSessionListSchema,
  mfaStatusSchema,
  passkeyListSchema,
} from "@brawzer/contracts";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import { buttonVariants } from "@brawzer/ui/lib/button-variants";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChangeEmail } from "@/components/account/change-email";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { DeleteAccount } from "@/components/account/delete-account";
import { DownloadData } from "@/components/account/download-data";
import { EmailPreferences } from "@/components/account/email-preferences";
import { NameSection } from "@/components/account/name-section";
import { PasskeysSection } from "@/components/account/passkeys-section";
import { PlanSection } from "@/components/account/plan-section";
import { DesktopStyleSegment, WallpaperButton } from "@/components/account/preference-controls";
import { TwoFactorSection } from "@/components/account/two-factor-section";
import {
  Card,
  Grid,
  InfoHead,
  PageContainer,
  PageHeader,
  Panel,
  Pill,
  Row,
  Unavailable,
} from "@/components/app-shell/page";
import { Reveal } from "@/components/app-shell/reveal";
import { AccentControl, ThemeControl } from "@/components/appearance-controls";
import { LocalDate } from "@/components/local-date";
import { EndOtherSessionsButton } from "@/components/sessions/session-actions";
import { serverGet, signInAgain } from "@/lib/server-api";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Account", robots: { index: false, follow: false } };

async function ProfileCard() {
  const state = await getSession();
  if (state.kind === "signed-out") signInAgain("/app/account");
  if (state.kind === "unavailable") return <Unavailable />;
  const { account } = state.data;
  return (
    <>
      <div className="flex items-center gap-3">
        <span
          className="ad-pav"
          style={{ background: "linear-gradient(145deg, #5e5ce6, #0a84ff)" }}
        >
          {(account.name ?? account.email).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="ad-li-title">
            <span className="truncate">{account.name ?? account.email}</span>
            {account.emailVerified && <Pill tone="green">Confirmed</Pill>}
          </p>
          <p className="ad-li-sub">
            {account.name && <>{account.email} · </>}
            Since <LocalDate iso={account.createdAt} />
          </p>
        </div>
      </div>
      <div>
        <NameSection name={account.name} />
      </div>
      <div>
        <ChangeEmail currentEmail={account.email} />
      </div>
    </>
  );
}

async function Plan() {
  const overview = await serverGet("/billing", billingOverviewSchema);
  if (overview.kind === "signed-out") signInAgain("/app/account");
  if (overview.kind === "unavailable") return <Unavailable />;
  return <PlanSection overview={overview.data} />;
}

async function SecurityRows() {
  const [state, status, list, devices] = await Promise.all([
    getSession(),
    serverGet("/auth/mfa", mfaStatusSchema),
    serverGet("/auth/passkeys", passkeyListSchema),
    serverGet("/auth/sessions", deviceSessionListSchema),
  ]);
  if (
    state.kind === "signed-out" ||
    status.kind === "signed-out" ||
    list.kind === "signed-out" ||
    devices.kind === "signed-out"
  ) {
    signInAgain("/app/account");
  }
  if (
    state.kind === "unavailable" ||
    status.kind === "unavailable" ||
    list.kind === "unavailable" ||
    devices.kind === "unavailable"
  ) {
    return <Unavailable />;
  }
  const sharedComputer = !state.data.session.persistent;
  const count = devices.data.sessions.length;
  return (
    <>
      <Row
        id="two-factor-heading"
        title="Two-factor authentication"
        sub="Ask for a code when you sign in."
        body={<TwoFactorSection status={status.data} sharedComputer={sharedComputer} />}
      >
        {status.data.totpEnabled ? <Pill tone="green">On</Pill> : <Pill tone="grey">Off</Pill>}
      </Row>
      <Row
        id="passkeys-heading"
        title="Passkeys"
        sub="Your phone, face, fingerprint or a security key."
        body={
          <PasskeysSection
            passkeys={list.data.passkeys}
            sharedComputer={sharedComputer}
            renderedAt={list.receivedAt}
          />
        }
      >
        <Pill tone={list.data.passkeys.length > 0 ? "green" : "grey"}>
          {list.data.passkeys.length === 0 ? "None" : String(list.data.passkeys.length)}
        </Pill>
      </Row>
      <Reveal
        id="password-heading"
        title="Password"
        sub="Changing it signs out your other devices."
        label="Change…"
      >
        <ChangePasswordForm />
      </Reveal>
      <Row
        title="Signed-in devices"
        sub={
          count === 1
            ? "1 device · this one"
            : `${String(count)} devices · this one and ${String(count - 1)} more`
        }
      >
        <Link href="/app/sessions" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          View
        </Link>
      </Row>
    </>
  );
}

async function Preferences() {
  const state = await getSession();
  if (state.kind === "signed-out") signInAgain("/app/account");
  if (state.kind === "unavailable") return <Unavailable />;
  const { session } = state.data;
  return (
    <>
      <Row title="Theme">
        <ThemeControl />
      </Row>
      <Row title="Accent colour">
        <AccentControl />
      </Row>
      <Row title="Desktop style">
        <DesktopStyleSegment />
      </Row>
      <Row title="Wallpaper">
        <WallpaperButton />
      </Row>
      <Row
        title="Shared-computer mode"
        sub={
          session.persistent
            ? "Off: you stay signed in on this device. Chosen when you sign in."
            : "On: signed out when the browser closes. Chosen when you sign in."
        }
      >
        {session.persistent ? <Pill tone="grey">Off</Pill> : <Pill tone="green">On</Pill>}
      </Row>
      <Row title="Idle timeout" sub="Signed out after this long without activity.">
        <span className="ad-li-title">
          {session.persistent ? "Never" : `${String(session.idleTimeoutMinutes)} min`}
        </span>
      </Row>
      <Row
        id="email-heading"
        title="Email notifications"
        sub="Which optional emails you get. Security and billing emails are always sent."
        body={<EmailPreferences />}
      />
    </>
  );
}

async function YourData() {
  const state = await getSession();
  if (state.kind === "signed-out") signInAgain("/app/account");
  if (state.kind === "unavailable") return <Unavailable />;
  return <DownloadData sharedComputer={!state.data.session.persistent} />;
}

async function DangerRows() {
  const [state, devices] = await Promise.all([
    getSession(),
    serverGet("/auth/sessions", deviceSessionListSchema),
  ]);
  if (state.kind === "signed-out" || devices.kind === "signed-out") signInAgain("/app/account");
  if (state.kind === "unavailable" || devices.kind === "unavailable") return <Unavailable />;
  const others = devices.data.sessions.filter((session) => !session.current).length;
  return (
    <>
      <Row title="Sign out everywhere" sub="Ends every session on every other device.">
        {others > 0 ? (
          <EndOtherSessionsButton count={others} />
        ) : (
          <Pill tone="grey">Only this device</Pill>
        )}
      </Row>
      <Row
        title="Delete account"
        sub="Removes your profiles, Drive files and team. This can’t be undone."
        body={<DeleteAccount email={state.data.account.email} />}
      />
    </>
  );
}

export default function AccountPage() {
  return (
    <PageContainer>
      <PageHeader title="Account">
        <p>Manage your profile, plan, security and preferences.</p>
      </PageHeader>
      <Grid cols={2}>
        <Card label="Profile">
          <Suspense fallback={<Skeleton className="h-16 w-full rounded-lg" />}>
            <ProfileCard />
          </Suspense>
        </Card>
        <Card label="Plan" aria-label="Plan">
          <Suspense fallback={<Skeleton className="h-16 w-full rounded-lg" />}>
            <Plan />
          </Suspense>
        </Card>
        <Panel>
          <InfoHead title="Security" />
          <Suspense fallback={<Skeleton className="m-4 h-24 rounded-lg" />}>
            <SecurityRows />
          </Suspense>
        </Panel>
        <Panel>
          <InfoHead title="Preferences">
            <span className="ad-info-count">Theme and accent are kept for this tab only</span>
          </InfoHead>
          <Suspense fallback={<Skeleton className="m-4 h-24 rounded-lg" />}>
            <Preferences />
          </Suspense>
        </Panel>
      </Grid>
      <Panel className="mb-[14px]">
        <InfoHead title="Your data" />
        <div className="px-4 py-3">
          <Suspense fallback={<Skeleton className="h-16 w-full rounded-lg" />}>
            <YourData />
          </Suspense>
        </div>
      </Panel>
      <Panel className="ad-danger">
        <InfoHead title="Danger zone" />
        <Suspense fallback={<Skeleton className="m-4 h-16 rounded-lg" />}>
          <DangerRows />
        </Suspense>
      </Panel>
    </PageContainer>
  );
}
