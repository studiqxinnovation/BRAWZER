import type { SecurityOverview } from "@brawzer/contracts";
import { buttonVariants } from "@brawzer/ui/lib/button-variants";
import { cn } from "@brawzer/ui/lib/cn";
import { CircleAlert, CircleCheck, MonitorSmartphone } from "lucide-react";
import Link from "next/link";
import { Panel, SectionHeading } from "@/components/app-shell/page";
import { recommendationContent } from "@/content/app";
import { timeAgo } from "@/lib/time";

type Tone = "good" | "attention" | "neutral";

function StatusIcon({ tone }: { tone: Tone }) {
  if (tone === "good") return <CircleCheck aria-hidden="true" className="size-4 text-success" />;
  if (tone === "attention")
    return <CircleAlert aria-hidden="true" className="size-4 text-warning" />;
  return null;
}

/** How the account is protected, what would protect it better, and sign-ins from new places. */
export function SecurityOverviewSections({
  overview,
  renderedAt,
}: {
  overview: SecurityOverview;
  renderedAt: number;
}) {
  const strongSignIn = overview.passkeys > 0 || overview.twoFactorEnabled;
  const status: { label: string; value: string; tone: Tone }[] = [
    {
      label: "Passkeys",
      value: overview.passkeys === 0 ? "None" : String(overview.passkeys),
      tone: overview.passkeys > 0 ? "good" : strongSignIn ? "neutral" : "attention",
    },
    {
      label: "Two-factor",
      value: overview.twoFactorEnabled ? "On" : "Off",
      tone: overview.twoFactorEnabled ? "good" : strongSignIn ? "neutral" : "attention",
    },
    { label: "Signed-in devices", value: String(overview.signedInDevices), tone: "neutral" },
    {
      label: "Failed attempts, last 7 days",
      value: String(overview.recentFailedAttempts),
      tone: overview.recentFailedAttempts > 0 ? "attention" : "neutral",
    },
  ];

  return (
    <>
      <section aria-labelledby="protection-heading" className="flex flex-col gap-4">
        <SectionHeading id="protection-heading">Protection</SectionHeading>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
          {status.map((item) => (
            <div key={item.label} className="flex flex-col gap-1 bg-surface p-4">
              <dt className="text-footnote text-ink-secondary">{item.label}</dt>
              <dd className="flex items-center gap-1.5 text-title-3 text-ink">
                {item.value}
                <StatusIcon tone={item.tone} />
              </dd>
            </div>
          ))}
        </dl>

        {overview.recommendations.length === 0 ? (
          <p className="text-callout text-ink-secondary">No recommendations right now.</p>
        ) : (
          <ul aria-label="Recommendations" className="flex flex-col gap-3">
            {overview.recommendations.map(({ id }) => {
              const content = recommendationContent[id];
              return (
                <li key={id}>
                  <Panel className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                    <div className="flex flex-col gap-1">
                      <p className="text-body font-semibold text-ink">{content.title}</p>
                      <p className="text-callout text-pretty text-ink-secondary">{content.body}</p>
                    </div>
                    <Link
                      href={content.href}
                      className={cn(
                        buttonVariants({ variant: "secondary", size: "sm" }),
                        "shrink-0 self-start sm:self-center",
                      )}
                    >
                      {content.action}
                    </Link>
                  </Panel>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="alerts-heading" className="flex flex-col gap-4">
        <SectionHeading id="alerts-heading">Alerts</SectionHeading>
        {overview.newDeviceSignIns.length === 0 ? (
          <p className="text-callout text-ink-secondary">
            No sign-ins from new devices or networks in the last 30 days.
          </p>
        ) : (
          <>
            <ul aria-label="Sign-ins from new devices" className="flex flex-col gap-3">
              {overview.newDeviceSignIns.map((event) => (
                <li key={event.id}>
                  <Panel className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                    <div className="flex items-start gap-3">
                      <MonitorSmartphone
                        aria-hidden="true"
                        className="mt-0.5 size-5 shrink-0 text-warning"
                      />
                      <div className="flex flex-col gap-1">
                        <p className="text-body font-semibold text-ink">
                          New sign-in from {event.device ?? "an unknown browser"}
                        </p>
                        <p className="text-footnote text-ink-secondary">
                          <time dateTime={event.occurredAt}>
                            {timeAgo(event.occurredAt, renderedAt)}
                          </time>
                          {event.ipAddress && <> · IP address {event.ipAddress}</>}
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/app/sessions"
                      className={cn(
                        buttonVariants({ variant: "secondary", size: "sm" }),
                        "shrink-0 self-start sm:self-center",
                      )}
                    >
                      This wasn’t me
                    </Link>
                  </Panel>
                </li>
              ))}
            </ul>
            <p className="text-footnote text-ink-secondary">
              If a sign-in wasn’t you, sign that device out in Sessions and change your password.
            </p>
          </>
        )}
      </section>
    </>
  );
}
