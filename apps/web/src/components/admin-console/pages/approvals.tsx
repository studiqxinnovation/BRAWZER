"use client";

import type { Approval, ApprovalList } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { decideApproval, fetchApprovals } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { ago, Avatar, Loading, money, Pill, ReasonDialog } from "../ui";
import { useAction } from "../use-action";

const STATUS_TONE: Record<Approval["status"], "o" | "g" | "r"> = {
  waiting: "o",
  approved: "g",
  declined: "r",
};
const STATUS_NAME: Record<Approval["status"], string> = {
  waiting: "Waiting",
  approved: "Approved",
  declined: "Declined",
};

/** The "four eyes" rule: refunds and discounts over a limit wait here for a founder. */
export function ApprovalsPage() {
  const me = useStaff();
  const [data, setData] = useState<ApprovalList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<Approval | null>(null);
  const [approving, setApproving] = useState<Approval | null>(null);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void fetchApprovals().then((result) => {
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
  if (!data) return <Loading what="approvals" />;
  const decide = (approval: Approval, approve: boolean, reason: string, close: () => void) => {
    void action
      .run(
        () => decideApproval(approval.id, approve, reason),
        approve ? "Approved and carried out" : "Declined",
      )
      .then((result) => {
        if (result) {
          setData(result.data);
          close();
        }
      });
  };
  return (
    <>
      <p className="muted" style={{ marginBottom: 16 }}>
        The “four eyes” rule: risky actions need a second person. Staff ask, a founder decides, and
        nobody approves their own request. Approving carries the action out in Stripe.
      </p>
      <div className="card p0">
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Asked by</th>
              <th>When</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {data.approvals.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  Nothing waiting
                </td>
              </tr>
            ) : (
              data.approvals.map((approval) => (
                <tr key={approval.id}>
                  <td>
                    <b style={{ fontWeight: 500 }}>{approval.what}</b>
                    <div className="muted sm">
                      {approval.kind} · <span className="mask">{approval.target}</span>
                      {approval.amount
                        ? ` · ${money(approval.amount.amount, approval.amount.currency)}`
                        : ""}
                    </div>
                    {approval.reason && (
                      <div className="muted sm">
                        {approval.decidedBy}: {approval.reason}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      <Avatar name={approval.requestedBy ?? "staff"} size={26} />
                      {approval.requestedBy ?? "(account gone)"}
                    </div>
                  </td>
                  <td className="muted">{ago(approval.createdAt)}</td>
                  <td>
                    <Pill tone={STATUS_TONE[approval.status]}>{STATUS_NAME[approval.status]}</Pill>
                    {approval.decidedAt && (
                      <div className="muted sm">
                        {approval.decidedBy} · {ago(approval.decidedAt)}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {approval.status === "waiting" && (
                      <>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            setDeclining(approval);
                          }}
                        >
                          Decline
                        </button>{" "}
                        <button
                          type="button"
                          className="btn sm pri"
                          disabled={approval.requestedBy === me.email}
                          title={
                            approval.requestedBy === me.email
                              ? "You can’t approve your own request"
                              : undefined
                          }
                          onClick={() => {
                            setApproving(approval);
                          }}
                        >
                          Approve
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {approving && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setApproving(null);
          }}
          title="Approve and carry out?"
          text={`${approving.what}. Asked by ${approving.requestedBy ?? "staff"}. This happens in Stripe now.`}
          okText="Approve"
          reason={false}
          busy={action.busy}
          error={action.problem}
          onConfirm={() => {
            decide(approving, true, "", () => {
              setApproving(null);
            });
          }}
        />
      )}
      {declining && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeclining(null);
          }}
          title="Decline?"
          text={declining.what}
          okText="Decline"
          danger
          busy={action.busy}
          error={action.problem}
          onConfirm={(reason) => {
            decide(declining, false, reason, () => {
              setDeclining(null);
            });
          }}
        />
      )}
    </>
  );
}
