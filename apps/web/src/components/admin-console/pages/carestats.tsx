"use client";

import { type SupportStats, ticketCategoryNames } from "@brawzer/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchSupportStats } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { Card, fdt, fmtMinutes, HBar, Kpi, Loading, Pill } from "../ui";

/** Two weeks of requests opened and solved, as bars; drawn here, nothing invented. */
function DayBars({ days }: { days: SupportStats["perDay"] }) {
  const max = Math.max(1, ...days.map((day) => Math.max(day.opened, day.solved)));
  return (
    <div className="row" style={{ alignItems: "flex-end", gap: 6, height: 120 }} aria-hidden="true">
      {days.map((day) => (
        <div
          key={day.day}
          style={{ flex: 1, display: "flex", gap: 2, alignItems: "flex-end", height: "100%" }}
        >
          <div
            title={`${day.day}: ${String(day.opened)} opened`}
            style={{
              flex: 1,
              height: `${String(Math.round((day.opened / max) * 100))}%`,
              minHeight: day.opened ? 3 : 0,
              background: "var(--blue)",
              borderRadius: 3,
            }}
          />
          <div
            title={`${day.day}: ${String(day.solved)} solved`}
            style={{
              flex: 1,
              height: `${String(Math.round((day.solved / max) * 100))}%`,
              minHeight: day.solved ? 3 : 0,
              background: "var(--green)",
              borderRadius: 3,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Support performance, every figure from the requests themselves. */
export function CareStatsPage() {
  const [stats, setStats] = useState<SupportStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSupportStats().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) leaveSignedInArea("expired");
        setError(result.error.message);
        return;
      }
      setStats(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="warnbox">{error}</div>;
  if (!stats) return <Loading what="support performance" />;
  const opened14d = stats.perDay.reduce((sum, day) => sum + day.opened, 0);
  const solved14d = stats.perDay.reduce((sum, day) => sum + day.solved, 0);
  return (
    <>
      <div className="g4 grid" style={{ marginBottom: 16 }}>
        <Kpi
          label="Open"
          value={String(stats.open)}
          note={`${String(stats.pending)} waiting on customers`}
        />
        <Kpi
          label="Past response target"
          value={String(stats.pastTarget)}
          note="open, no reply yet"
          tone={stats.pastTarget > 0 ? "dn" : null}
        />
        <Kpi
          label="First reply, last 7 days"
          value={
            stats.firstResponse.medianMinutes === null
              ? "—"
              : fmtMinutes(stats.firstResponse.medianMinutes)
          }
          note={
            stats.firstResponse.withinTargetPercent === null
              ? "no first replies yet"
              : `median · ${String(stats.firstResponse.withinTargetPercent)}% within target`
          }
        />
        <Kpi
          label="Rating"
          value={stats.ratings.average === null ? "—" : `${String(stats.ratings.average)} / 5`}
          note={`${String(stats.ratings.count)} ratings · ${String(stats.ratings.low)} of 3 or less`}
        />
      </div>
      <div className="g21 grid">
        <div className="stack">
          <Card
            title="Opened and solved, last 14 days"
            right={
              <span className="muted sm">
                {String(opened14d)} opened · {String(solved14d)} solved
              </span>
            }
          >
            <DayBars days={stats.perDay} />
            <div className="row sm muted" style={{ gap: 14, marginTop: 8 }}>
              <span className="row" style={{ gap: 6 }}>
                <i style={{ width: 10, height: 10, background: "var(--blue)", borderRadius: 2 }} />
                Opened
              </span>
              <span className="row" style={{ gap: 6 }}>
                <i style={{ width: 10, height: 10, background: "var(--green)", borderRadius: 2 }} />
                Solved
              </span>
              <span style={{ marginLeft: "auto" }}>
                {stats.perDay[0]?.day} to {stats.perDay.at(-1)?.day}
              </span>
            </div>
          </Card>
          <Card title="Ratings of 3 or less to follow up" flush>
            <div className="muted sm" style={{ padding: "0 20px 8px" }}>
              A rating of 3 or less reopens the request. It counts as followed up once someone
              replies after the rating.
            </div>
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Customer</th>
                  <th>Rating</th>
                  <th>Handled by</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.lowRatings.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      No low ratings
                    </td>
                  </tr>
                ) : (
                  stats.lowRatings.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <Link href={`/admin/inbox?t=${entry.id}` as never}>#{entry.number}</Link>
                        <div className="muted sm">{entry.subject}</div>
                        {entry.comment && <div className="sm">“{entry.comment}”</div>}
                      </td>
                      <td>{entry.customer}</td>
                      <td>
                        {String(entry.rating)} / 5
                        <div className="muted sm">{fdt(entry.ratedAt)}</div>
                      </td>
                      <td>{entry.assignee ?? "—"}</td>
                      <td>
                        {entry.followedUp ? (
                          <Pill tone="g">Followed up</Pill>
                        ) : (
                          <Pill tone="o">Open</Pill>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="stack">
          <Card title="Open requests by topic">
            {stats.byCategory.length === 0 ? (
              <div className="muted sm">Nothing open</div>
            ) : (
              stats.byCategory.map((entry) => (
                <div key={entry.category} style={{ margin: "8px 0" }}>
                  <div className="row sm" style={{ justifyContent: "space-between" }}>
                    <span>{ticketCategoryNames[entry.category]}</span>
                    <span className="muted">{entry.open}</span>
                  </div>
                  <HBar value={(entry.open / Math.max(1, stats.open)) * 100} />
                </div>
              ))
            )}
          </Card>
          <Card title="Who is handling what" flush>
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Open</th>
                  <th>Solved, 7 days</th>
                </tr>
              </thead>
              <tbody>
                {stats.byAgent.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="empty">
                      Nothing assigned yet
                    </td>
                  </tr>
                ) : (
                  stats.byAgent.map((agent) => (
                    <tr key={agent.email}>
                      <td>{agent.email}</td>
                      <td>{agent.open}</td>
                      <td>{agent.solved7d}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
          <Card title="Response targets">
            <div className="muted sm">
              A first reply within 1 hour for urgent requests, 4 hours for high, 8 hours for normal
              and a day for low. The inbox sorts by what is closest to missing one.
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
