"use client";

import { type BillingOverview, type BrowserOverview, engineDetails } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { fetchBillingOverview } from "@/lib/api/billing";
import { fetchBrowserOverview } from "@/lib/api/browser";

const minutes = (total: number) => {
  const hours = Math.floor(total / 60);
  return hours > 0 ? `${String(hours)} h ${String(total % 60)} min` : `${String(total)} min`;
};
const bytes = (value: number) =>
  value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GB`
    : value >= 1024 ** 2
      ? `${(value / 1024 ** 2).toFixed(1)} MB`
      : `${String(Math.round(value / 1024))} KB`;

function Meter({
  label,
  used,
  limit,
  shown,
}: {
  label: string;
  used: number;
  limit: number | null;
  shown: string;
}) {
  return (
    <div className="ap-meter">
      <span className="ap-meter-row">
        <b>{label}</b>
        <span>{shown}</span>
      </span>
      {limit !== null && (
        <span
          className="ap-bar"
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
        >
          <i style={{ width: `${String(Math.min(100, (used / limit) * 100))}%` }} />
        </span>
      )}
    </div>
  );
}

/** Usage: this month's browsing by browser, and the plan's limits, as the account measures them. */
export default function UsageApp() {
  const [browser, setBrowser] = useState<BrowserOverview | null>(null);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  useEffect(() => {
    void Promise.all([fetchBrowserOverview(), fetchBillingOverview()]).then(([overview, plan]) => {
      if (overview.ok) setBrowser(overview.data);
      if (plan.ok) setBilling(plan.data);
    });
  }, []);
  const byBrowser = browser?.activity.minutesThisMonth ?? [];
  const busiest = Math.max(1, ...byBrowser.map((entry) => entry.minutes));
  const limits = billing?.plan.limits;
  const usage = billing?.usage;

  return (
    <div className="ap-body">
      <div className="ap-main ap-usage-app">
        {billing && (
          <p className="ap-note">
            {billing.plan.name} plan{billing.team ? `, from the team “${billing.team.name}”` : ""}.
          </p>
        )}
        <section className="ap-card" aria-labelledby="usage-browsing">
          <h2 id="usage-browsing" className="ap-group-title">
            Browsing this month
          </h2>
          {byBrowser.length === 0 ? (
            <p className="ap-note">No browsing yet this month.</p>
          ) : (
            <ul className="ap-bars">
              {byBrowser.map((entry) => (
                <li key={entry.engine}>
                  <span>{engineDetails[entry.engine].short}</span>
                  <span className="ap-bar" aria-hidden="true">
                    <i
                      style={{ width: `${String(Math.max(3, (entry.minutes / busiest) * 100))}%` }}
                    />
                  </span>
                  <span>{minutes(entry.minutes)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {usage && limits && (
          <section className="ap-card" aria-labelledby="usage-limits">
            <h2 id="usage-limits" className="ap-group-title">
              Your plan’s limits
            </h2>
            <Meter
              label="Browsing time"
              used={usage.browsingMinutesThisMonth}
              limit={limits.browsingMinutesPerMonth}
              shown={`${minutes(usage.browsingMinutesThisMonth)}${limits.browsingMinutesPerMonth === null ? " · no monthly limit" : ` of ${minutes(limits.browsingMinutesPerMonth)}`}`}
            />
            <Meter
              label="Drive storage"
              used={usage.driveBytes}
              limit={limits.driveBytes}
              shown={`${bytes(usage.driveBytes)} of ${bytes(limits.driveBytes)}`}
            />
            <Meter
              label="Drive files"
              used={usage.driveFiles}
              limit={limits.driveFiles}
              shown={`${String(usage.driveFiles)} of ${String(limits.driveFiles)}`}
            />
            <Meter
              label="Profiles"
              used={usage.profiles}
              limit={limits.profiles}
              shown={`${String(usage.profiles)} of ${String(limits.profiles)}`}
            />
            <Meter
              label="Browsers open now"
              used={browser?.sessions.length ?? 0}
              limit={limits.liveSessions}
              shown={`${String(browser?.sessions.length ?? 0)} of ${String(limits.liveSessions)}`}
            />
          </section>
        )}
      </div>
    </div>
  );
}
