"use client";

import type { TechHealth } from "@brawzer/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchTechHealth } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { ago, Card, fmtMinutes, Kpi, Loading, Pill } from "../ui";

/** Queues & health: what the API measures about itself, nothing it doesn't. */
export function JobsPage() {
  const [data, setData] = useState<TechHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchTechHealth().then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          if (result.status === 401) leaveSignedInArea("expired");
          setError(result.error.message);
          return;
        }
        setData(result.data);
      });
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (error) return <div className="warnbox">{error}</div>;
  if (!data) return <Loading what="health" />;
  const down = data.checks.filter((entry) => entry.check.status !== "up");
  return (
    <>
      <div className="g4 grid" style={{ marginBottom: 16 }}>
        <Kpi
          label="Dependencies"
          value={down.length === 0 ? "All up" : `${String(down.length)} down`}
          note={`${String(data.checks.length)} checked just now`}
          tone={down.length ? "dn" : "up"}
        />
        <Kpi
          label="Session starts, 24 h"
          value={String(data.startedLast24h)}
          note={`${String(data.failedStarts24h)} never started`}
          tone={data.failedStarts24h > 0 ? "dn" : null}
        />
        <Kpi
          label="Live sessions"
          value={String(data.live)}
          note={`warm pool ${String(data.warmPool.size)} ready · ${String(data.warmPool.waiting)} waiting`}
        />
        <Kpi
          label="API up for"
          value={fmtMinutes(Math.round(data.uptimeSeconds / 60))}
          note={`version ${data.version}`}
        />
      </div>
      <div className="g2 grid">
        <Card title="Dependency checks" flush>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>State</th>
                <th>Answered in</th>
              </tr>
            </thead>
            <tbody>
              {data.checks.map((entry) => (
                <tr key={entry.key}>
                  <td>{entry.name}</td>
                  <td>
                    <Pill tone={entry.check.status === "up" ? "g" : "r"}>
                      {entry.check.status === "up" ? "Up" : "Down"}
                    </Pill>
                  </td>
                  <td className="muted">
                    {entry.check.latencyMs === null ? "—" : `${String(entry.check.latencyMs)} ms`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="stack">
          <Card title="Background work">
            <div className="list-i sm">
              <span style={{ flex: 1 }}>
                Retention (deletes what Brawzer no longer needs), every 6 hours
              </span>
              <span className="muted">
                {data.retentionLastRunAt
                  ? `ran ${ago(data.retentionLastRunAt)}`
                  : "not yet in this process"}
              </span>
            </div>
            <div className="list-i sm">
              <span style={{ flex: 1 }}>Warm pool (browsers started ahead of demand)</span>
              <span className="muted">{data.warmPool.size} ready</span>
            </div>
            <div className="muted sm" style={{ marginTop: 10 }}>
              Brawzer has no job queue with retries: emails send at once, scans run as files arrive,
              and Stripe retries its own webhooks. There is nothing to “retry failed” here.
            </div>
          </Card>
          <Card title="Waiting for a person">
            <div className="list-i sm">
              <span style={{ flex: 1 }}>Open support requests</span>
              <Link href="/admin/inbox">{data.openTickets}</Link>
            </div>
            <div className="list-i sm">
              <span style={{ flex: 1 }}>Reported pages</span>
              <Link href="/app/admin">{data.openReports}</Link>
            </div>
            <div className="list-i sm">
              <span style={{ flex: 1 }}>Quarantined files</span>
              <b>{data.quarantinedFiles}</b>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
