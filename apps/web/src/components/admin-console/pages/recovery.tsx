"use client";

import {
  can,
  RECOVERY_SAFE_POINTS,
  type RecoveryCase,
  type RecoveryCaseList,
  type RecoveryCheckKind,
  recoveryCheckNames,
  recoveryChecks,
  recoveryPoints,
  recoveryStatusNames,
} from "@brawzer/contracts";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  denyRecovery,
  fetchCustomers,
  fetchRecoveryCases,
  markRecoveryReviewed,
  recordRecoveryCheck,
  releaseRecovery,
  startRecoveryFor,
} from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { ago, FormDialog, Kpi, Loading, Pill, ReasonDialog } from "../ui";
import { useAction } from "../use-action";

const MINUTE = 60_000;
const subscribeToClock = (listener: () => void) => {
  const timer = setInterval(listener, MINUTE);
  return () => {
    clearInterval(timer);
  };
};
const clockNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;
const clockOnServer = () => 0;
/** The time, to the minute, so "ready now" flips without re-rendering every second. */
const useNow = () => useSyncExternalStore(subscribeToClock, clockNow, clockOnServer);

const STATUS_TONE: Record<RecoveryCase["status"], "o" | "b" | "g" | "r"> = {
  verifying: "o",
  waiting: "b",
  released: "g",
  denied: "r",
};

