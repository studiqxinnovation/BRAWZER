"use client";

import type { Finance } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { fetchFinance } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { Card, Loading, money } from "../ui";

/** Finance reports: monthly revenue movements from Brawzer's own subscription records. */
export function FinancePage() {
  const [data, setData] = useState<Finance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchFinance().then((result) => {
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
  if (!data) return <Loading what="finance" />;
  const m = (amount: number) => money(amount, data.currency);
  const exportCsv = () => {
    const rows = [
      [
        "month",
        "start_mrr",
        "new",
        "upgrades",
        "downgrades",
        "lost",
        "end_mrr",
        "new_count",
        "lost_count",
      ],
      ...data.months.map((month) => [
        month.month,
        month.start,
        month.newAmount,
        month.upgrades,
        month.downgrades,
        -month.lostAmount,
        month.end,
        month.newCount,
        month.lostCount,
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `brawzer-revenue-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="muted sm">
          For your accountant. Amounts are monthly recurring revenue in minor units of{" "}
          {data.currency.toUpperCase()}, from the plans’ prices; Stripe’s own reports hold the
          actual charges, fees and tax.
        </span>
        <button type="button" className="btn sm" style={{ marginLeft: "auto" }} onClick={exportCsv}>
          Download CSV
        </button>
      </div>
      <Card title="Monthly revenue movements" flush>
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th style={{ textAlign: "right" }}>Start</th>
              <th style={{ textAlign: "right" }}>New</th>
              <th style={{ textAlign: "right" }}>Upgrades</th>
              <th style={{ textAlign: "right" }}>Downgrades</th>
              <th style={{ textAlign: "right" }}>Lost</th>
              <th style={{ textAlign: "right" }}>End</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((month) => (
              <tr key={month.month}>
                <td>{month.month}</td>
                <td style={{ textAlign: "right" }} className="muted">
                  {m(month.start)}
                </td>
                <td style={{ textAlign: "right" }} className={month.newAmount ? "up" : "muted"}>
                  +{m(month.newAmount)}
                  {month.newCount ? <div className="muted sm">{month.newCount} new</div> : null}
                </td>
                <td style={{ textAlign: "right" }} className={month.upgrades ? "up" : "muted"}>
                  +{m(month.upgrades)}
                </td>
                <td style={{ textAlign: "right" }} className={month.downgrades ? "dn" : "muted"}>
                  −{m(month.downgrades)}
                </td>
                <td style={{ textAlign: "right" }} className={month.lostAmount ? "dn" : "muted"}>
                  −{m(month.lostAmount)}
                  {month.lostCount ? <div className="muted sm">{month.lostCount} ended</div> : null}
                </td>
                <td style={{ textAlign: "right" }}>
                  <b>{m(month.end)}</b>
                  {month.unvaluedChanges ? (
                    <div className="muted sm">{month.unvaluedChanges} changes not valued</div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="g2 grid" style={{ marginTop: 16 }}>
        <Card title="What this is, and isn’t">
          <div className="sm" style={{ lineHeight: 1.6 }}>
            Start and End are the monthly value of subscriptions in force at each month’s edges.
            New, Upgrades, Downgrades and Lost come from the subscription events Brawzer recorded.
            “Changes not valued” are plan changes recorded before Brawzer kept the previous plan.
            {data.setByHand > 0 &&
              ` ${String(data.setByHand)} paid plans are set by hand and bring in nothing here.`}
          </div>
        </Card>
        <Card title="Tax, fees and cash">
          <div className="sm" style={{ lineHeight: 1.6 }}>
            VAT, Stripe’s fees and what reached the bank are in Stripe’s reports and your accounting
            software; Brawzer doesn’t keep a second copy.{" "}
            {data.stripeConfigured ? "" : "Stripe isn’t configured on this installation."}
          </div>
        </Card>
      </div>
    </>
  );
}
