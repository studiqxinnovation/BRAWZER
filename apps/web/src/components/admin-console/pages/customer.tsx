"use client";

import { can, type Customer, type CustomerIssue, type StaffNote } from "@brawzer/contracts";
import { useToast } from "@brawzer/ui/components/toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import {
  addCustomerNote,
  deleteCustomer,
  deleteCustomerNote,
  disableCustomerTwoFactor,
  endCustomerSession,
  fetchCustomer,
  fetchCustomerActivity,
  fetchCustomerBilling,
  fetchCustomerBrowsers,
  fetchCustomerDrive,
  fetchCustomerPrivacy,
  fetchCustomerSignIn,
  liftCustomerSuspension,
  removeCustomerPasskey,
  restoreCustomerFile,
  revealCustomer,
  sendResetLink,
  setCustomerPlan,
  signOutCustomer,
  signOutCustomerDevice,
  suspendCustomer,
} from "@/lib/api/console";
import type { ApiResult } from "@/lib/api/client";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import {
  ago,
  Avatar,
  Card,
  fdate,
  fdt,
  fmtMinutes,
  FormDialog,
  fsize,
  HBar,
  Loading,
  minutesSince,
  money,
  percent,
  Pill,
  ReasonDialog,
  StatusPill,
  Tabs,
} from "../ui";

type TabKey = "overview" | "signin" | "billing" | "browsers" | "drive" | "activity" | "privacy";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "signin", label: "Sign-in & security" },
  { key: "billing", label: "Subscription & billing" },
  { key: "browsers", label: "Browsers & sessions" },
  { key: "drive", label: "Drive" },
  { key: "activity", label: "Activity" },
  { key: "privacy", label: "Privacy & data" },
];

const SEVERITY: Record<CustomerIssue["severity"], "r" | "o" | "b"> = {
  high: "r",
  medium: "o",
  low: "b",
};

/** A request that needs a recent sign-in, with the result handled the same way everywhere. */
function useAction() {
  const toast = useToast();
  const confirmed = useConfirmedRequest();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(request: () => Promise<ApiResult<T>>, done: string): Promise<{ data: T } | null> => {
      setBusy(true);
      setProblem(null);
      const result = await confirmed(request);
      setBusy(false);
      if (result.ok) {
        toast.add({ type: "success", title: done });
        return { data: result.data };
      }
      if (result.status === 401) leaveSignedInArea("expired");
      else if (result.error.code !== "reauthentication_required") setProblem(result.error.message);
      return null;
    },
    [confirmed, toast],
  );
  return { run, busy, problem, setProblem };
}