/** Account recovery: every case, its checks and points, the wait, and who may release. */
export function RecoveryPage() {
  const me = useStaff();
  const [data, setData] = useState<RecoveryCaseList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [checking, setChecking] = useState<RecoveryCase | null>(null);
  const [releasing, setReleasing] = useState<RecoveryCase | null>(null);
  const [denying, setDenying] = useState<RecoveryCase | null>(null);
  const action = useAction();
  const now = useNow();

  useEffect(() => {
    let cancelled = false;
    void fetchRecoveryCases().then((result) => {
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
  if (!data) return <Loading what="recovery cases" />;
  const open = data.cases.filter(
    (entry) => entry.status === "verifying" || entry.status === "waiting",
  );
  const waiting = data.cases.filter((entry) => entry.status === "waiting");
  const ready = waiting.filter((entry) => entry.releaseAt && Date.parse(entry.releaseAt) <= now);
  const mayWork = can(me.role, "recovery");
  const mayRelease = can(me.role, "recoveryApprove");
  const apply = (request: Parameters<typeof action.run>[0], done: string, close: () => void) => {
    void action.run(request, done).then((result) => {
      if (result) {
        setData(result.data as RecoveryCaseList);
        close();
      }
    });
  };
  return (
    <>
      <div className="infobox">
        Account recovery is how people get back in when they’ve lost every sign-in method. It’s also
        the most common way accounts are stolen, so every case needs the owner’s email confirmation,
        a 48-hour wait the owner can cancel, identity checks, and a second person to release.
      </div>
      <div className="g4 grid" style={{ marginBottom: 16 }}>
        <Kpi label="Open cases" value={String(open.length)} />
        <Kpi
          label="In waiting period"
          value={String(waiting.length)}
          note="owner can cancel any time"
        />
        <Kpi label="Ready to release" value={String(ready.length)} note="needs a second approver" />
        <Kpi
          label="Average time to recover"
          value={
            data.averageHoursToRelease === null ? "—" : `${String(data.averageHoursToRelease)} h`
          }
          note="from confirmation to release"
        />
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted sm">
          Customers start from the sign-in page. Start one here when they asked another way; they
          still confirm from their email.
        </span>
        {mayWork && (
          <button
            type="button"
            className="btn pri sm"
            style={{ marginLeft: "auto" }}
            onClick={() => {
              setStarting(true);
            }}
          >
            New case…
          </button>
        )}
      </div>
      <div className="card p0">
        <table>
          <thead>
            <tr>
              <th>Case</th>
              <th>Customer</th>
              <th>Identity</th>
              <th>Status</th>
              <th>Release</th>
              <th style={{ textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {data.cases.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">
                  No recovery cases
                </td>
              </tr>
            ) : (
              data.cases.map((entry) => {
                const dueNow = entry.releaseAt ? Date.parse(entry.releaseAt) <= now : false;
                const openCase = entry.status === "verifying" || entry.status === "waiting";
                return (
                  <tr key={entry.id}>
                    <td>
                      <span className="mask">{entry.id.slice(0, 8)}</span>
                      <div className="muted sm">
                        {ago(entry.openedAt)}
                        {entry.openedBy ? ` by ${entry.openedBy}` : " by the customer"}
                      </div>
                    </td>
                    <td>
                      <Link href={`/admin/customers/${entry.customer.id}` as never}>
                        {entry.customer.handle}
                      </Link>
                      <div className="muted sm">
                        {entry.customer.planName} · {entry.signIn.passkeys}{" "}
                        {entry.signIn.passkeys === 1 ? "passkey" : "passkeys"}
                        {entry.signIn.authenticator ? " · authenticator" : ""}
                      </div>
                    </td>
                    <td>
                      <Pill tone={entry.points >= RECOVERY_SAFE_POINTS ? "g" : "o"}>
                        {entry.points} pts
                      </Pill>
                      <div className="muted sm" style={{ marginTop: 4 }}>
                        {entry.emailConfirmedAt ? "Email confirmed" : "Email not confirmed"}
                        {entry.deviceKnown === null
                          ? ""
                          : entry.deviceKnown
                            ? " · known device"
                            : " · new device"}
                        {recoveryChecks
                          .filter((key) => entry.checks[key])
                          .map(
                            (key) =>
                              ` · ${recoveryCheckNames[key].split(" ")[0] ?? key} ${entry.checks[key]?.ok ? "✓" : "✗"}`,
                          )
                          .join("")}
                      </div>
                    </td>
                    <td>
                      <Pill tone={STATUS_TONE[entry.status]}>
                        {recoveryStatusNames[entry.status]}
                      </Pill>
                      {entry.closedByOwner && (
                        <div className="dn sm" style={{ marginTop: 4 }}>
                          Cancelled by owner: possible takeover
                        </div>
                      )}
                      {entry.reviewedBy && openCase && (
                        <div className="muted sm" style={{ marginTop: 4 }}>
                          Checks complete · {entry.reviewedBy}
                        </div>
                      )}
                    </td>
                    <td className="sm">
                      {entry.status === "waiting" ? (
                        dueNow ? (
                          <b className="up">Ready now</b>
                        ) : (
                          `Available ${ago(entry.releaseAt)}`
                        )
                      ) : entry.status === "released" ? (
                        `${entry.releasedEarly ? "Released EARLY" : "Released"} by ${entry.closedBy ?? "staff"}`
                      ) : entry.status === "denied" ? (
                        (entry.closedReason ?? "Denied")
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {openCase && mayWork && (
                        <>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => {
                              setChecking(entry);
                            }}
                          >
                            Checks
                          </button>{" "}
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => {
                              setDenying(entry);
                            }}
                          >
                            Deny
                          </button>{" "}
                        </>
                      )}
                      {entry.status === "waiting" && mayWork && !entry.reviewedBy && (
                        <>
                          <button
                            type="button"
                            className="btn sm"
                            disabled={action.busy}
                            onClick={() => {
                              apply(
                                () => markRecoveryReviewed(entry.id),
                                "Checks marked complete",
                                () => undefined,
                              );
                            }}
                          >
                            Checks complete
                          </button>{" "}
                        </>
                      )}
                      {entry.status === "waiting" && (
                        <button
                          type="button"
                          className="btn sm pri"
                          disabled={
                            !mayRelease || !entry.reviewedBy || entry.reviewedBy === me.email
                          }
                          title={
                            !mayRelease
                              ? "Your role can’t release accounts"
                              : !entry.reviewedBy
                                ? "Someone must complete the checks first"
                                : entry.reviewedBy === me.email
                                  ? "You completed the checks; a second person releases"
                                  : undefined
                          }
                          onClick={() => {
                            setReleasing(entry);
                          }}
                        >
                          Approve release
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <FormDialog
        open={starting}
        onOpenChange={(open) => {
          setStarting(open);
          if (!open) action.setProblem(null);
        }}
        title="Start account recovery"
        intro="Find the customer by their address. They get an email to confirm; nothing happens until they do."
        fields={[{ key: "q", label: "Customer email", type: "email", required: true }]}
        okText="Find and send"
        busy={action.busy}
        error={action.problem}
        onSubmit={(values) => {
          const q = (values.q ?? "").trim();
          void fetchCustomers({ q }).then((found) => {
            const match = found.ok
              ? (found.data.customers.find(
                  (customer) => customer.email.toLowerCase() === q.toLowerCase(),
                ) ?? (found.data.customers.length === 1 ? found.data.customers[0] : undefined))
              : undefined;
            if (!match) {
              action.setProblem("No customer found with that address.");
              return;
            }
            apply(
              () => startRecoveryFor(match.id),
              "Confirmation email sent",
              () => {
                setStarting(false);
              },
            );
          });
        }}
      />

      {checking && (
        <FormDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setChecking(null);
              action.setProblem(null);
            }
          }}
          title={`Record a check for ${checking.customer.handle}`}
          intro={`Points so far: ${String(checking.points)}. Email confirmation is worth ${String(recoveryPoints.email)}, a known device ${String(recoveryPoints.device)}, an invoice ${String(recoveryPoints.invoice)}, the card ${String(recoveryPoints.card)}, an identity document ${String(recoveryPoints.idDocument)}. From ${String(RECOVERY_SAFE_POINTS)} a case is usually safe to release.`}
          fields={[
            {
              key: "check",
              label: "Check",
              options: recoveryChecks.map((key) => ({
                value: key,
                label: recoveryCheckNames[key],
              })),
            },
            {
              key: "ok",
              label: "Result",
              options: [
                { value: "yes", label: "Passed" },
                { value: "no", label: "Failed" },
              ],
            },
            { key: "note", label: "Note (what they said, never the full card number)", area: true },
          ]}
          okText="Record"
          busy={action.busy}
          error={action.problem}
          onSubmit={(values) => {
            const current = checking;
            apply(
              () =>
                recordRecoveryCheck(current.id, {
                  check: (values.check ?? "invoice") as RecoveryCheckKind,
                  ok: values.ok !== "no",
                  note: values.note ?? "",
                }),
              "Check recorded",
              () => {
                setChecking(null);
              },
            );
          }}
        />
      )}

      {releasing && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setReleasing(null);
          }}
          title={`Release ${releasing.customer.handle}’s account?`}
          text={`${releasing.releaseAt && Date.parse(releasing.releaseAt) > now ? "THE 48-HOUR WAIT ISN’T OVER. Releasing early is only for confirmed emergencies and is marked in the audit log. " : ""}They get a one-time link to choose a new password. Their ${String(releasing.signIn.passkeys)} passkey(s) and authenticator are removed and every device is signed out. Files and settings stay.`}
          okText="Approve release"
          danger={Boolean(releasing.releaseAt && Date.parse(releasing.releaseAt) > now)}
          busy={action.busy}
          error={action.problem}
          onConfirm={(reason) => {
            const current = releasing;
            apply(
              () =>
                releaseRecovery(current.id, {
                  reason,
                  early: Boolean(current.releaseAt && Date.parse(current.releaseAt) > now),
                }),
              "Released. Password link sent.",
              () => {
                setReleasing(null);
              },
            );
          }}
        />
      )}

      {denying && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setDenying(null);
          }}
          title={`Deny ${denying.customer.handle}’s recovery?`}
          text="Use this when the checks failed or the owner says they didn’t ask. Nothing on the account changes."
          okText="Deny"
          danger
          busy={action.busy}
          error={action.problem}
          onConfirm={(reason) => {
            const current = denying;
            apply(
              () => denyRecovery(current.id, reason),
              "Case denied",
              () => {
                setDenying(null);
              },
            );
          }}
        />
      )}
    </>
  );
}
