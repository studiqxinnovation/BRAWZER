"use client";

import { can, type Threats } from "@brawzer/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { blockAddress, fetchThreats, unblockAddress } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { ago, Card, fdt, FormDialog, Kpi, Loading, Pill, ReasonDialog, Tabs } from "../ui";
import { useAction } from "../use-action";

type Tab = "events" | "blocks" | "staff";

const EVENT_NAMES: Record<string, string> = {
  "sign_in.failed": "Failed sign-in",
  "sign_in.new_device": "Sign-in from a new device",
  "mfa.failed": "Wrong two-factor code",
  "mfa.disabled": "Two-factor turned off",
  "mfa.recovery_code_used": "Recovery code used",
  "passkey.removed": "Passkey removed",
  "password.reset_requested": "Password reset asked for",
  "password.reset": "Password reset",
  "email.change_requested": "Email change asked for",
  "sessions.revoked": "Devices signed out",
  "recovery.requested": "Account recovery confirmed",
  "recovery.cancelled": "Account recovery cancelled by owner",
  "recovery.released": "Account released after recovery",
  "recovery.denied": "Account recovery denied",
  "session.locked": "Session locked",
};
const SERIOUS = new Set([
  "recovery.cancelled",
  "mfa.disabled",
  "passkey.removed",
  "recovery.released",
  "sessions.revoked",
]);

