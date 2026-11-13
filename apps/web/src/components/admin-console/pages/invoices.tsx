"use client";

import { can, type InvoiceList, refundLimitsMinor, type StaffInvoice } from "@brawzer/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchInvoices, refundInvoice } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { fdate, FormDialog, Kpi, Loading, money, Pill, Tabs } from "../ui";
import { useAction } from "../use-action";

type View = "all" | "unpaid" | "refunds";
const STATUS_TONE: Record<string, "g" | "o" | "r" | "b" | ""> = {
  paid: "g",
  open: "o",
  draft: "b",
  uncollectible: "r",
  void: "",
};

/** Invoices and refunds: Stripe's records, read live; refunds over a role's limit wait for a founder. */
export function InvoicesPage() {
  const me = useStaff();
  const params = useSearchParams();
  const customer = params.get("customer") ?? undefined;
  const [view, setView] = useState<View>("all");
  const [data, setData] = useState<InvoiceList | null>(null);
  const [extra, setExtra] = useState<StaffInvoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<StaffInvoice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void fetchInvoices({ customer }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) leaveSignedInArea("expired");
        setError(result.error.message);
        return;
      }
      setExtra([]);
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [customer, version]);

  if (error) return <div className="warnbox">{error}</div>;
  if (!data) return <Loading what="invoices" />;
  if (!data.stripeConfigured) {
    return (
      <div className="infobox">
        Stripe isn’t configured on this installation, so there are no invoices to show. Once it is,
        invoices, refunds and credit notes appear here from Stripe’s own records.
      </div>
    );
  }
  const invoices = [...data.invoices, ...extra];
  const shown =
    view === "unpaid"
      ? invoices.filter((entry) => entry.status === "open" || entry.status === "uncollectible")
      : view === "refunds"
        ? invoices.filter((entry) => entry.amountRefunded > 0)
        : invoices;
  const currency = invoices[0]?.total.currency ?? "gbp";
  const paid = invoices.filter((entry) => entry.status === "paid");
  const unpaid = invoices.filter(
    (entry) => entry.status === "open" || entry.status === "uncollectible",
  );
  const role = me.role;
  const limit: number | null = role in refundLimitsMinor ? refundLimitsMinor[role] : 0;
  const mayRefund = can(me.role, "refund");
  const more = async () => {
    const last = invoices.at(-1);
    if (!last) return;
    const result = await fetchInvoices({ customer, after: last.id });
    if (result.ok) {
      setExtra((current) => [...current, ...result.data.invoices]);
      setData((current) => (current ? { ...current, hasMore: result.data.hasMore } : current));
    }
  };
  return (
    <>
      {customer && (
        <div className="infobox">
          Showing one account’s invoices. <Link href="/admin/invoices">Show all</Link>
        </div>
      )}
      <div className="g4 grid" style={{ marginBottom: 16 }}>
        <Kpi
          label="Paid, in this list"
          value={money(
            paid.reduce((sum, entry) => sum + entry.amountPaid, 0),
            currency,
          )}
          note={`${String(paid.length)} invoices`}
        />
        <Kpi
          label="Unpaid"
          value={money(
            unpaid.reduce((sum, entry) => sum + entry.total.amount, 0),
            currency,
          )}
          note={`${String(unpaid.length)} invoices`}
          tone={unpaid.length ? "dn" : null}
        />
        <Kpi
          label="Refunded"
          value={money(
            invoices.reduce((sum, entry) => sum + entry.amountRefunded, 0),
            currency,
          )}
          note="in this list"
        />
        <Kpi
          label="Your refund limit"
          value={limit === null ? "No limit" : money(limit, currency)}
          note="above it a founder approves"
        />
      </div>
      <Tabs
        label="Invoices"
        tabs={[
          { key: "all", label: "All invoices", count: invoices.length },
          { key: "unpaid", label: "Unpaid", count: unpaid.length },
          {
            key: "refunds",
            label: "Refunds",
            count: invoices.filter((e) => e.amountRefunded > 0).length,
          },
        ]}
        current={view}
        onChange={setView}
      />
      <div className="card p0">
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Date</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">
                  No invoices
                </td>
              </tr>
            ) : (
              shown.map((invoice) => {
                const refundable = invoice.amountPaid - invoice.amountRefunded;
                return (
                  <tr key={invoice.id}>
                    <td className="mask">{invoice.number ?? invoice.id}</td>
                    <td>
                      {invoice.customer ? (
                        <Link href={`/admin/customers/${invoice.customer.id}` as never}>
                          {invoice.customer.handle}
                        </Link>
                      ) : (
                        <span className="muted mask">{invoice.stripeCustomerId ?? "—"}</span>
                      )}
                    </td>
                    <td className="muted">{fdate(invoice.createdAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      {money(invoice.total.amount, invoice.total.currency)}
                      {invoice.amountRefunded > 0 && (
                        <div className="muted sm">
                          −{money(invoice.amountRefunded, invoice.total.currency)} refunded
                        </div>
                      )}
                    </td>
                    <td>
                      <Pill tone={STATUS_TONE[invoice.status] ?? ""}>{invoice.status}</Pill>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {invoice.hostedUrl && (
                        <a
                          className="btn sm"
                          href={invoice.hostedUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View
                        </a>
                      )}{" "}
                      {invoice.status === "paid" && refundable > 0 && (
                        <button
                          type="button"
                          className="btn sm"
                          disabled={!mayRefund}
                          title={mayRefund ? undefined : "Your role can’t refund"}
                          onClick={() => {
                            setRefunding(invoice);
                          }}
                        >
                          Refund
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {data.hasMore && (
          <div style={{ padding: 12, textAlign: "center" }}>
            <button type="button" className="btn sm" onClick={() => void more()}>
              Show older
            </button>
          </div>
        )}
      </div>

      {refunding && (
        <FormDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setRefunding(null);
              action.setProblem(null);
            }
          }}
          title={`Refund ${refunding.number ?? refunding.id}`}
          intro={`Up to ${money(refunding.amountPaid - refunding.amountRefunded, refunding.total.currency)} can still be refunded. ${limit === null ? "" : `Above ${money(limit, refunding.total.currency)} a founder has to approve.`} Refunds take 5 to 10 working days to reach the card.`}
          fields={[
            {
              key: "amount",
              label: `Amount in ${refunding.total.currency.toUpperCase()} (for example 12.50)`,
              required: true,
              value: ((refunding.amountPaid - refunding.amountRefunded) / 100).toFixed(2),
            },
            { key: "reason", label: "Reason (saved to the audit log)", required: true },
          ]}
          okText="Refund"
          busy={action.busy}
          error={action.problem}
          onSubmit={(values) => {
            const amount = Math.round(Number.parseFloat(values.amount ?? "0") * 100);
            if (!Number.isFinite(amount) || amount <= 0) {
              action.setProblem("Give an amount, like 12.50.");
              return;
            }
            const invoice = refunding;
            void action
              .run(() => refundInvoice(invoice.id, { amount, reason: values.reason ?? "" }), null)
              .then((result) => {
                if (!result) return;
                setRefunding(null);
                if (result.data.outcome === "refunded") {
                  setVersion((current) => current + 1);
                } else {
                  setNotice(
                    "Over your limit: sent to a founder for approval. It’s on the Approvals page.",
                  );
                }
              });
          }}
        />
      )}
      {notice && (
        <div className="okbox" style={{ marginTop: 12 }}>
          {notice}
        </div>
      )}
    </>
  );
}
