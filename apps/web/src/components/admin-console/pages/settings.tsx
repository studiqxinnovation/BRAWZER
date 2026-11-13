"use client";

import type { AdminSettings } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { fetchSettings } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { Card, fsize, Loading, money, Pill, Tabs } from "../ui";

type Tab = "plans" | "services" | "company";

/** Plans as the installation configures them and the services it connects to; read-only, honestly. */
export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("plans");
  const [data, setData] = useState<AdminSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSettings().then((result) => {
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
  if (!data) return <Loading what="settings" />;
  return (
    <>
      <Tabs
        label="Settings"
        tabs={[
          { key: "plans", label: "Plans & limits" },
          { key: "services", label: "Connected services" },
          { key: "company", label: "Company details" },
        ]}
        current={tab}
        onChange={setTab}
      />
      {tab === "plans" && (
        <>
          <div className="card p0">
            <table>
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Price</th>
                  <th>Sessions at once</th>
                  <th>Browsing time</th>
                  <th>Drive</th>
                  <th>Profiles</th>
                  <th>Team</th>
                  <th>Accounts</th>
                </tr>
              </thead>
              <tbody>
                {data.plans.map((plan) => (
                  <tr key={plan.code}>
                    <td>
                      <b style={{ fontWeight: 500 }}>{plan.name}</b>{" "}
                      <span className="mask muted">{plan.code}</span>
                    </td>
                    <td>
                      {plan.price
                        ? `${money(plan.price.amount, plan.price.currency, true)} / ${plan.price.interval}`
                        : plan.code === "free"
                          ? "Free"
                          : "Price in Stripe"}
                    </td>
                    <td>{plan.limits.liveSessions}</td>
                    <td>
                      {plan.limits.browsingMinutesPerMonth === null
                        ? "Unlimited"
                        : `${String(Math.round(plan.limits.browsingMinutesPerMonth / 60))} h a month`}
                    </td>
                    <td>{fsize(plan.limits.driveBytes)}</td>
                    <td>{plan.limits.profiles}</td>
                    <td>
                      {plan.limits.teamMembers === 1
                        ? "—"
                        : `${String(plan.limits.teamMembers)} people`}
                    </td>
                    <td>{plan.accounts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="infobox" style={{ marginTop: 14 }}>
            Plans and limits come from the installation’s BILLING_PLANS and prices from Stripe. They
            aren’t edited here: a change is a configuration change, rolled out with a release, and
            existing customers are told in advance.
          </div>
        </>
      )}
      {tab === "services" && (
        <div className="g3 grid">
          {data.services.map((service) => (
            <Card
              key={service.name}
              title={service.name}
              right={
                <Pill
                  tone={
                    service.state === "configured"
                      ? "g"
                      : service.state === "development"
                        ? "o"
                        : ""
                  }
                >
                  {service.state === "configured"
                    ? "Configured"
                    : service.state === "development"
                      ? "Development"
                      : "Off"}
                </Pill>
              }
            >
              <div className="muted sm">{service.purpose}</div>
              <div className="sm" style={{ marginTop: 6 }}>
                {service.detail}
              </div>
            </Card>
          ))}
        </div>
      )}
      {tab === "company" && (
        <Card title="Company details">
          <dl className="kv">
            <dt>Product</dt>
            <dd>Brawzer</dd>
            <dt>Founders</dt>
            <dd>
              {data.adminEmails.length ? data.adminEmails.join(", ") : "None named in ADMIN_EMAILS"}
            </dd>
            <dt>Company</dt>
            <dd className="muted">
              Add once registered: these details live with the hosting configuration.
            </dd>
          </dl>
        </Card>
      )}
    </>
  );
}
