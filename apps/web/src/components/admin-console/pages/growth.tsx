"use client";

import type { Growth } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { fetchGrowth } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { Bars, Card, Kpi, LineChart, Loading, money, percent } from "../ui";

/** Growth and retention: sign-ups, activation, the funnel and retention by month, from the database. */
export function GrowthPage() {
  const [data, setData] = useState<Growth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchGrowth().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) leaveSignedInArea("expired");
        setError(result.error.message);
        return;
      }
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="warnbox">{error}</div>;
  if (!data) return <Loading what="growth" />;

  const thisMonth = data.months.at(-1);
  const lastMonth = data.months.at(-2);
  const change =
    thisMonth && lastMonth && lastMonth.signUps > 0
      ? Math.round((thisMonth.signUps / lastMonth.signUps - 1) * 100)
      : null;
  const funnel = data.funnel;
  const steps: [string, number][] = [
    ["Created an account", funnel.signedUp],
    ["Confirmed their email", funnel.verified],
    ["Opened a cloud browser", funnel.openedBrowser],
    ["Used it on 3+ days", funnel.usedThreeDays],
    ["Started paying", funnel.paying],
  ];
  const churnedThisMonth = thisMonth?.churned ?? 0;
  return (
    <>
      <div className="g4 grid">
        <Kpi
          label="Sign-ups this month"
          value={String(thisMonth?.signUps ?? 0)}
          note={
            change === null
              ? "Nothing to compare with"
              : `${change >= 0 ? "▲" : "▼"} ${String(Math.abs(change))}% vs last month`
          }
          tone={change === null ? null : change >= 0 ? "up" : "dn"}
        />
        <Kpi
          label="Activation"
          value={`${String(percent(funnel.openedBrowser, funnel.signedUp))}%`}
          note="opened a cloud browser, of the last 12 months’ sign-ups"
        />
        <Kpi
          label="Free → paid"
          value={`${String(percent(funnel.paying, funnel.signedUp))}%`}
          note="of the last 12 months’ sign-ups"
        />
        <Kpi
          label="Subscriptions ended this month"
          value={String(churnedThisMonth)}
          note={`${String(thisMonth?.converted ?? 0)} started`}
          tone={churnedThisMonth > (thisMonth?.converted ?? 0) ? "dn" : "up"}
        />
      </div>
      <div className="g2 grid" style={{ marginTop: 16 }}>
        <Card title="Sign-ups and activated accounts">
          <LineChart
            zero
            series={[
              {
                name: "Sign-ups",
                colour: "var(--blue)",
                points: data.months.map((m) => [m.month, m.signUps]),
              },
              {
                name: "Activated",
                colour: "var(--green)",
                points: data.months.map((m) => [m.month, m.activated]),
              },
            ]}
          />
        </Card>
        <Card title="Sign-up to paid, last 12 months">
          <div className="funnel">
            {steps.map((step, index) => {
              const first = steps[0]?.[1] ?? 0;
              const previous = steps[index - 1]?.[1] ?? 0;
              return (
                <div key={step[0]}>
                  <div
                    className="fb"
                    style={{
                      width: `${String(Math.max(8, first > 0 ? (step[1] / first) * 100 : 8))}%`,
                      opacity: 1 - index * 0.13,
                    }}
                  >
                    {step[1].toLocaleString()}
                  </div>
                  <span className="sm">
                    {step[0]}
                    {index > 0 && (
                      <span className="muted"> ({String(percent(step[1], previous))}%)</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <div className="g2 grid" style={{ marginTop: 16 }}>
        <Card title="Monthly retention by sign-up month" flush>
          <table className="cohort">
            <thead>
              <tr>
                <th>Joined</th>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <th key={i} style={{ textAlign: "center" }}>
                    M{i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.retention.map((row) => (
                <tr key={row.month}>
                  <td>{row.month}</td>
                  {[0, 1, 2, 3, 4, 5].map((i) => {
                    const value = row.kept[i];
                    return value === undefined ? (
                      <td key={i} />
                    ) : (
                      <td
                        key={i}
                        style={{
                          background: `rgba(0,113,227,${(value / 100) * 0.55})`,
                          color: value > 60 ? "#fff" : "inherit",
                        }}
                      >
                        {value}%
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted sm" style={{ padding: "10px 20px 16px" }}>
            Active means signed in during that month, counted from sessions.
          </div>
        </Card>
        <Card title="Accounts and revenue by plan">
          <Bars
            rows={data.byPlan.map((plan) => [plan.planName, plan.accounts] as [string, number])}
          />
          <table style={{ marginTop: 8 }}>
            <tbody>
              {data.byPlan.map((plan) => (
                <tr key={plan.planCode}>
                  <td>{plan.planName}</td>
                  <td className="muted" style={{ textAlign: "right" }}>
                    {plan.mrr > 0 ? `${money(plan.mrr, data.currency)}/mo` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
