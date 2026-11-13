"use client";

import type { CompanyOverview } from "@brawzer/contracts";
import {
  Bell,
  Building2,
  CreditCard as CardIcon,
  Inbox,
  KeyRound,
  Server,
  Shield,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchOverview } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useAlerts, useStaff } from "../shell";
import { ago, Avatar, Card, Empty, Kpi, LineChart, Loading, money } from "../ui";

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** The founder's page: the company at a glance, every figure counted from the database. */
export function OverviewPage() {
  const staff = useStaff();
  const { setAlerts } = useAlerts();
  const [data, setData] = useState<CompanyOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchOverview().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) leaveSignedInArea("expired");
        setError(result.error.message);
        return;
      }
      setData(result.data);
      const alerts = [];
      if (result.data.attention > 0) {
        alerts.push({
          text: `${String(result.data.attention)} accounts need attention`,
          detail: "Found by the account check",
          page: "customers",
        });
      }
      if (result.data.pastDue > 0) {
        alerts.push({
          text: `${String(result.data.pastDue)} failed payments`,
          detail: "Stripe is retrying",
          page: "customers",
        });
      }
      if (result.data.staffWithoutSecondFactor > 0) {
        alerts.push({
          text: `${String(result.data.staffWithoutSecondFactor)} staff without a passkey or two-factor`,
          detail: "Team & access",
          page: "team",
        });
      }
      if (result.data.staleStaff > 0) {
        alerts.push({
          text: `${String(result.data.staleStaff)} staff account${result.data.staleStaff === 1 ? "" : "s"} unused for 60+ days`,
          detail: "Remove access you don’t need",
          page: "team",
        });
      }
      setAlerts(alerts);
    });
    return () => {
      cancelled = true;
    };
  }, [setAlerts]);

  if (error) return <div className="warnbox">{error}</div>;
  if (!data) return <Loading what="the overview" />;

  const mrr = data.mrr.find((entry) => entry.currency === data.currency)?.amount ?? 0;
  const last = data.mrrLastMonth.find((entry) => entry.currency === data.currency)?.amount ?? 0;
  const growth = last > 0 ? ((mrr / last - 1) * 100).toFixed(1) : null;
  const todo = [
    data.attention > 0 && {
      icon: Users,
      text: `${String(data.attention)} accounts need attention`,
      href: "/admin/customers",
    },
    data.pastDue > 0 && {
      icon: CardIcon,
      text: `${String(data.pastDue)} failed payments`,
      href: "/admin/customers",
    },
    data.openReports > 0 && {
      icon: Inbox,
      text: `${String(data.openReports)} reported pages open`,
      href: "/app/admin",
    },
    data.staffWithoutSecondFactor > 0 && {
      icon: Shield,
      text: `${String(data.staffWithoutSecondFactor)} staff without a passkey or two-factor`,
      href: "/admin/team",
    },
    data.staleStaff > 0 && {
      icon: KeyRound,
      text: `${String(data.staleStaff)} staff account${data.staleStaff === 1 ? "" : "s"} unused for 60+ days: remove access`,
      href: "/admin/team",
    },
  ].filter((entry): entry is Exclude<typeof entry, false> => Boolean(entry));

  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontFamily: "var(--adm-font-d)",
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-.02em",
          }}
        >
          {greeting()}, {staff.email.split("@")[0]}
        </div>
        <div className="muted">
          {data.liveSessions} {data.liveSessions === 1 ? "person is" : "people are"} browsing right
          now. {data.accounts} accounts, {data.teams} organisations.
        </div>
      </div>
      <div className="g4 grid">
        <Kpi
          label="Monthly recurring revenue"
          value={data.stripeConfigured ? money(mrr, data.currency) : "—"}
          note={
            data.stripeConfigured
              ? growth !== null
                ? `${Number(growth) >= 0 ? "▲" : "▼"} ${growth}% vs last month`
                : "No subscriptions last month"
              : "Stripe isn’t configured: only the free plan exists"
          }
          tone={growth !== null ? (Number(growth) >= 0 ? "up" : "dn") : null}
        />
        <Kpi
          label="Annual run rate"
          value={data.stripeConfigured ? money(mrr * 12, data.currency) : "—"}
          note="MRR × 12"
        />
        <Kpi
          label="Paying accounts"
          value={String(data.payingAccounts)}
          note={`${String(Math.round((data.payingAccounts / Math.max(1, data.accounts)) * 100))}% of ${String(data.accounts)} accounts pay`}
        />
        <Kpi
          label="Live sessions"
          value={`${String(data.liveSessions)} / ${String(data.liveSessionLimit)}`}
          note="cloud browsers running now"
        />
      </div>
      <div className="g21 grid" style={{ marginTop: 16 }}>
        <Card
          title="Revenue, last 12 months"
          right={
            <Link href="/admin/growth" className="btn sm">
              Growth
            </Link>
          }
        >
          {data.stripeConfigured ? (
            <LineChart
              series={[
                {
                  name: "MRR",
                  colour: "var(--blue)",
                  points: data.revenueByMonth.map((entry) => [entry.month, entry.amount / 100]),
                },
              ]}
              zero
              format={(value) => money(Math.round(value * 100), data.currency)}
            />
          ) : (
            <Empty>Revenue appears once Stripe is configured and plans are sold.</Empty>
          )}
        </Card>
        <Card title="Needs you today">
          {todo.length === 0 ? (
            <div className="okbox" style={{ margin: 0 }}>
              Nothing urgent
            </div>
          ) : (
            todo.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.text}
                  href={item.href as never}
                  className="list-i"
                  style={{ color: "inherit" }}
                >
                  <Icon aria-hidden="true" width={16} height={16} />
                  <span className="sm" style={{ flex: 1 }}>
                    {item.text}
                  </span>
                  <span className="muted">›</span>
                </Link>
              );
            })
          )}
        </Card>
      </div>
      <h3 style={{ margin: "26px 0 12px", fontSize: 17 }}>Departments</h3>
      <div className="g3 grid">
        <Dept
          icon={Users}
          name="Customers"
          big={`${String(data.joined30d)} joined in 30 days`}
          small={`${String(data.active7d)} active this week`}
          href="/admin/customers"
        />
        <Dept
          icon={CardIcon}
          name="Billing"
          big={`${String(data.pastDue)} failed payments`}
          small={
            data.stripeConfigured
              ? `${String(data.payingAccounts)} paying`
              : "Stripe not configured"
          }
          href="/admin/settings"
          tone={data.pastDue ? "dn" : "up"}
        />
        <Dept
          icon={Building2}
          name="Organisations"
          big={`${String(data.teams)} organisations`}
          small={data.largestTeams[0] ? `Largest: ${data.largestTeams[0].name}` : "None yet"}
          href="/admin/orgs"
        />
        <Dept
          icon={Server}
          name="Technical"
          big={`${String(data.liveSessions)} live sessions`}
          small={`of ${String(data.liveSessionLimit)} the installation allows`}
          href="/app/admin"
        />
        <Dept
          icon={Shield}
          name="Security"
          big={`${String(data.staffWithoutSecondFactor)} staff without 2FA`}
          small={`${String(data.openReports)} reported pages`}
          href="/admin/team"
          tone={data.staffWithoutSecondFactor ? "dn" : "up"}
        />
        <Dept
          icon={Bell}
          name="Audit"
          big={`${String(data.recentActions.length)} recent actions`}
          small="Every staff action is logged"
          href="/admin/audit"
        />
      </div>
      <div className="g2 grid" style={{ marginTop: 16 }}>
        <Card title="Largest organisations" flush>
          <table>
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Members</th>
                <th>Plan</th>
              </tr>
            </thead>
            <tbody>
              {data.largestTeams.length === 0 ? (
                <tr>
                  <td colSpan={3} className="empty">
                    No organisations yet
                  </td>
                </tr>
              ) : (
                data.largestTeams.map((team) => (
                  <tr key={team.id}>
                    <td>
                      <Link
                        href={`/admin/orgs/${team.id}` as never}
                        className="row"
                        style={{ color: "inherit" }}
                      >
                        <Avatar name={team.name} size={26} />
                        {team.name}
                      </Link>
                    </td>
                    <td>
                      {team.members}/{team.memberLimit}
                    </td>
                    <td>{team.planName}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
        <Card
          title="Recent staff activity"
          right={
            <Link href="/admin/audit" className="btn sm">
              Audit log
            </Link>
          }
        >
          {data.recentActions.length === 0 ? (
            <div className="muted sm">Nothing yet</div>
          ) : (
            data.recentActions.map((action) => (
              <div key={action.id} className="list-i sm">
                <Avatar name={action.actorEmail ?? action.actorRole} size={24} />
                <div style={{ flex: 1 }}>
                  <b style={{ fontWeight: 500 }}>
                    {(action.actorEmail ?? action.actorRole).split("@")[0]}
                  </b>{" "}
                  {action.action.toLowerCase()}{" "}
                  <span className="muted">{action.target.slice(0, 8)}</span>
                </div>
                <span className="muted">{ago(action.at)}</span>
              </div>
            ))
          )}
        </Card>
      </div>
    </>
  );
}

function Dept({
  icon: Icon,
  name,
  big,
  small,
  href,
  tone = "muted",
}: {
  icon: typeof Users;
  name: string;
  big: string;
  small: string;
  href: string;
  tone?: "up" | "dn" | "muted";
}) {
  return (
    <Link
      href={href as never}
      className="card"
      style={{ color: "inherit", textDecoration: "none" }}
    >
      <div className="row muted sm" style={{ marginBottom: 10 }}>
        <Icon aria-hidden="true" width={16} height={16} />
        {name}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{big}</div>
      <div className={`sm ${tone}`} style={{ marginTop: 4 }}>
        {small}
      </div>
    </Link>
  );
}
