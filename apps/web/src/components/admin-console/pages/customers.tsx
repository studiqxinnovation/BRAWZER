"use client";

import {
  type CustomerList,
  type CustomerSummary,
  type CustomerView,
  customerViews,
} from "@brawzer/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchCustomers } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { ago, Avatar, Kpi, Loading, money, Pill, StatusPill, Tabs } from "../ui";

const VIEW_LABELS: Record<CustomerView, string> = {
  all: "All",
  attention: "Need attention",
  past_due: "Payment failed",
  locked: "Locked or suspended",
  drive_full: "Drive full",
  no_2fa: "No 2FA",
  staff: "Staff",
};

export function issuePill(customer: CustomerSummary) {
  const issues = customer.issues;
  if (issues.length === 0) return <Pill tone="g">OK</Pill>;
  const tone = issues.some((i) => i.severity === "high")
    ? "r"
    : issues.some((i) => i.severity === "medium")
      ? "o"
      : "b";
  return (
    <Pill tone={tone}>
      {issues.length} issue{issues.length > 1 ? "s" : ""}
    </Pill>
  );
}

/** Every account, with the account check, found by typing; a row opens the 360 view. */
export function CustomersPage() {
  const router = useRouter();
  const [view, setView] = useState<CustomerView>("all");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ key: string; data: CustomerList } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${view}:${query.trim().toLowerCase()}`;
  const current = result?.key === key ? result.data : null;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void fetchCustomers({ view, q: query.trim() || undefined }).then((response) => {
          if (cancelled) return;
          if (!response.ok) {
            if (response.status === 401) leaveSignedInArea("expired");
            setError(response.error.message);
            return;
          }
          setError(null);
          setResult({ key, data: response.data });
        });
      },
      query ? 200 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view, query, key]);

  const counts = current?.counts ?? result?.data.counts;
  return (
    <>
      {counts && (
        <div className="g4 grid" style={{ marginBottom: 16 }}>
          <Kpi
            label="Accounts"
            value={String(counts.accounts)}
            note={`${String(counts.joined30d)} joined in the last 30 days`}
          />
          <Kpi
            label="Active this week"
            value={String(counts.active7d)}
            note="signed in during the last 7 days"
          />
          <Kpi
            label="Need attention"
            value={String(counts.attention)}
            note="found by the account check"
            tone={counts.attention ? "dn" : null}
          />
          <Kpi label="Staff" value={String(counts.views.staff)} note="accounts with a role here" />
        </div>
      )}
      <Tabs
        label="Views"
        tabs={customerViews.map((v) => ({
          key: v,
          label: VIEW_LABELS[v],
          count: counts?.views[v] ?? null,
        }))}
        current={view}
        onChange={setView}
      />
      <div className="card p0">
        <div
          className="row"
          style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}
        >
          <input
            className="in"
            aria-label="Search customers"
            placeholder="Search email, ID, organisation, plan"
            style={{ width: 340 }}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <span className="muted sm" style={{ marginLeft: "auto" }}>
            {current ? `${String(current.customers.length)} customers` : ""}
          </span>
        </div>
        {error ? (
          <div className="warnbox" style={{ margin: 16 }}>
            {error}
          </div>
        ) : !current ? (
          <Loading what="customers" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Account check</th>
                <th>Joined</th>
                <th>Last active</th>
                <th style={{ textAlign: "right" }}>MRR</th>
              </tr>
            </thead>
            <tbody>
              {current.customers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    No customers match
                  </td>
                </tr>
              ) : (
                current.customers.map((customer) => (
                  <tr
                    key={customer.id}
                    className="click"
                    onClick={() => {
                      router.push(`/admin/customers/${customer.id}` as never);
                    }}
                  >
                    <td>
                      <div className="row">
                        <Avatar name={customer.handle} size={30} />
                        <div style={{ minWidth: 0 }}>
                          <a href={`/admin/customers/${customer.id}`} style={{ color: "inherit" }}>
                            {customer.email}
                          </a>{" "}
                          {customer.role !== "user" && <Pill tone="p">Staff</Pill>}
                          <div className="muted sm">
                            {customer.id.slice(0, 8)}
                            {customer.teamName ? ` · ${customer.teamName}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{customer.planName}</td>
                    <td>
                      <StatusPill status={customer.status} />
                    </td>
                    <td>{issuePill(customer)}</td>
                    <td className="muted">{ago(customer.createdAt)}</td>
                    <td className="muted">{ago(customer.lastActiveAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      {customer.mrr > 0 ? money(customer.mrr, customer.currency) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