/** The customer 360 view: the prototype's head, tabs and actions, every figure the account's own. */
export function CustomerPage({ id }: { id: string }) {
  const me = useStaff();
  const [tab, setTab] = useState<TabKey>("overview");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [noting, setNoting] = useState(false);
  const [version, setVersion] = useState(0);
  const action = useAction();
  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchCustomer(id).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) leaveSignedInArea("expired");
        setError(result.error.message);
        return;
      }
      setCustomer(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  if (error) return <div className="warnbox">{error}</div>;
  if (!customer) return <Loading what="the account" />;
  const email = revealed ?? customer.email;
  const mayReveal = !customer.revealed && revealed === null && can(me.role, "reveal");
  const issues = customer.issues;

  return (
    <>
      <div className="crumb">
        <Link href="/admin/customers">Customers</Link> › {customer.id.slice(0, 8)}
      </div>
      <div className="phead">
        <Avatar name={customer.handle} size={56} />
        <div style={{ minWidth: 0 }}>
          <h2>
            {customer.handle}
            {customer.role !== "user" && (
              <>
                {" "}
                <Pill tone="p">Staff</Pill>
              </>
            )}
          </h2>
          <div className="row sm muted" style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <StatusPill status={customer.status} />
            <span>
              {customer.planName}
              {customer.teamName && (
                <>
                  {" "}
                  ·{" "}
                  <Link href={`/admin/orgs/${customer.teamId ?? ""}` as never}>
                    {customer.teamName}
                  </Link>{" "}
                  ({customer.teamRole})
                </>
              )}
            </span>
            <span>·</span>
            <span className={customer.revealed || revealed ? "" : "mask"}>{email}</span>
            {mayReveal && (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setRevealing(true);
                }}
              >
                Reveal
              </button>
            )}
            <span>·</span>
            <span>Customer since {fdate(customer.createdAt)}</span>
          </div>
        </div>
        <div className="acts">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setNoting(true);
            }}
          >
            Add note
          </button>
        </div>
      </div>
      <Tabs
        label="Account"
        tabs={TABS.map((entry) => ({
          ...entry,
          count: entry.key === "overview" && issues.length ? issues.length : null,
        }))}
        current={tab}
        onChange={setTab}
      />
      {tab === "overview" && (
        <OverviewTab
          customer={customer}
          role={me.role}
          reload={reload}
          onNotes={(notes) => {
            setCustomer((current) => (current ? { ...current, notes } : current));
          }}
        />
      )}
      {tab === "signin" && <SignInTab id={id} role={me.role} version={version} reload={reload} />}
      {tab === "billing" && <BillingTab id={id} role={me.role} version={version} reload={reload} />}
      {tab === "browsers" && (
        <BrowsersTab id={id} role={me.role} version={version} reload={reload} />
      )}
      {tab === "drive" && <DriveTab id={id} role={me.role} version={version} reload={reload} />}
      {tab === "activity" && <ActivityTab id={id} version={version} />}
      {tab === "privacy" && <PrivacyTab id={id} version={version} />}

      <ReasonDialog
        open={revealing}
        onOpenChange={setRevealing}
        title="Reveal personal details?"
        text="Email addresses are hidden by default. Revealing them is recorded in the audit log with your reason."
        okText="Reveal"
        busy={action.busy}
        error={action.problem}
        onConfirm={(reason) => {
          void action
            .run(() => revealCustomer(id, reason), "Revealed, and logged")
            .then((result) => {
              if (result) {
                setRevealed(result.data.email);
                setRevealing(false);
              }
            });
        }}
      />
      <FormDialog
        open={noting}
        onOpenChange={setNoting}
        title="Internal note"
        fields={[
          { key: "body", label: "Note (only staff can see this)", area: true, required: true },
          {
            key: "pinned",
            label: "Pin to the top?",
            options: [
              { value: "no", label: "No" },
              { value: "yes", label: "Yes" },
            ],
          },
        ]}
        okText="Save"
        busy={action.busy}
        error={action.problem}
        onSubmit={(values) => {
          void action
            .run(
              () =>
                addCustomerNote(id, { body: values.body ?? "", pinned: values.pinned === "yes" }),
              "Note saved",
            )
            .then((result) => {
              if (result) {
                setNoting(false);
                setCustomer((current) => (current ? { ...current, notes: result.data } : current));
              }
            });
        }}
      />
    </>
  );
}

/* ── Overview ── */

