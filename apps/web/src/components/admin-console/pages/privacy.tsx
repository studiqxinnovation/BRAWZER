"use client";

import {
  can,
  type PrivacyKind,
  privacyKindNames,
  privacyKinds,
  type PrivacyRequest,
  type PrivacyRequestList,
} from "@brawzer/contracts";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  completePrivacyRequest,
  fetchCustomers,
  fetchPrivacyRequests,
  logPrivacyRequest,
} from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { Card, fdate, FormDialog, Loading, Pill, ReasonDialog } from "../ui";
import { useAction } from "../use-action";

const DAY = 86_400_000;
const subscribeToClock = (listener: () => void) => {
  const timer = setInterval(listener, 60_000);
  return () => {
    clearInterval(timer);
  };
};
const clockNow = () => Math.floor(Date.now() / 60_000) * 60_000;
const clockOnServer = () => 0;

/** Privacy requests: a copy, a correction or a deletion, each with the one-month deadline. */
export function PrivacyPage() {
  const me = useStaff();
  const now = useSyncExternalStore(subscribeToClock, clockNow, clockOnServer);
  const [data, setData] = useState<PrivacyRequestList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [completing, setCompleting] = useState<PrivacyRequest | null>(null);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void fetchPrivacyRequests().then((result) => {
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
  if (!data) return <Loading what="privacy requests" />;
  const may = can(me.role, "dsar");
  const daysLeft = (iso: string) => (now ? Math.ceil((Date.parse(iso) - now) / DAY) : null);
  return (
    <>
      <p className="muted" style={{ marginBottom: 16 }}>
        Under UK GDPR, people can ask for a copy of their data, a correction, or deletion, and must
        get an answer within one month. Customers can export and delete from their own account; log
        the requests that come by email here so the deadline is visible.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        {may && (
          <button
            type="button"
            className="btn pri sm"
            style={{ marginLeft: "auto" }}
            onClick={() => {
              setLogging(true);
            }}
          >
            Log request
          </button>
        )}
      </div>
      <div className="card p0">
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Customer</th>
              <th>Received</th>
              <th>Deadline</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {data.requests.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">
                  No requests logged
                </td>
              </tr>
            ) : (
              data.requests.map((request) => {
                const left = daysLeft(request.deadlineAt);
                return (
                  <tr key={request.id}>
                    <td>
                      <b style={{ fontWeight: 500 }}>{privacyKindNames[request.kind]}</b>
                      {request.note && <div className="muted sm">{request.note}</div>}
                    </td>
                    <td>
                      {request.customer ? (
                        <Link href={`/admin/customers/${request.customer.id}` as never}>
                          {request.customer.handle}
                        </Link>
                      ) : (
                        <span className="muted">Account deleted</span>
                      )}
                      {request.held && (
                        <>
                          {" "}
                          <Pill tone="r">Legal hold</Pill>
                        </>
                      )}
                    </td>
                    <td className="muted">{fdate(request.receivedAt)}</td>
                    <td>
                      {request.status === "completed" || left === null ? (
                        <span className="muted">—</span>
                      ) : left < 0 ? (
                        <Pill tone="r">Overdue {String(-left)} days</Pill>
                      ) : (
                        <Pill tone={left <= 7 ? "o" : ""}>{String(left)} days left</Pill>
                      )}
                    </td>
                    <td>
                      {request.status === "completed" ? (
                        <Pill tone="g">Completed</Pill>
                      ) : (
                        <Pill tone="o">Open</Pill>
                      )}
                      {request.completedBy && (
                        <div className="muted sm">
                          {request.completedBy} ·{" "}
                          {request.completedAt ? fdate(request.completedAt) : ""}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {request.status === "open" && may && (
                        <button
                          type="button"
                          className={`btn sm ${request.kind === "delete" ? "dng" : "pri"}`}
                          onClick={() => {
                            setCompleting(request);
                          }}
                        >
                          {request.kind === "delete" ? "Delete data" : "Mark done"}
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
      <Card title="Data breach checklist">
        <ol className="sm" style={{ paddingLeft: 18, lineHeight: 1.9 }}>
          <li>Contain it: end sessions, rotate keys, block addresses</li>
          <li>Record what happened, when, and which data</li>
          <li>Assess the risk to people</li>
          <li>
            Report to the ICO within <b>72 hours</b> if there’s a risk to people
          </li>
          <li>Tell affected customers without delay if the risk is high</li>
          <li>Log it in the breach register even if not reported</li>
        </ol>
      </Card>

      <FormDialog
        open={logging}
        onOpenChange={(open) => {
          setLogging(open);
          if (!open) action.setProblem(null);
        }}
        title="Log a privacy request"
        fields={[
          { key: "email", label: "Account email", type: "email", required: true },
          {
            key: "kind",
            label: "What they asked for",
            options: privacyKinds.map((kind) => ({ value: kind, label: privacyKindNames[kind] })),
          },
          { key: "received", label: "Received on (blank = today)", type: "date" },
          { key: "note", label: "Note", area: true },
        ]}
        okText="Log"
        busy={action.busy}
        error={action.problem}
        onSubmit={(values) => {
          const q = (values.email ?? "").trim();
          void fetchCustomers({ q }).then((found) => {
            const match = found.ok
              ? (found.data.customers.find(
                  (customer) => customer.email.toLowerCase() === q.toLowerCase(),
                ) ?? (found.data.customers.length === 1 ? found.data.customers[0] : undefined))
              : undefined;
            if (!match) {
              action.setProblem("No account found with that address.");
              return;
            }
            void action
              .run(
                () =>
                  logPrivacyRequest({
                    customerId: match.id,
                    kind: (values.kind ?? "copy") as PrivacyKind,
                    ...(values.received
                      ? { receivedAt: new Date(`${values.received}T09:00:00`).toISOString() }
                      : {}),
                    note: values.note ?? "",
                  }),
                "Request logged",
              )
              .then((result) => {
                if (result) {
                  setData(result.data);
                  setLogging(false);
                }
              });
          });
        }}
      />
      {completing && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setCompleting(null);
          }}
          title={
            completing.kind === "delete"
              ? `Permanently delete ${completing.customer?.handle ?? "this account"}’s data?`
              : "Mark the request complete?"
          }
          text={
            completing.kind === "delete"
              ? completing.held
                ? "This account is under a legal hold, so deletion is refused until the hold is released."
                : "Deletes the account, Drive files, browser profiles, passwords and history now. Invoices stay with Stripe. There is no undo."
              : completing.kind === "copy"
                ? "The copy is the account’s own export (Account › Export your data). Record how and when it was sent."
                : "Record what was corrected and when."
          }
          okText={completing.kind === "delete" ? "Delete permanently" : "Complete"}
          danger={completing.kind === "delete"}
          typeToConfirm={completing.kind === "delete" ? "DELETE" : undefined}
          busy={action.busy}
          error={action.problem}
          onConfirm={(reason) => {
            const request = completing;
            void action
              .run(() => completePrivacyRequest(request.id, reason), "Completed")
              .then((result) => {
                if (result) {
                  setData(result.data);
                  setCompleting(null);
                }
              });
          }}
        />
      )}
    </>
  );
}
