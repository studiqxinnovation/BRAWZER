"use client";

import { can, type Legal, type LegalRequest, legalRequestKinds } from "@brawzer/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  decideLegalRequest,
  fetchCustomers,
  fetchLegal,
  logLegalRequest,
  placeLegalHold,
  releaseLegalHold,
} from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { ago, Card, fdate, FormDialog, Loading, Pill, ReasonDialog } from "../ui";
import { useAction } from "../use-action";

const STATUS_TONE: Record<LegalRequest["status"], "o" | "g" | ""> = {
  verifying: "o",
  answered: "g",
  refused: "",
};
const STATUS_NAME: Record<LegalRequest["status"], string> = {
  verifying: "Verifying",
  answered: "Answered",
  refused: "Refused",
};

/** Requests from police and courts, and the holds that keep an account's data. */
export function LegalPage() {
  const me = useStaff();
  const [data, setData] = useState<Legal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [holding, setHolding] = useState(false);
  const [deciding, setDeciding] = useState<{
    request: LegalRequest;
    status: "answered" | "refused";
  } | null>(null);
  const [releasing, setReleasing] = useState<Legal["holds"][number] | null>(null);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void fetchLegal().then((result) => {
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
  if (!data) return <Loading what="legal requests" />;
  const may = can(me.role, "legal");
  const findCustomer = async (email: string) => {
    const q = email.trim();
    if (!q) return null;
    const found = await fetchCustomers({ q });
    if (!found.ok) return null;
    return (
      found.data.customers.find((customer) => customer.email.toLowerCase() === q.toLowerCase()) ??
      (found.data.customers.length === 1 ? found.data.customers[0] : undefined) ??
      null
    );
  };
  return (
    <>
      <div className="g2 grid">
        <Card
          title="Requests from police and courts"
          flush
          right={
            may ? (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setLogging(true);
                }}
              >
                Log request
              </button>
            ) : undefined
          }
        >
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>From</th>
                <th>Account</th>
                <th>Status</th>
                <th>Due</th>
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
                data.requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      {request.kind}
                      <div className="muted sm">
                        {fdate(request.createdAt)}
                        {request.createdBy ? ` · ${request.createdBy}` : ""}
                      </div>
                      {request.note && <div className="muted sm">{request.note}</div>}
                    </td>
                    <td>{request.fromWhom}</td>
                    <td>
                      {request.customer ? (
                        <Link href={`/admin/customers/${request.customer.id}` as never}>
                          {request.customer.handle}
                        </Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <Pill tone={STATUS_TONE[request.status]}>{STATUS_NAME[request.status]}</Pill>
                    </td>
                    <td className="muted">{request.dueAt ? fdate(request.dueAt) : "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {request.status === "verifying" && may && (
                        <>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => setDeciding({ request, status: "refused" })}
                          >
                            Refused
                          </button>{" "}
                          <button
                            type="button"
                            className="btn sm pri"
                            onClick={() => setDeciding({ request, status: "answered" })}
                          >
                            Answered
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
        <Card
          title="Legal holds"
          flush
          right={
            may ? (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setHolding(true);
                }}
              >
                Place hold
              </button>
            ) : undefined
          }
        >
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Why</th>
                <th>Since</th>
                <th style={{ textAlign: "right" }} />
              </tr>
            </thead>
            <tbody>
              {data.holds.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">
                    No holds
                  </td>
                </tr>
              ) : (
                data.holds.map((hold) => (
                  <tr key={hold.customer.id}>
                    <td>
                      <Link href={`/admin/customers/${hold.customer.id}` as never}>
                        {hold.customer.handle}
                      </Link>
                    </td>
                    <td className="sm">{hold.why}</td>
                    <td className="muted">
                      {ago(hold.createdAt)}
                      {hold.createdBy ? ` · ${hold.createdBy}` : ""}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {may && (
                        <button type="button" className="btn sm" onClick={() => setReleasing(hold)}>
                          Release
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>
      <div className="infobox" style={{ marginTop: 16 }}>
        Rules: only Security or a founder handles these. Check every request is genuine by calling
        the force’s official number. Share only what the order asks for. Tell the customer unless
        the order forbids it. A legal hold stops every deletion for that account, by staff or by the
        customer, until it is released.
      </div>

      <FormDialog
        open={logging}
        onOpenChange={(open) => {
          setLogging(open);
          if (!open) action.setProblem(null);
        }}
        title="Log a legal request"
        fields={[
          { key: "from", label: "From", required: true, placeholder: "e.g. Kent Police" },
          {
            key: "kind",
            label: "Type",
            options: legalRequestKinds.map((kind) => ({ value: kind, label: kind })),
          },
          { key: "email", label: "Account email (if known)", type: "email" },
          { key: "due", label: "Reply due", type: "date" },
          { key: "note", label: "Note", area: true },
          {
            key: "hold",
            label: "Place a legal hold on the account too?",
            options: [
              { value: "no", label: "No" },
              { value: "yes", label: "Yes: keep everything until released" },
            ],
          },
        ]}
        okText="Log"
        busy={action.busy}
        error={action.problem}
        onSubmit={(values) => {
          void findCustomer(values.email ?? "").then((customer) => {
            if (values.email?.trim() && !customer) {
              action.setProblem("No account found with that address.");
              return;
            }
            void action
              .run(
                () =>
                  logLegalRequest({
                    fromWhom: values.from ?? "",
                    kind: (values.kind ?? "Other") as (typeof legalRequestKinds)[number],
                    customerId: customer?.id ?? null,
                    dueAt: values.due ? new Date(`${values.due}T17:00:00`).toISOString() : null,
                    note: values.note ?? "",
                    hold: values.hold === "yes" && Boolean(customer),
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
      <FormDialog
        open={holding}
        onOpenChange={(open) => {
          setHolding(open);
          if (!open) action.setProblem(null);
        }}
        title="Place a legal hold"
        intro="Nothing of the account can be deleted, by staff or by the customer, until the hold is released."
        fields={[
          { key: "email", label: "Account email", type: "email", required: true },
          { key: "why", label: "Why (saved to the audit log)", required: true },
        ]}
        okText="Place hold"
        busy={action.busy}
        error={action.problem}
        onSubmit={(values) => {
          void findCustomer(values.email ?? "").then((customer) => {
            if (!customer) {
              action.setProblem("No account found with that address.");
              return;
            }
            void action
              .run(
                () => placeLegalHold({ customerId: customer.id, why: values.why ?? "" }),
                "Hold placed",
              )
              .then((result) => {
                if (result) {
                  setData(result.data);
                  setHolding(false);
                }
              });
          });
        }}
      />
      {deciding && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeciding(null);
          }}
          title={deciding.status === "answered" ? "Mark as answered?" : "Mark as refused?"}
          text={`${deciding.request.kind} from ${deciding.request.fromWhom}.`}
          okText={deciding.status === "answered" ? "Answered" : "Refused"}
          busy={action.busy}
          error={action.problem}
          onConfirm={(reason) => {
            const current = deciding;
            void action
              .run(
                () =>
                  decideLegalRequest(current.request.id, { status: current.status, note: reason }),
                "Recorded",
              )
              .then((result) => {
                if (result) {
                  setData(result.data);
                  setDeciding(null);
                }
              });
          }}
        />
      )}
      {releasing && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setReleasing(null);
          }}
          title={`Release the hold on ${releasing.customer.handle}?`}
          text="Deletion works again for this account."
          okText="Release"
          reason={false}
          busy={action.busy}
          error={action.problem}
          onConfirm={() => {
            const hold = releasing;
            void action
              .run(() => releaseLegalHold(hold.customer.id), "Hold released")
              .then((result) => {
                if (result) {
                  setData(result.data);
                  setReleasing(null);
                }
              });
          }}
        />
      )}
    </>
  );
}