function OverviewTab({
  customer,
  role,
  reload,
  onNotes,
}: {
  customer: Customer;
  role: string;
  reload: () => void;
  onNotes: (notes: StaffNote[]) => void;
}) {
  const router = useRouter();
  const action = useAction();
  const [confirm, setConfirm] = useState<"reset" | "suspend" | "lift" | "delete" | null>(null);
  const notes = customer.notes;
  const drivePercent = percent(customer.driveBytes, customer.driveLimitBytes);
  const fixes: Partial<
    Record<
      NonNullable<CustomerIssue["fix"]>,
      { label: string; permission: Parameters<typeof can>[1]; onClick: () => void }
    >
  > = {
    reset_link: {
      label: "Send reset link",
      permission: "signout",
      onClick: () => {
        setConfirm("reset");
      },
    },
    lift_suspension: {
      label: "Lift suspension",
      permission: "suspend",
      onClick: () => {
        setConfirm("lift");
      },
    },
  };
  return (
    <div className="g21 grid">
      <div className="stack">
        <Card
          title={`Account check${customer.issues.length ? ` · ${String(customer.issues.length)} to look at` : ""}`}
        >
          {customer.issues.length === 0 ? (
            <div className="okbox" style={{ margin: 0 }}>
              No problems found. Sign-in, billing, Drive and sessions all look healthy.
            </div>
          ) : (
            customer.issues.map((issue) => {
              const fix = issue.fix ? fixes[issue.fix] : undefined;
              return (
                <div key={issue.title} className="list-i" style={{ alignItems: "flex-start" }}>
                  <Pill tone={SEVERITY[issue.severity]}>{""}</Pill>
                  <div style={{ flex: 1 }}>
                    <b style={{ fontWeight: 500 }}>{issue.title}</b>
                    <div className="muted sm" style={{ marginTop: 2, lineHeight: 1.5 }}>
                      {issue.detail}
                    </div>
                  </div>
                  {fix && (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={!can(role, fix.permission)}
                      title={can(role, fix.permission) ? undefined : "Your role can’t do this"}
                      onClick={fix.onClick}
                    >
                      {fix.label}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </Card>
        <div className="mini-k">
          <div>
            <div className="l">Live sessions</div>
            <div className="v">
              {customer.liveSessions} / {customer.sessionLimit}
            </div>
          </div>
          <div>
            <div className="l">Browsing this month</div>
            <div className="v">{fmtMinutes(customer.browsingMinutesThisMonth)}</div>
          </div>
          <div>
            <div className="l">Drive</div>
            <div className="v">{drivePercent}%</div>
          </div>
          <div>
            <div className="l">Files</div>
            <div className="v">{customer.driveFiles}</div>
          </div>
        </div>
        <Card title="Notes">
          {notes.length === 0 ? (
            <div className="muted sm">No notes yet. Notes are only visible to staff.</div>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="msg note">
                <div className="mh">
                  {note.pinned && <Pill tone="o">Pinned</Pill>}
                  <b>{note.authorEmail ?? "staff"}</b>
                  <span style={{ marginLeft: "auto" }}>{ago(note.createdAt)}</span>
                  <button
                    type="button"
                    className="btn sm"
                    aria-label="Delete note"
                    onClick={() => {
                      void action
                        .run(() => deleteCustomerNote(customer.id, note.id), "Note deleted")
                        .then((result) => {
                          if (result) onNotes(result.data);
                        });
                    }}
                  >
                    Delete
                  </button>
                </div>
                {note.body}
              </div>
            ))
          )}
        </Card>
      </div>
      <div className="stack">
        <Card title="At a glance">
          <dl className="kv">
            <dt>Plan</dt>
            <dd>
              {customer.planName}
              {customer.source === "admin"
                ? " (set by hand)"
                : customer.source === "stripe"
                  ? " (subscription)"
                  : ""}
            </dd>
            <dt>Account ID</dt>
            <dd className="mask">{customer.id}</dd>
            <dt>Last active</dt>
            <dd>{ago(customer.lastActiveAt)}</dd>
            <dt>Drive</dt>
            <dd>
              <div className="row">
                <div style={{ width: 110 }}>
                  <HBar value={drivePercent} />
                </div>
                {fsize(customer.driveBytes)} of {fsize(customer.driveLimitBytes)}
              </div>
            </dd>
            {customer.suspendedAt && (
              <>
                <dt>Suspended</dt>
                <dd>
                  {fdt(customer.suspendedAt)} · {customer.suspendedReason}
                </dd>
              </>
            )}
          </dl>
        </Card>
        <div className="card dz" style={{ padding: 0 }}>
          <div className="ch" style={{ padding: "14px 16px 0" }}>
            <h2 style={{ color: "var(--red)" }}>Danger zone</h2>
          </div>
          <div className="list-i">
            <div style={{ flex: 1 }}>
              <b style={{ fontWeight: 500 }}>
                {customer.status === "suspended" ? "Lift suspension" : "Suspend account"}
              </b>
              <div className="muted sm">
                Signs them out everywhere and blocks sign-in. Data is kept.
              </div>
            </div>
            <button
              type="button"
              className="btn sm dng"
              disabled={!can(role, "suspend") || customer.role !== "user"}
              title={can(role, "suspend") ? undefined : "Your role can’t do this"}
              onClick={() => {
                setConfirm(customer.status === "suspended" ? "lift" : "suspend");
              }}
            >
              {customer.status === "suspended" ? "Lift" : "Suspend"}
            </button>
          </div>
          <div className="list-i">
            <div style={{ flex: 1 }}>
              <b style={{ fontWeight: 500 }}>Delete account</b>
              <div className="muted sm">
                Everything goes now: files, profiles, passwords, history. There is no undo.
              </div>
            </div>
            <button
              type="button"
              className="btn sm dng"
              disabled={!can(role, "deleteData") || customer.role !== "user"}
              title={can(role, "deleteData") ? undefined : "Your role can’t do this"}
              onClick={() => {
                setConfirm("delete");
              }}
            >
              Delete…
            </button>
          </div>
        </div>
      </div>

      <ReasonDialog
        open={confirm === "reset"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title="Send a password reset link?"
        text="The link goes to the account’s address and works for 30 minutes. Signing in with it ends the lock."
        okText="Send"
        reason={false}
        busy={action.busy}
        error={action.problem}
        onConfirm={() => {
          void action
            .run(() => sendResetLink(customer.id), "Reset link sent")
            .then((result) => {
              if (result) setConfirm(null);
            });
        }}
      />
      <ReasonDialog
        open={confirm === "suspend"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={`Suspend ${customer.handle}?`}
        text="All sessions end now and they can’t sign in. Their data is kept."
        okText="Suspend"
        danger
        busy={action.busy}
        error={action.problem}
        onConfirm={(reason) => {
          void action
            .run(() => suspendCustomer(customer.id, reason), "Account suspended")
            .then(() => {
              setConfirm(null);
              reload();
            });
        }}
      />
      <ReasonDialog
        open={confirm === "lift"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title="Lift the suspension?"
        text="They can sign in again straight away."
        okText="Lift suspension"
        busy={action.busy}
        error={action.problem}
        onConfirm={(reason) => {
          void action
            .run(() => liftCustomerSuspension(customer.id, reason), "Suspension lifted")
            .then(() => {
              setConfirm(null);
              reload();
            });
        }}
      />
      <ReasonDialog
        open={confirm === "delete"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={`Delete ${customer.handle}’s account?`}
        text="The account, its Drive files, browser profiles, saved passwords and history are deleted now. There is no undo. Invoices stay with Stripe."
        okText="Delete account"
        danger
        typeToConfirm="DELETE"
        busy={action.busy}
        error={action.problem}
        onConfirm={(reason) => {
          void action
            .run(() => deleteCustomer(customer.id, reason), "Account deleted")
            .then((result) => {
              if (result) router.push("/admin/customers");
            });
        }}
      />
    </div>
  );
}

/* ── A tab that loads its own data ── */

function useTab<T>(load: () => Promise<ApiResult<T>>, version: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void load().then((result) => {
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
    // The loader is stable per tab; version and tick ask for a fresh read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick]);
  return { data, error, refresh: () => setTick((t) => t + 1) };
}

function TabFrame({
  error,
  data,
  what,
  children,
}: {
  error: string | null;
  data: unknown;
  what: string;
  children: ReactNode;
}) {
  if (error) return <div className="warnbox">{error}</div>;
  if (data === null) return <Loading what={what} />;
  return <>{children}</>;
}

/* ── Sign-in & security ── */

function SignInTab({
  id,
  role,
  version,
  reload,
}: {
  id: string;
  role: string;
  version: number;
  reload: () => void;
}) {
  const { data, error, refresh } = useTab(() => fetchCustomerSignIn(id), version);
  const action = useAction();
  const [confirm, setConfirm] = useState<
    | { kind: "passkey"; passkeyId: string; name: string }
    | { kind: "twofa" }
    | { kind: "all" }
    | { kind: "reset" }
    | null
  >(null);
  const gated = (permission: Parameters<typeof can>[1]) =>
    can(role, permission) ? {} : { disabled: true, title: "Your role can’t do this" };
  return (
    <TabFrame error={error} data={data} what="sign-in details">
      {data && (
        <div className="g2 grid">
          <div className="stack">
            <Card title="Sign-in methods">
              <div className="list-i">
                <div style={{ flex: 1 }}>
                  <b style={{ fontWeight: 500 }}>Password</b>
                  <div className="muted sm">{data.passwordSet ? "Set" : "Not set"}</div>
                </div>
                <button
                  type="button"
                  className="btn sm"
                  {...gated("signout")}
                  onClick={() => setConfirm({ kind: "reset" })}
                >
                  Send reset link
                </button>
              </div>
              {data.passkeys.map((passkey) => (
                <div key={passkey.id} className="list-i">
                  <div style={{ flex: 1 }}>
                    <b style={{ fontWeight: 500 }}>{passkey.name}</b>
                    <div className="muted sm">
                      Added {fdate(passkey.createdAt)} · last used {ago(passkey.lastUsedAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn sm dng"
                    {...gated("twofaReset")}
                    onClick={() =>
                      setConfirm({ kind: "passkey", passkeyId: passkey.id, name: passkey.name })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="list-i">
                <div style={{ flex: 1 }}>
                  <b style={{ fontWeight: 500 }}>Two-factor (authenticator app)</b>
                  <div className="muted sm">
                    {data.authenticatorOn
                      ? `On · ${String(data.recoveryCodesLeft)} recovery codes left`
                      : "Off"}
                  </div>
                </div>
                {data.authenticatorOn && (
                  <button
                    type="button"
                    className="btn sm dng"
                    {...gated("twofaReset")}
                    onClick={() => setConfirm({ kind: "twofa" })}
                  >
                    Turn off…
                  </button>
                )}
              </div>
              <div className="list-i">
                <div style={{ flex: 1 }}>
                  <b style={{ fontWeight: 500 }}>Email</b>
                  <div className="muted sm">
                    {data.emailVerified ? "Confirmed" : "Not confirmed"}
                  </div>
                </div>
              </div>
            </Card>
            <Card title="Account protection">
              <div className="list-i">
                <div style={{ flex: 1 }}>Failed sign-ins, last 24 h</div>
                <b className={data.failedSignIns24h > 5 ? "dn" : ""}>{data.failedSignIns24h}</b>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  {...gated("signout")}
                  onClick={() => setConfirm({ kind: "all" })}
                >
                  Sign out everywhere
                </button>
              </div>
            </Card>
          </div>
          <div className="stack">
            <Card title="Devices signed in">
              {data.devices.length === 0 ? (
                <div className="muted sm">Nothing signed in</div>
              ) : (
                data.devices.map((device) => (
                  <div key={device.id} className="list-i">
                    <div style={{ flex: 1 }}>
                      <b style={{ fontWeight: 500 }}>{device.device}</b>{" "}
                      {device.locked && <Pill tone="o">Locked</Pill>}
                      <div className="muted sm">
                        {device.authMethod} ·{" "}
                        {device.persistent ? "kept signed in" : "this session"} ·{" "}
                        <span className="mask">{device.ipAddress ?? ""}</span> ·{" "}
                        {ago(device.lastSeenAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn sm"
                      {...gated("signout")}
                      onClick={() => {
                        void action
                          .run(() => signOutCustomerDevice(id, device.id), "Device signed out")
                          .then(() => {
                            refresh();
                          });
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                ))
              )}
            </Card>
            <Card title="Sign-in history" flush>
              <table>
                <tbody>
                  {data.signIns.length === 0 ? (
                    <tr>
                      <td className="empty">No sign-ins recorded</td>
                    </tr>
                  ) : (
                    data.signIns.map((entry, index) => (
                      <tr key={index}>
                        <td className="muted sm" style={{ whiteSpace: "nowrap" }}>
                          {fdt(entry.at)}
                        </td>
                        <td className="sm">
                          {entry.device}
                          <div className="muted mask">{entry.ipAddress ?? ""}</div>
                        </td>
                        <td>
                          {entry.ok ? <Pill tone="g">OK</Pill> : <Pill tone="r">Failed</Pill>}
                        </td>
                        <td>{entry.newDevice && <Pill tone="o">New device</Pill>}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </div>
        </div>
      )}
      <ReasonDialog
        open={confirm?.kind === "reset"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title="Send a password reset link?"
        text="The link goes to the account’s address and works for 30 minutes."
        okText="Send"
        reason={false}
        busy={action.busy}
        error={action.problem}
        onConfirm={() => {
          void action
            .run(() => sendResetLink(id), "Reset link sent")
            .then(() => {
              setConfirm(null);
            });
        }}
      />
      <ReasonDialog
        open={confirm?.kind === "passkey"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={`Remove ${confirm?.kind === "passkey" ? confirm.name : "this passkey"}?`}
        text="Only do this if the customer asked, for example a lost device. Make sure they still have another way to sign in. They’re emailed about it."
        okText="Remove"
        danger
        busy={action.busy}
        error={action.problem}
        onConfirm={(reason) => {
          if (confirm?.kind !== "passkey") return;
          void action
            .run(() => removeCustomerPasskey(id, confirm.passkeyId, reason), "Passkey removed")
            .then(() => {
              setConfirm(null);
              refresh();
            });
        }}
      />
      <ReasonDialog
        open={confirm?.kind === "twofa"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title="Turn two-factor off?"
        text="For a customer who lost their authenticator. Their recovery codes go too. They’re emailed about it. Suggest they set it up again from Shield."
        okText="Turn off"
        danger
        busy={action.busy}
        error={action.problem}
        onConfirm={(reason) => {
          void action
            .run(() => disableCustomerTwoFactor(id, reason), "Two-factor turned off")
            .then(() => {
              setConfirm(null);
              refresh();
            });
        }}
      />
      <ReasonDialog
        open={confirm?.kind === "all"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title="Sign out everywhere?"
        text="Ends every cloud browser session and signs out all devices. Saved data is kept."
        okText="Sign out everywhere"
        busy={action.busy}
        error={action.problem}
        onConfirm={(reason) => {
          void action
            .run(() => signOutCustomer(id, reason), "Signed out of all devices and sessions")
            .then(() => {
              setConfirm(null);
              refresh();
              reload();
            });
        }}
      />
    </TabFrame>
  );
}

/* ── Subscription & billing ── */

function BillingTab({
  id,
  role,
  version,
  reload,
}: {
  id: string;
  role: string;
  version: number;
  reload: () => void;
}) {
  const { data, error, refresh } = useTab(() => fetchCustomerBilling(id), version);
  const action = useAction();
  const [changing, setChanging] = useState(false);
  const b = data;
  return (
    <TabFrame error={error} data={data} what="billing">
      {b && (
        <div className="g21 grid">
          <div className="stack">
            {b.coveredBy && (
              <div className="infobox" style={{ margin: 0 }}>
                Covered by{" "}
                <Link href={`/admin/orgs/${b.coveredBy.teamId}` as never}>
                  {b.coveredBy.teamName}
                </Link>
                ’s plan. Plan and billing are the organisation owner’s.
              </div>
            )}
            <Card title="Subscription">
              <div className="row" style={{ alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
                <div>
                  <div className="muted sm">Plan</div>
                  <div style={{ fontSize: 24, fontWeight: 600 }}>{b.planName}</div>
                  <div className="muted sm">
                    {b.price
                      ? `${money(b.price.amount, b.price.currency, true)} a ${b.price.interval}`
                      : b.source === "admin"
                        ? `Set by hand${b.planNote ? `: ${b.planNote}` : ""}`
                        : "Free"}
                  </div>
                </div>
                <div>
                  <div className="muted sm">
                    {b.subscription?.cancelAtPeriodEnd ? "Ends" : "Renews"}
                  </div>
                  <div style={{ fontWeight: 500 }}>
                    {b.subscription?.currentPeriodEnd
                      ? fdate(b.subscription.currentPeriodEnd)
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="muted sm">Stripe status</div>
                  <div style={{ fontWeight: 500 }}>
                    {b.subscription?.status ?? "No subscription"}
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn pri"
                  disabled={!can(role, "planChange")}
                  title={can(role, "planChange") ? undefined : "Your role can’t do this"}
                  onClick={() => {
                    setChanging(true);
                  }}
                >
                  Set plan by hand…
                </button>
              </div>
              <div className="muted sm" style={{ marginTop: 10 }}>
                Refunds and invoices are on{" "}
                <Link href={`/admin/invoices?customer=${id}` as never}>Invoices &amp; refunds</Link>
                ; cancellations happen in Stripe.{" "}
                {b.stripeConfigured ? "" : "Stripe isn’t configured on this installation."}
              </div>
            </Card>
          </div>
          <div className="stack">
            <Card title="Plan limits and usage">
              <dl className="kv">
                <dt>Sessions at once</dt>
                <dd>{b.limits.liveSessions}</dd>
                <dt>Browsing time</dt>
                <dd>
                  {fmtMinutes(b.usage.browsingMinutesThisMonth)} used
                  {b.limits.browsingMinutesPerMonth === null
                    ? ", no monthly cap"
                    : ` of ${fmtMinutes(b.limits.browsingMinutesPerMonth)}`}
                </dd>
                <dt>Drive</dt>
                <dd>
                  {fsize(b.usage.driveBytes)} of {fsize(b.limits.driveBytes)} · {b.usage.driveFiles}{" "}
                  of {b.limits.driveFiles} files
                </dd>
                <dt>Profiles</dt>
                <dd>
                  {b.usage.profiles} of {b.limits.profiles}
                </dd>
                <dt>Proxies</dt>
                <dd>
                  {b.usage.proxies} of {b.limits.proxies}
                </dd>
                <dt>Team</dt>
                <dd>
                  {b.limits.teamMembers === 1
                    ? "No team on this plan"
                    : `Up to ${String(b.limits.teamMembers)} people`}
                </dd>
              </dl>
            </Card>
          </div>
        </div>
      )}
      {b && (
        <FormDialog
          open={changing}
          onOpenChange={setChanging}
          title="Set the plan by hand"
          intro="A plan set here outranks the subscription until it is set back to Free, which hands control back to Stripe. The reason goes to the account’s security history and the audit log."
          fields={[
            {
              key: "planCode",
              label: "Plan",
              options: b.plans.map((plan) => ({
                value: plan.code,
                label:
                  plan.code === "free"
                    ? "Free, or whatever the subscription grants"
                    : `${plan.name} (set by hand)`,
              })),
              value: b.source === "admin" ? b.planCode : "free",
            },
            {
              key: "reason",
              label: "Reason",
              required: true,
              placeholder: "e.g. compensation for an outage",
            },
          ]}
          okText="Set plan"
          busy={action.busy}
          error={action.problem}
          onSubmit={(values) => {
            void action
              .run(
                () =>
                  setCustomerPlan(id, {
                    planCode: values.planCode ?? "free",
                    reason: values.reason ?? "",
                  }),
                "Plan set",
              )
              .then(() => {
                setChanging(false);
                refresh();
                reload();
              });
          }}
        />
      )}
    </TabFrame>
  );
}

/* ── Browsers & sessions ── */

function BrowsersTab({
  id,
  role,
  version,
  reload,
}: {
  id: string;
  role: string;
  version: number;
  reload: () => void;
}) {
  const { data, error, refresh } = useTab(() => fetchCustomerBrowsers(id), version);
  const action = useAction();
  const [ending, setEnding] = useState<string | null>(null);
  return (
    <TabFrame error={error} data={data} what="browsers">
      {data && (
        <>
          <Card
            title="Live sessions"
            flush={data.sessions.length > 0}
            right={
              <span className="muted sm">
                {data.sessions.length} of {data.sessionLimit} the plan allows
              </span>
            }
          >
            {data.sessions.length === 0 ? (
              <div className="muted sm">No sessions running</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Browser</th>
                    <th>Profile</th>
                    <th>Host</th>
                    <th>Running for</th>
                    <th>Last viewed</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.map((session) => (
                    <tr key={session.id}>
                      <td>{session.engineName}</td>
                      <td>{session.profileName ?? "—"}</td>
                      <td className="mask">{session.runtimeHost ?? "—"}</td>
                      <td>
                        {session.startedAt
                          ? fmtMinutes(minutesSince(session.startedAt))
                          : "starting"}
                      </td>
                      <td className="muted">{ago(session.lastViewedAt)}</td>
                      <td>
                        <Pill tone={session.status === "running" ? "g" : "b"}>
                          {session.status}
                        </Pill>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="btn sm dng"
                          disabled={!can(role, "sessionEnd")}
                          title={can(role, "sessionEnd") ? undefined : "Your role can’t do this"}
                          onClick={() => {
                            setEnding(session.id);
                          }}
                        >
                          End
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <h3 style={{ margin: "22px 0 12px", fontSize: 16 }}>Browser profiles</h3>
          <div className="g2 grid">
            {data.profiles.length === 0 && <div className="muted sm">No profiles</div>}
            {data.profiles.map((profile) => (
              <Card
                key={profile.id}
                title={profile.name}
                right={
                  <Pill tone={profile.keepData ? "g" : ""}>
                    {profile.keepData ? "Keeps its data" : "Starts fresh"}
                  </Pill>
                }
              >
                <dl className="kv" style={{ gridTemplateColumns: "110px 1fr" }}>
                  <dt>Browser</dt>
                  <dd>{profile.engineName}</dd>
                  <dt>Kept data</dt>
                  <dd>
                    {profile.dataBytes > 0
                      ? `${fsize(profile.dataBytes)}, saved ${ago(profile.dataSavedAt)}`
                      : "None saved"}
                  </dd>
                  <dt>Proxy</dt>
                  <dd>{profile.proxyName ?? "Direct"}</dd>
                  <dt>Extensions</dt>
                  <dd>
                    {profile.extensions.length === 0
                      ? "None"
                      : profile.extensions.map((extension) => (
                          <span key={extension} className="tag">
                            {extension}
                          </span>
                        ))}
                  </dd>
                  <dt>Changed</dt>
                  <dd>{ago(profile.updatedAt)}</dd>
                </dl>
              </Card>
            ))}
          </div>
          <div className="infobox" style={{ marginTop: 16 }}>
            Staff see machine facts and settings only. Pages visited, cookies and saved passwords
            are encrypted and never shown here.
          </div>
        </>
      )}
      <ReasonDialog
        open={ending !== null}
        onOpenChange={(open) => {
          if (!open) setEnding(null);
        }}
        title="End this session?"
        text="The browser closes for the customer and the container goes. Their profile’s data is saved. Their security history says staff ended it."
        okText="End session"
        danger
        busy={action.busy}
        error={action.problem}
        onConfirm={(reason) => {
          const sessionId = ending;
          if (!sessionId) return;
          void action
            .run(() => endCustomerSession(id, sessionId, reason), "Session ended")
            .then(() => {
              setEnding(null);
              refresh();
              reload();
            });
        }}
      />
    </TabFrame>
  );
}

/* ── Drive ── */

function DriveTab({
  id,
  role,
  version,
  reload,
}: {
  id: string;
  role: string;
  version: number;
  reload: () => void;
}) {
  const { data, error, refresh } = useTab(() => fetchCustomerDrive(id), version);
  const action = useAction();
  return (
    <TabFrame error={error} data={data} what="Drive">
      {data && (
        <>
          <div className="g3 grid" style={{ marginBottom: 16 }}>
            <Card title="Storage">
              <div style={{ fontSize: 22, fontWeight: 600 }}>{fsize(data.usedBytes)}</div>
              <div className="muted sm" style={{ marginBottom: 8 }}>
                of {fsize(data.limitBytes)}
              </div>
              <HBar value={percent(data.usedBytes, data.limitBytes)} />
            </Card>
            <Card title="Files">
              <div style={{ fontSize: 22, fontWeight: 600 }}>{data.files}</div>
              <div className="muted sm">
                in {data.folders} folders, plus {data.trash.length} in Trash
                {data.quarantined > 0 && `, ${String(data.quarantined)} quarantined`}
              </div>
            </Card>
            <Card title="Extra space">
              <div className="muted sm">
                Temporary space isn’t a thing here: limits follow the plan. Set a bigger plan by
                hand from the billing tab, with a reason.
              </div>
            </Card>
          </div>
          <Card title="Trash" flush>
            <div className="muted sm" style={{ padding: "0 20px 10px" }}>
              Deleted files stay in Trash for 30 days, then go for good.
            </div>
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Size</th>
                  <th>Deleted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.trash.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      Trash is empty
                    </td>
                  </tr>
                ) : (
                  data.trash.map((file) => (
                    <tr key={file.id}>
                      <td>{file.name}</td>
                      <td className="muted">{fsize(file.size)}</td>
                      <td className="muted">{ago(file.trashedAt)}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="btn sm pri"
                          disabled={!can(role, "driveRestore")}
                          title={can(role, "driveRestore") ? undefined : "Your role can’t do this"}
                          onClick={() => {
                            void action
                              .run(
                                () => restoreCustomerFile(id, file.id),
                                `“${file.name}” restored`,
                              )
                              .then(() => {
                                refresh();
                                reload();
                              });
                          }}
                        >
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
          {action.problem && (
            <div className="warnbox" style={{ marginTop: 12 }}>
              {action.problem}
            </div>
          )}
        </>
      )}
    </TabFrame>
  );
}

/* ── Activity ── */

function ActivityTab({ id, version }: { id: string; version: number }) {
  const { data, error } = useTab(() => fetchCustomerActivity(id), version);
  return (
    <TabFrame error={error} data={data} what="activity">
      {data && (
        <Card
          title="Everything that happened on this account"
          right={<span className="muted sm">Staff actions show in orange</span>}
        >
          {data.events.length === 0 ? (
            <div className="muted sm">Nothing recorded yet</div>
          ) : (
            <div className="tl">
              {data.events.map((event, index) => (
                <div
                  key={index}
                  className={`e ${event.staff ? "o" : event.type.includes("failed") || event.type.includes("quarantined") ? "r" : ""}`}
                >
                  <div>
                    {event.staff ? `${event.staff} · ` : ""}
                    {event.type.replace(/[._]/g, " ")}
                  </div>
                  <div className="muted">
                    {fdt(event.at)}
                    {event.device ? ` · ${event.device}` : ""}
                    {event.detail ? ` · ${event.detail}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </TabFrame>
  );
}

/* ── Privacy & data ── */

function PrivacyTab({ id, version }: { id: string; version: number }) {
  const { data, error } = useTab(() => fetchCustomerPrivacy(id), version);
  return (
    <TabFrame error={error} data={data} what="privacy details">
      {data && (
        <div className="g2 grid">
          <Card title="Data we hold" flush>
            <table>
              <tbody>
                {data.held.map((row) => (
                  <tr key={row.what}>
                    <td>{row.what}</td>
                    <td className="muted sm" style={{ textAlign: "right" }}>
                      {row.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Consent and requests">
            <div className="list-i">
              <span style={{ flex: 1 }}>Optional emails</span>
              {data.marketingEmails ? <Pill tone="g">Opted in</Pill> : <Pill>Opted out</Pill>}
            </div>
            <div className="muted sm" style={{ margin: "6px 0 14px" }}>
              Only the customer can change their email choices, from their account.
            </div>
            {data.exports.length === 0 ? (
              <div className="muted sm">
                No data exports yet. Customers export their data from their account page.
              </div>
            ) : (
              data.exports.map((entry) => (
                <div key={entry.at} className="list-i sm">
                  <span style={{ flex: 1 }}>Data exported</span>
                  <span className="muted">{fdt(entry.at)}</span>
                </div>
              ))
            )}
            <div className="muted sm" style={{ marginTop: 14 }}>
              Privacy requests with their one-month deadline come with Security & compliance (11.5).
            </div>
          </Card>
        </div>
      )}
    </TabFrame>
  );
}
