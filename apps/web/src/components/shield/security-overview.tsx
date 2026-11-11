import type { Profile, SecurityOverview } from "@brawzer/contracts";
import { buttonVariants } from "@brawzer/ui/lib/button-variants";
import { cn } from "@brawzer/ui/lib/cn";
import Link from "next/link";
import { Card, Grid, InfoHead, Panel, Pill, Row } from "@/components/app-shell/page";
import { Tile } from "@/components/desktop/apps/registry";
import { AdBlockerSwitch } from "@/components/home/ad-blocker-switch";
import { recommendationContent } from "@/content/app";
import { timeAgo } from "@/lib/time";

const BLOCKERS = new Set(["ublock-origin", "ubo-lite"]);
const RING = 2 * Math.PI * 34;

/**
 * Shield, laid out as the prototype's: the protection score (how many of
 * the account's protections are on), failed sign-ins and signed-in
 * devices, then the protections themselves beside the issues to fix, and
 * sign-ins from new places. Every figure is the account's own.
 */
export function SecurityOverviewSections({
  overview,
  profile,
  renderedAt,
}: {
  overview: SecurityOverview;
  /** The first profile: its ad and tracker blocker is one of the protections. */
  profile: Profile | null;
  renderedAt: number;
}) {
  const blocker = profile?.extensions.some((slug) => BLOCKERS.has(slug)) ?? false;
  const protections: { title: string; sub: string; on: boolean; control: React.ReactNode }[] = [
    {
      title: "Two-factor authentication",
      sub: "A code from your authenticator after your password.",
      on: overview.twoFactorEnabled,
      control: overview.twoFactorEnabled ? (
        <Pill tone="green">On</Pill>
      ) : (
        <Link
          href="/app/account#two-factor-heading"
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          Turn on
        </Link>
      ),
    },
    {
      title: "Passkeys",
      sub: "Sign in with your phone, face, fingerprint or a security key.",
      on: overview.passkeys > 0,
      control:
        overview.passkeys > 0 ? (
          <Pill tone="green">{String(overview.passkeys)} saved</Pill>
        ) : (
          <Link
            href="/app/account#passkeys-heading"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            Add one
          </Link>
        ),
    },
    ...(profile
      ? [
          {
            title: "Ad and tracker blocker",
            sub: `uBlock Origin in “${profile.name}”, from its next session.`,
            on: blocker,
            control: <AdBlockerSwitch profile={profile} />,
          },
        ]
      : []),
    {
      title: "Recovery codes",
      sub: overview.twoFactorEnabled
        ? `${String(overview.recoveryCodesRemaining)} left to sign in without your authenticator.`
        : "Come with two-factor authentication.",
      on: overview.twoFactorEnabled && overview.recoveryCodesRemaining >= 3,
      control: overview.twoFactorEnabled ? (
        <Pill tone={overview.recoveryCodesRemaining >= 3 ? "green" : "orange"}>
          {String(overview.recoveryCodesRemaining)} left
        </Pill>
      ) : (
        <Pill tone="grey">Off</Pill>
      ),
    },
  ];
  const on = protections.filter((item) => item.on).length;
  const score = Math.round((on / protections.length) * 100);
  const ringColour = score === 100 ? "#34d399" : score >= 50 ? "#fbbf24" : "#f87171";
  const issues = overview.recommendations;

  return (
    <>
      <Grid cols={3}>
        <Card label="Protection score" className="ad-shield-score">
          <div className="flex items-center gap-[14px]">
            <div className="ad-ring" aria-hidden="true">
              <svg viewBox="0 0 84 84">
                <circle className="ad-ring-track" cx="42" cy="42" r="34" />
                <circle
                  className="ad-ring-fill"
                  cx="42"
                  cy="42"
                  r="34"
                  stroke={ringColour}
                  strokeDasharray={RING.toFixed(1)}
                  strokeDashoffset={(RING * (1 - score / 100)).toFixed(1)}
                  transform="rotate(-90 42 42)"
                />
              </svg>
              <div className="ad-ring-num">{score}</div>
            </div>
            <div>
              <p className="ad-li-title">
                {score === 100
                  ? "Fully protected"
                  : `${String(protections.length - on)} protection${protections.length - on === 1 ? "" : "s"} off`}
              </p>
              <p className="ad-li-sub">
                {String(on)} of {String(protections.length)} on
              </p>
            </div>
          </div>
        </Card>
        <Card label="Failed sign-ins, last 7 days">
          <p className="ad-stat-big">{String(overview.recentFailedAttempts)}</p>
          <p className="ad-stat-small">
            {overview.recentFailedAttempts === 0
              ? "Wrong passwords or codes: none"
              : "Wrong passwords or codes on your account"}
          </p>
        </Card>
        <Card label="Signed-in devices">
          <p className="ad-stat-big">{String(overview.signedInDevices)}</p>
          <p className="ad-stat-small">
            {overview.signedInDevices <= 1 ? (
              "Only this device"
            ) : (
              <Link href="/app/sessions" className="underline underline-offset-2">
                Review them in Sessions
              </Link>
            )}
          </p>
        </Card>
      </Grid>

      <Grid cols={2}>
        <Panel>
          <InfoHead title="Protections" />
          {protections.map((item) => (
            <Row key={item.title} title={item.title} sub={item.sub}>
              {item.control}
            </Row>
          ))}
        </Panel>
        <Panel>
          <InfoHead title="Issues">
            <Pill tone={issues.length > 0 ? "orange" : "green"}>
              {issues.length > 0 ? `${String(issues.length)} open` : "None"}
            </Pill>
          </InfoHead>
          {issues.length === 0 ? (
            <p className="ad-empty">Nothing to fix right now.</p>
          ) : (
            <ul aria-label="Recommendations">
              {issues.map(({ id }) => {
                const content = recommendationContent[id];
                return (
                  <li key={id}>
                    <Row
                      icon={<Tile glyph="warn" colour="orange" size={38} />}
                      title={content.title}
                      sub={content.body}
                    >
                      <Link
                        href={content.href}
                        className={cn(buttonVariants({ variant: "primary", size: "sm" }))}
                      >
                        {content.action}
                      </Link>
                    </Row>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </Grid>

      <Panel>
        <InfoHead title="Alerts">
          <span className="ad-info-count">Sign-ins from new places, last 30 days</span>
        </InfoHead>
        {overview.newDeviceSignIns.length === 0 ? (
          <p className="ad-empty">No sign-ins from new devices or networks in the last 30 days.</p>
        ) : (
          <ul aria-label="Sign-ins from new devices">
            {overview.newDeviceSignIns.map((event) => (
              <li key={event.id}>
                <Row
                  icon={<Tile glyph="bell" colour="red" size={38} />}
                  title={`New sign-in from ${event.device ?? "an unknown browser"}`}
                  sub={
                    <>
                      <time dateTime={event.occurredAt}>
                        {timeAgo(event.occurredAt, renderedAt)}
                      </time>
                      {event.ipAddress && <> · IP address {event.ipAddress}</>}. If it wasn’t you,
                      sign that device out and change your password.
                    </>
                  }
                >
                  <Link
                    href="/app/sessions"
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    This wasn’t me
                  </Link>
                </Row>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
