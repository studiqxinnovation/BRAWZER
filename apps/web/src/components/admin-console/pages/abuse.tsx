"use client";

import {
  type AbuseKind,
  abuseKindNames,
  abuseKinds,
  type AbuseReport,
  type AbuseReportList,
  abuseStatusNames,
  can,
} from "@brawzer/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { decideAbuse, fetchAbuseReports, fetchCustomers, logAbuseReport } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { ago, Card, FormDialog, Loading, Pill, ReasonDialog } from "../ui";
import { useAction } from "../use-action";

const KIND_TONE: Record<AbuseKind, "r" | "o"> = {
  phishing: "r",
  fraud: "r",
  spam: "o",
  bots: "o",
  other: "o",
};
const STATUS_TONE: Record<AbuseReport["status"], "o" | "b" | "r" | "g"> = {
  open: "o",
  warned: "b",
  suspended: "r",
  dismissed: "g",
};

/** Abuse reports: what we were told, what was done, with the evidence held when it matters. */
export function AbusePage() {
  const me = useStaff();
  const [data, setData] = useState<AbuseReportList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [deciding, setDeciding] = useState<{
    report: AbuseReport;
    action: "warn" | "suspend" | "dismiss";
  } | null>(null);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void fetchAbuseReports().then((result) => {
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
  if (!data) return <Loading what="abuse reports" />;
  const may = can(me.role, "abuse");
  const TITLES = {
    warn: "Warn the account?",
    suspend: "Suspend and keep the evidence?",
    dismiss: "Close as not abuse?",
  } as const;
  const TEXTS = {
    warn: "They get an email naming the report and the acceptable use policy. Your note goes into it.",
    suspend:
      "The account is suspended now: sessions end, sign-in is refused, data is kept. A legal hold is placed so nothing of it can be deleted while the evidence matters.",
    dismiss: "The report is closed. Nothing changes on the account.",
  } as const;
  return (
    <>
      <div className="infobox">
        Cloud browsers can be misused for phishing, bots, spam and fraud. That gets Brawzer’s
        addresses blocked for every customer, so act quickly, and keep evidence before suspending.
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted sm">
          Reports come in by email and from providers; log them here.
        </span>
        {may && (
          <button
            type="button"
            className="btn pri sm"
            style={{ marginLeft: "auto" }}
            onClick={() => {
              setLogging(true);
            }}
          >
            Log a report
          </button>
        )}
      </div>
      <div className="card p0">
        <table>
          <thead>
            <tr>
              <th>Report</th>
              <th>Type</th>
              <th>From</th>
              <th>Account</th>
              <th>Details</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {data.reports.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  No reports
                </td>
              </tr>
            ) : (
              data.reports.map((report) => (
                <tr key={report.id}>
                  <td>
                    <span className="mask">{report.id.slice(0, 8)}</span>
                    <div className="muted sm">{ago(report.createdAt)}</div>
                  </td>
                  <td>
                    <Pill tone={KIND_TONE[report.kind]}>{abuseKindNames[report.kind]}</Pill>
                  </td>
                  <td className="sm">{report.source}</td>
                  <td>
                    <Link href={`/admin/customers/${report.customer.id}` as never}>
                      {report.customer.handle}
                    </Link>
                    <div className="muted sm">
                      {report.customer.planName}
                      {report.held ? " · legal hold" : ""}
                    </div>
                  </td>
                  <td className="sm" style={{ maxWidth: 280 }}>
                    {report.detail}
                    {report.note && <div className="muted">Decision: {report.note}</div>}
                  </td>
                  <td>
                    <Pill tone={STATUS_TONE[report.status]}>{abuseStatusNames[report.status]}</Pill>
                    {report.decidedBy && (
                      <div className="muted sm">
                        {report.decidedBy} · {ago(report.decidedAt)}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {report.status === "open" && may && (
                      <>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setDeciding({ report, action: "warn" })}
                        >
                          Warn
                        </button>{" "}
                        <button
                          type="button"
                          className="btn sm dng"
                          onClick={() => setDeciding({ report, action: "suspend" })}
                        >
                          Suspend + keep evidence
                        </button>{" "}
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setDeciding({ report, action: "dismiss" })}
                        >
                          Not abuse
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
      <div className="g3 grid" style={{ marginTop: 16 }}>
        <Card title="Automatic protection">
          <div className="sm" style={{ lineHeight: 1.8 }}>
            Sessions at once are capped by the plan · sign-ins and sign-ups are rate limited by
            address · outbound mail ports are closed in the egress policy · uploads are scanned
            before they can be opened
          </div>
        </Card>
        <Card title="Our addresses on block lists">
          <div className="sm muted" style={{ lineHeight: 1.7 }}>
            Not checked automatically: Brawzer has no address pool of its own, so sessions leave
            from the hosting provider’s addresses or the customer’s proxy. If a site starts refusing
            Brawzer, it shows up in support requests first.
          </div>
        </Card>
        <Card title="Rules">
          <div className="sm" style={{ lineHeight: 1.7 }}>
            The acceptable use policy bans phishing, scraping without permission, automated ticket
            buying, spam, and anything illegal. First serious breach: a warning or suspension.
            Phishing or fraud: suspension with the evidence held.
          </div>
        </Card>
      </div>

      <FormDialog
        open={logging}
        onOpenChange={(open) => {
          setLogging(open);
          if (!open) action.setProblem(null);
        }}
        title="Log an abuse report"
        fields={[
          { key: "email", label: "Account email", type: "email", required: true },
          {
            key: "kind",
            label: "Type",
            options: abuseKinds.map((kind) => ({ value: kind, label: abuseKindNames[kind] })),
          },
          {
            key: "source",
            label: "Who told us",
            required: true,
            placeholder: "e.g. hosting provider, a bank, a customer",
          },
          { key: "detail", label: "What they said", area: true, required: true },
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
                  logAbuseReport({
                    customerId: match.id,
                    kind: (values.kind ?? "other") as AbuseKind,
                    source: values.source ?? "",
                    detail: values.detail ?? "",
                  }),
                "Report logged",
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
      {deciding && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeciding(null);
          }}
          title={TITLES[deciding.action]}
          text={`${deciding.report.customer.handle}: ${abuseKindNames[deciding.report.kind]}. ${TEXTS[deciding.action]}`}
          okText={
            deciding.action === "warn"
              ? "Send warning"
              : deciding.action === "suspend"
                ? "Suspend"
                : "Close"
          }
          danger={deciding.action === "suspend"}
          busy={action.busy}
          error={action.problem}
          onConfirm={(reason) => {
            const current = deciding;
            void action
              .run(
                () => decideAbuse(current.report.id, { action: current.action, note: reason }),
                "Done",
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
    </>
  );
}
