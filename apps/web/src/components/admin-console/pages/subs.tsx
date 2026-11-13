"use client";

import {
  type SubscriptionList,
  type SubscriptionView,
  subscriptionViews,
} from "@brawzer/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchSubscriptions } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { ago, Avatar, fdate, Kpi, Loading, money, Pill, Tabs } from "../ui";

const VIEW_LABEL: Record<SubscriptionView, string> = {
  all: "All subscriptions",
  past_due: "Failed payments",
  trialing: "Trials",
  cancelling: "Cancelling",
};
const STATUS_TONE: Record<string, "g" | "o" | "r" | "b" | ""> = {
  active: "g",
  trialing: "b",
  past_due: "o",
  canceled: "",
  unpaid: "r",
};

/** Subscriptions as Brawzer last heard from Stripe: who pays, who is failing, who is leaving. */
export function SubscriptionsPage() {
  const [view, setView] = useState<SubscriptionView>("all");
  const [data, setData] = useState<SubscriptionList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSubscriptions().then((result) => {
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
  if (!data) return <Loading what="subscriptions" />;
  const paying = data.subscriptions.filter((entry) =>
    ["active", "trialing", "past_due"].includes(entry.status),
  );
  const shown =
    view === "all"
      ? data.subscriptions
      : view === "cancelling"
        ? paying.filter((entry) => entry.cancelAtPeriodEnd)
        : paying.filter((entry) => entry.status === view);
  return (
    <>
      {!data.stripeConfigured && (
        <div className="infobox">
          Stripe isn’t configured on this installation, so nothing is billed. Paid plans here are
          set by hand from an account’s billing tab.
        </div>
      )}
      <div className="g4 grid" style={{ marginBottom: 16 }}>
        <Kpi
          label="Paying subscriptions"
          value={String(data.counts.all)}
          note={
            data.setByHand ? `plus ${String(data.setByHand)} paid plans set by hand` : "from Stripe"
          }
        />
        <Kpi
          label="Payments failing"
          value={String(data.counts.past_due)}
          note={`${money(data.atRisk.amount, data.atRisk.currency)} a month at risk`}
          tone={data.counts.past_due > 0 ? "dn" : null}
        />
        <Kpi
          label="Trials"
          value={String(data.counts.trialing)}
          note="card on file, not yet charged"
        />
        <Kpi
          label="Cancelling"
          value={String(data.counts.cancelling)}
          note="end at the period’s end"
        />
      </div>
      <Tabs
        label="Subscriptions"
        tabs={subscriptionViews.map((key) => ({
          key,
          label: VIEW_LABEL[key],
          count: key === "all" ? data.subscriptions.length : data.counts[key],
        }))}
        current={view}
        onChange={setView}
      />
      {view === "past_due" && (
        <div className="infobox">
          How failed payments work: Stripe retries the card on its schedule and emails the customer
          each time; they keep their plan meanwhile. When Stripe gives up, the subscription ends and
          the account moves to Free with its files.
        </div>
      )}
      <div className="card p0">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Plan</th>
              <th>Status</th>
              <th>{view === "cancelling" ? "Ends" : "Renews"}</th>
              <th>Since</th>
              <th style={{ textAlign: "right" }}>MRR</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">
                  Nothing here
                </td>
              </tr>
            ) : (
              shown.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <div className="row">
                      <Avatar name={entry.customer.handle} size={28} />
                      <div>
                        <Link href={`/admin/customers/${entry.customer.id}` as never}>
                          {entry.customer.handle}
                        </Link>
                        <div className="muted sm mask">{entry.customer.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>{entry.planName}</td>
                  <td>
                    <Pill tone={STATUS_TONE[entry.status] ?? ""}>
                      {entry.status.replace("_", " ")}
                    </Pill>
                    {entry.cancelAtPeriodEnd && (
                      <>
                        {" "}
                        <Pill tone="o">Cancelling</Pill>
                      </>
                    )}
                  </td>
                  <td className="muted">
                    {entry.currentPeriodEnd ? fdate(entry.currentPeriodEnd) : "—"}
                  </td>
                  <td className="muted">{ago(entry.createdAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    {entry.mrr && ["active", "trialing", "past_due"].includes(entry.status)
                      ? money(entry.mrr.amount, entry.mrr.currency)
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
