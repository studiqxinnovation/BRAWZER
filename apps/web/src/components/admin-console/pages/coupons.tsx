"use client";

import { can, COUPON_APPROVAL_PERCENT, type CouponList } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { createCoupon, fetchCoupons, toggleCoupon } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { fdate, FormDialog, Loading } from "../ui";
import { useAction } from "../use-action";

/** Coupons: Stripe promotion codes, read and made live. */
export function CouponsPage() {
  const me = useStaff();
  const [data, setData] = useState<CouponList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void fetchCoupons().then((result) => {
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
  if (!data) return <Loading what="coupons" />;
  if (!data.stripeConfigured) {
    return (
      <div className="infobox">
        Stripe isn’t configured on this installation, so there are no coupons. Once it is, promotion
        codes are made and turned on or off here, and customers enter them at checkout.
      </div>
    );
  }
  const may = can(me.role, "coupon");
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted sm">
          Discounts over {COUPON_APPROVAL_PERCENT}% need a founder’s approval unless a founder makes
          them. Customers enter the code at checkout.
        </span>
        {may && (
          <button
            type="button"
            className="btn pri sm"
            style={{ marginLeft: "auto" }}
            onClick={() => {
              setCreating(true);
            }}
          >
            New coupon
          </button>
        )}
      </div>
      {notice && <div className="okbox">{notice}</div>}
      <div className="card p0">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>What it gives</th>
              <th>Used</th>
              <th>Ends</th>
              <th style={{ textAlign: "right" }}>Active</th>
            </tr>
          </thead>
          <tbody>
            {data.coupons.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  No coupons yet
                </td>
              </tr>
            ) : (
              data.coupons.map((coupon) => (
                <tr key={coupon.id}>
                  <td className="mask">
                    <b>{coupon.code}</b>
                  </td>
                  <td>{coupon.gives}</td>
                  <td>
                    {coupon.timesRedeemed}
                    {coupon.maxRedemptions ? ` / ${String(coupon.maxRedemptions)}` : ""}
                  </td>
                  <td className="muted">
                    {coupon.expiresAt ? fdate(coupon.expiresAt) : "No end date"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      role="switch"
                      className="tgl"
                      aria-checked={coupon.active}
                      aria-label={`${coupon.active ? "Active" : "Off"}: ${coupon.code}`}
                      disabled={!may || action.busy}
                      onClick={() => {
                        void action
                          .run(
                            () => toggleCoupon(coupon.id, !coupon.active),
                            coupon.active ? "Turned off" : "Turned on",
                          )
                          .then((result) => {
                            if (result) setData(result.data);
                          });
                      }}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <FormDialog
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open) action.setProblem(null);
        }}
        title="New coupon"
        intro="Made in Stripe as a coupon with a promotion code. The code is what customers type."
        fields={[
          { key: "code", label: "Code", required: true, placeholder: "SUMMER26" },
          {
            key: "percentOff",
            label: "Percent off (leave empty for an amount)",
            type: "number",
            placeholder: "25",
          },
          {
            key: "amountOff",
            label: "Or amount off, in the plan currency (for example 5.00)",
            placeholder: "5.00",
          },
          {
            key: "duration",
            label: "For how long",
            options: [
              { value: "once", label: "Once: the first payment" },
              { value: "repeating", label: "For a number of months" },
              { value: "forever", label: "For as long as they subscribe" },
            ],
          },
          {
            key: "durationInMonths",
            label: "Months (when repeating)",
            type: "number",
            placeholder: "3",
          },
          { key: "maxRedemptions", label: "Usage limit (blank = unlimited)", type: "number" },
          { key: "expiresAt", label: "Ends (optional)", type: "date" },
        ]}
        okText="Create"
        busy={action.busy}
        error={action.problem}
        onSubmit={(values) => {
          const percent = values.percentOff ? Number(values.percentOff) : undefined;
          const amount = values.amountOff
            ? Math.round(Number.parseFloat(values.amountOff) * 100)
            : undefined;
          void action
            .run(
              () =>
                createCoupon({
                  code: (values.code ?? "").toUpperCase(),
                  ...(percent ? { percentOff: percent } : {}),
                  ...(amount && !percent ? { amountOff: amount, currency: "gbp" } : {}),
                  duration: (values.duration ?? "once") as "once" | "repeating" | "forever",
                  ...(values.durationInMonths
                    ? { durationInMonths: Number(values.durationInMonths) }
                    : {}),
                  ...(values.maxRedemptions
                    ? { maxRedemptions: Number(values.maxRedemptions) }
                    : {}),
                  ...(values.expiresAt
                    ? { expiresAt: new Date(`${values.expiresAt}T23:59:59`).toISOString() }
                    : {}),
                }),
              null,
            )
            .then((result) => {
              if (!result) return;
              setCreating(false);
              setData(result.data.list);
              setNotice(
                result.data.outcome === "created"
                  ? "Coupon created."
                  : "Over 15%: sent to a founder for approval. It’s on the Approvals page.",
              );
            });
        }}
      />
    </>
  );
}