/** Failed sign-ins per hour, drawn here from the counts. */
function HourBars({ hours }: { hours: Threats["failedPerHour"] }) {
  const max = Math.max(1, ...hours.map((hour) => hour.count));
  return (
    <div className="row" style={{ alignItems: "flex-end", gap: 3, height: 110 }} aria-hidden="true">
      {hours.map((hour) => (
        <div
          key={hour.hour}
          title={`${new Date(hour.hour).getHours().toString().padStart(2, "0")}:00 · ${String(hour.count)} failed`}
          style={{
            flex: 1,
            height: `${String(Math.round((hour.count / max) * 100))}%`,
            minHeight: hour.count ? 3 : 1,
            background: hour.count ? "var(--rfg)" : "var(--line)",
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
}

/** Threats & sign-ins: what the security events say, the addresses refused, who is protected. */
export function SecurityPage() {
  const me = useStaff();
  const [tab, setTab] = useState<Tab>("events");
  const [data, setData] = useState<Threats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState<Threats["blocked"][number] | null>(null);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void fetchThreats().then((result) => {
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
  if (!data) return <Loading what="security" />;
  const may = can(me.role, "blockIp");
  return (
    <>
      <div className="g4 grid" style={{ marginBottom: 16 }}>
        <Kpi
          label="Failed sign-ins, 24 h"
          value={String(data.failed24h)}
          note={`${String(data.lockedNow)} accounts refused right now`}
          tone={data.lockedNow > 0 ? "dn" : null}
        />
        <Kpi
          label="Blocked addresses"
          value={String(data.blocked.length)}
          note="refused at sign-in and sign-up"
        />
        <Kpi
          label="Accounts with a passkey or 2FA"
          value={`${String(data.secondFactorPercent)}%`}
          note="of all accounts"
        />
        <Kpi
          label="Staff with a second factor"
          value={`${String(data.staffWithSecondFactor)} / ${String(data.staffTotal)}`}
          note="must be everyone"
          tone={data.staffWithSecondFactor === data.staffTotal ? "up" : "dn"}
        />
      </div>
      <Tabs
        label="Security"
        tabs={[
          { key: "events", label: "Security events", count: data.events.length },
          { key: "blocks", label: "Blocked addresses", count: data.blocked.length },
          { key: "staff", label: "Staff sign-ins", count: data.staffSignIns.length },
        ]}
        current={tab}
        onChange={setTab}
      />
      {tab === "events" && (
        <>
          <Card title="Failed sign-ins per hour, last 24 hours">
            <HourBars hours={data.failedPerHour} />
            <div className="muted sm" style={{ marginTop: 8 }}>
              Eight failures in fifteen minutes lock an account until the window passes; a password
              reset ends the lock. Block an address from the row when one network keeps trying.
            </div>
          </Card>
          <div className="card p0" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Who</th>
                  <th>Address</th>
                  <th>Device</th>
                  <th style={{ textAlign: "right" }} />
                </tr>
              </thead>
              <tbody>
                {data.events.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      Nothing to look at
                    </td>
                  </tr>
                ) : (
                  data.events.map((event) => (
                    <tr key={event.id}>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>
                        {ago(event.at)}
                      </td>
                      <td>
                        <Pill
                          tone={
                            SERIOUS.has(event.type)
                              ? "r"
                              : event.type === "sign_in.failed" || event.type === "mfa.failed"
                                ? "o"
                                : "b"
                          }
                        >
                          {EVENT_NAMES[event.type] ?? event.type}
                        </Pill>
                        {event.detail && <div className="muted sm">{event.detail}</div>}
                      </td>
                      <td>
                        {event.customer ? (
                          <>
                            <Link href={`/admin/customers/${event.customer.id}` as never}>
                              {event.customer.handle}
                            </Link>
                            {event.staff && (
                              <>
                                {" "}
                                <Pill tone="p">staff</Pill>
                              </>
                            )}
                          </>
                        ) : (
                          <span className="muted">Unknown account</span>
                        )}
                      </td>
                      <td className="mask">
                        {event.ipAddress ?? "—"}
                        {event.blocked && (
                          <>
                            {" "}
                            <Pill tone="r">Blocked</Pill>
                          </>
                        )}
                      </td>
                      <td className="sm muted">{event.device ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        {event.ipAddress && !event.blocked && may && (
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => {
                              setBlocking(event.ipAddress);
                            }}
                          >
                            Block address
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "blocks" && (
        <div className="card p0">
          <div
            className="row"
            style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}
          >
            <span className="muted sm">
              Blocked addresses and networks can’t sign in or create accounts. Blocks take effect
              within 30 seconds everywhere. Nothing wider than a /16 at once.
            </span>
            {may && (
              <button
                type="button"
                className="btn pri sm"
                style={{ marginLeft: "auto" }}
                onClick={() => {
                  setBlocking("");
                }}
              >
                Block an address
              </button>
            )}
          </div>
          <table>
            <thead>
              <tr>
                <th>Address or network</th>
                <th>Why</th>
                <th>By</th>
                <th>Lifts</th>
                <th style={{ textAlign: "right" }} />
              </tr>
            </thead>
            <tbody>
              {data.blocked.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Nothing blocked
                  </td>
                </tr>
              ) : (
                data.blocked.map((entry) => (
                  <tr key={entry.id}>
                    <td className="mask">{entry.cidr}</td>
                    <td className="sm">{entry.reason}</td>
                    <td className="muted sm">
                      {entry.createdBy ?? "—"} · {ago(entry.createdAt)}
                    </td>
                    <td className="muted sm">
                      {entry.expiresAt ? fdt(entry.expiresAt) : "when removed"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {may && (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            setUnblocking(entry);
                          }}
                        >
                          Unblock
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {tab === "staff" && (
        <div className="card p0">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Staff member</th>
                <th>Role</th>
                <th>Address</th>
                <th>Device</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {data.staffSignIns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    No staff sign-ins in the last 30 days
                  </td>
                </tr>
              ) : (
                data.staffSignIns.map((entry, index) => (
                  <tr key={index}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {fdt(entry.at)}
                    </td>
                    <td>{entry.email}</td>
                    <td>{entry.role}</td>
                    <td className="mask">{entry.ipAddress ?? "—"}</td>
                    <td className="sm muted">{entry.device ?? "—"}</td>
                    <td>{entry.ok ? <Pill tone="g">OK</Pill> : <Pill tone="r">Failed</Pill>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {blocking !== null && (
        <FormDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setBlocking(null);
              action.setProblem(null);
            }
          }}
          title="Block an address"
          intro="Sign-in and sign-up are refused from it. Use a network only when one address keeps changing."
          fields={[
            {
              key: "cidr",
              label: "Address or network",
              required: true,
              value: blocking,
              placeholder: "203.0.113.4 or 203.0.113.0/24",
            },
            { key: "reason", label: "Why (saved to the audit log)", required: true },
            { key: "hours", label: "Hours until it lifts (blank = until removed)", type: "number" },
          ]}
          okText="Block"
          busy={action.busy}
          error={action.problem}
          onSubmit={(values) => {
            void action
              .run(
                () =>
                  blockAddress({
                    cidr: values.cidr ?? "",
                    reason: values.reason ?? "",
                    ...(values.hours ? { hours: Number(values.hours) } : {}),
                  }),
                "Blocked",
              )
              .then((result) => {
                if (result) {
                  setData(result.data);
                  setBlocking(null);
                }
              });
          }}
        />
      )}
      {unblocking && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setUnblocking(null);
          }}
          title={`Unblock ${unblocking.cidr}?`}
          text="Sign-in from it works again within 30 seconds."
          okText="Unblock"
          reason={false}
          busy={action.busy}
          error={action.problem}
          onConfirm={() => {
            const entry = unblocking;
            void action
              .run(() => unblockAddress(entry.id), "Unblocked")
              .then((result) => {
                if (result) {
                  setData(result.data);
                  setUnblocking(null);
                }
              });
          }}
        />
      )}
    </>
  );
}
