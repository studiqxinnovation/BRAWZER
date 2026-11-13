"use client";

import {
  type BillingOverview,
  type BrowserEngine,
  type BrowserOverview,
  engineDetails,
} from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppIconArt } from "@/components/browser/engine-logo";
import { fetchBillingOverview } from "@/lib/api/billing";
import { fetchBrowserOverview } from "@/lib/api/browser";
import {
  type ScreenTime,
  loadScreenTime,
  readScreenTime,
  resetScreenTime,
  subscribeToScreenTime,
  today,
} from "@/lib/screen-time";
import { BrawzerTile } from "../dock";
import { AppIcon, apps, isAppId } from "./registry";

const NO_SCREEN_TIME: ScreenTime = {};

const duration = (seconds: number) => {
  if (seconds < 60) return `${String(seconds)}s`;
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  return hours > 0 ? `${String(hours)}h ${String(total % 60)}m` : `${String(total)}m`;
};

/** What screen time calls an app, as a name and an icon. */
function appShown(key: string) {
  if (key === "brawzer") return { name: "Brawzer", icon: <BrawzerTile size={22} /> };
  if (key.startsWith("browser:")) {
    const engine = key.slice("browser:".length) as BrowserEngine;
    const details = (engineDetails as Partial<Record<string, { short: string }>>)[engine];
    return {
      name: details?.short ?? "Browser",
      icon: (
        <span className="ap-ut-art" aria-hidden="true">
          <AppIconArt engine={engine} />
        </span>
      ),
    };
  }
  if (isAppId(key)) return { name: apps[key].name, icon: <AppIcon app={key} size={22} /> };
  return { name: key, icon: null };
}

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
  const screenTime = useSyncExternalStore<ScreenTime>(
    subscribeToScreenTime,
    readScreenTime,
    () => NO_SCREEN_TIME,
  );
  useEffect(() => {
    void loadScreenTime();
  }, []);
  const day = today();
  const todayApps = Object.entries(screenTime[day] ?? {}).sort((a, b) => b[1] - a[1]);
  const todayTotal = todayApps.reduce((sum, [, seconds]) => sum + seconds, 0);
  const longest = Math.max(1, ...todayApps.map(([, seconds]) => seconds));
  const week = Array.from({ length: 7 }, (_, back) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - back));
    const total = Object.values(screenTime[today(date)] ?? {}).reduce(
      (sum, value) => sum + value,
      0,
    );
    return { label: date.toLocaleDateString([], { weekday: "short" }), total };
  });
  const busiestDay = Math.max(1, ...week.map((entry) => entry.total));
  const byBrowser = browser?.activity.minutesThisMonth ?? [];
  const busiest = Math.max(1, ...byBrowser.map((entry) => entry.minutes));
  const limits = billing?.plan.limits;
  const usage = billing?.usage;

  return (
    <div className="ap-body">
      <div className="ap-main ap-usage-app">
        <div className="ap-ut-head">
          <div>
            <h2 className="ap-ut-h">Today</h2>
            <span className="ap-hint">{duration(todayTotal)} of screen time on this desktop</span>
          </div>
          <Button size="sm" onClick={() => void resetScreenTime()}>
            Reset
          </Button>
        </div>
        <section className="ap-fc-card" aria-label="Screen time this week">
          <ol className="ap-fc-chart" aria-label="Screen time each day">
            {week.map((entry, index) => (
              <li key={index} aria-label={`${entry.label}: ${duration(entry.total)}`}>
                <i
                  style={{ height: `${String(Math.max(3, (entry.total / busiestDay) * 100))}%` }}
                />
                <span aria-hidden="true">{entry.label}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="ap-fc-card" aria-label="Screen time by app today">
          {todayApps.length === 0 ? (
            <p className="ap-hint">
              Apps you use today show here, with how long each was in front.
            </p>
          ) : (
            <ul className="ap-ut-apps">
              {todayApps.map(([key, seconds]) => {
                const shown = appShown(key);
                return (
                  <li key={key}>
                    {shown.icon}
                    <span className="ap-ut-main">
                      <span className="ap-ut-row">
                        <span>{shown.name}</span>
                        <span>{duration(seconds)}</span>
                      </span>
                      <span className="ap-bar" aria-hidden="true">
                        <i
                          style={{ width: `${String(Math.max(3, (seconds / longest) * 100))}%` }}
                        />
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
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
