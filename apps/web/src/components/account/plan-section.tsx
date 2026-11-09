"use client";

import type { BillingOverview } from "@brawzer/contracts";
import { Badge } from "@brawzer/ui/components/badge";
import { Button } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { useToast } from "@brawzer/ui/components/toast";
import { useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { LocalDate } from "@/components/local-date";
import { openBillingPortal, startCheckout } from "@/lib/api/billing";
import { describeLimits, formatPrice } from "@/lib/plans";
import { leaveSignedInArea } from "@/lib/session-channel";

const SOURCE_LABEL = {
  free: null,
  stripe: "Subscription",
  admin: "Set by Brawzer",
} as const;

/** The account's plan: what it allows, what is used, and the way to a bigger one. */
export function PlanSection({ overview }: { overview: BillingOverview }) {
  const toast = useToast();
  const confirmed = useConfirmedRequest();
  const [pending, setPending] = useState<string | null>(null);
  const rows = describeLimits(overview.plan.limits, overview.usage);
  const sourceLabel = SOURCE_LABEL[overview.source];
  const upgrades = overview.plans.filter((plan) => plan.code !== overview.plan.code);

  async function go(key: string, request: () => ReturnType<typeof startCheckout>) {
    setPending(key);
    const result = await confirmed(request);
    setPending(null);
    if (result.ok) {
      window.location.assign(result.data.url);
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else if (result.error.code !== "reauthentication_required") {
      toast.add({ type: "error", title: "That didn’t work", description: result.error.message });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-body font-medium text-ink">{overview.plan.name} plan</p>
        {overview.plan.price && (
          <span className="text-callout text-ink-secondary">
            {formatPrice(overview.plan.price)}
          </span>
        )}
        {overview.team ? (
          <Badge tone="neutral">From your team</Badge>
        ) : (
          sourceLabel && <Badge tone="neutral">{sourceLabel}</Badge>
        )}
      </div>
      {overview.team && (
        <p className="text-footnote text-ink-secondary">
          You’re in {overview.team.name}, so you use its owner’s plan ({overview.team.owner} pays
          for it). Leave the team on the Team page to choose a plan of your own.
        </p>
      )}
      {overview.subscription && overview.source === "stripe" && (
        <p className="text-footnote text-ink-secondary">
          {overview.subscription.cancelAtPeriodEnd
            ? "Ends"
            : overview.subscription.status === "past_due"
              ? "Payment overdue; renews"
              : "Renews"}{" "}
          {overview.subscription.currentPeriodEnd ? (
            <LocalDate iso={overview.subscription.currentPeriodEnd} />
          ) : (
            "at the end of the period"
          )}
          .
        </p>
      )}
      <dl className="grid gap-3 sm:grid-cols-2" aria-label="Plan limits and usage">
        {rows.map((row) => (
          <div key={row.label} className="rounded-lg border border-line px-4 py-3">
            <dt className="text-footnote text-ink-secondary">{row.label}</dt>
            <dd className="mt-0.5 text-callout text-ink">
              {row.used !== null ? `${row.used} of ${row.allowed}` : row.allowed}
              {row.ratio !== null && (
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover"
                  role="meter"
                  aria-label={`${row.label} used`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(row.ratio * 100)}
                >
                  <div
                    className={row.ratio >= 0.9 ? "h-full bg-warning" : "h-full bg-accent"}
                    style={{ width: `${String(Math.round(row.ratio * 100))}%` }}
                  />
                </div>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {overview.team ? null : overview.billing === "unavailable" ? (
        <FormMessage tone="info" title="Paid plans aren’t set up on this installation yet">
          Everyone is on the free plan. When plans are offered, they appear here with their prices,
          and payment goes through Stripe.
        </FormMessage>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {overview.trialEligible &&
            upgrades.some((plan) => plan.code !== "free" && plan.trialDays !== null) && (
              <p className="basis-full text-footnote text-ink-secondary">
                A trial is free: Stripe asks for a payment method and charges nothing until it ends.
                Cancel before then from Invoices and payment method, and nothing is charged.
              </p>
            )}
          {upgrades.map((plan) => (
            <Button
              key={plan.code}
              variant={plan.code === "free" ? "secondary" : "primary"}
              loading={pending === plan.code}
              disabled={pending !== null}
              onClick={() =>
                void go(plan.code, () =>
                  plan.code === "free" ? openBillingPortal() : startCheckout(plan.code),
                )
              }
            >
              {plan.code === "free"
                ? "Cancel the subscription"
                : plan.trialDays && overview.trialEligible
                  ? `Try ${plan.name} free for ${String(plan.trialDays)} days`
                  : `Move to ${plan.name}${plan.price ? ` · ${formatPrice(plan.price)}` : ""}`}
            </Button>
          ))}
          {overview.source === "stripe" && (
            <Button
              variant="secondary"
              loading={pending === "portal"}
              disabled={pending !== null}
              onClick={() => void go("portal", openBillingPortal)}
            >
              Invoices and payment method
            </Button>
          )}
          <p className="basis-full text-footnote text-ink-secondary">
            Payment is handled by Stripe on its own pages; Brawzer never sees card numbers. Moving
            to a plan asks you to confirm it’s you first.
          </p>
        </div>
      )}
    </div>
  );
}
