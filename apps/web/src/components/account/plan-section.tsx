"use client";

import type { BillingOverview } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { Pill } from "@/components/app-shell/page";
import { LocalDate } from "@/components/local-date";
import { openBillingPortal, startCheckout } from "@/lib/api/billing";
import { formatBytes } from "@/lib/drive";
import { formatMinutes, formatPrice } from "@/lib/plans";
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

  const { limits } = overview.plan;
  const { usage } = overview;
  const line = [
    `${String(usage.profiles)} of ${String(limits.profiles)} profiles`,
    `${formatBytes(usage.driveBytes)} of ${formatBytes(limits.driveBytes)} Drive`,
    `${String(limits.liveSessions)} browsers at once`,
    limits.teamMembers < 2 ? "no team" : `${String(limits.teamMembers)} team seats`,
    limits.browsingMinutesPerMonth === null
      ? "No monthly cap"
      : `${formatMinutes(usage.browsingMinutesThisMonth)} of ${formatMinutes(limits.browsingMinutesPerMonth)} this month`,
  ];

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-2">
        <p className="ad-stat-big">
          {overview.plan.name}
          <span className="sr-only"> plan</span>
        </p>
        {overview.team ? (
          <Pill tone="grey">From your team</Pill>
        ) : (
          <Pill tone="grey">{sourceLabel ?? "Current plan"}</Pill>
        )}
        {overview.plan.price && (
          <span className="text-footnote text-ink-secondary">
            {formatPrice(overview.plan.price)}
          </span>
        )}
      </div>
      <p className="ad-li-sub mt-[10px] mb-[14px] leading-[1.7]">{line.join(" · ")}</p>
      {overview.team && (
        <p className="ad-stat-small mb-3">
          You’re in {overview.team.name}, so you use its owner’s plan ({overview.team.owner} pays
          for it). Leave the team on the Team page to choose a plan of your own.
        </p>
      )}
      {overview.subscription && overview.source === "stripe" && (
        <p className="ad-stat-small mb-3">
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
      {overview.team ? null : overview.billing === "unavailable" ? (
        <p className="ad-stat-small">
          Paid plans aren’t set up on this installation yet. Everyone is on the free plan; when
          plans are offered, they appear here with their prices, and payment goes through Stripe.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {upgrades.map((plan) => (
            <Button
              key={plan.code}
              size="sm"
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
                  : `Upgrade to ${plan.name}${plan.price ? ` · ${formatPrice(plan.price)}` : ""}`}
            </Button>
          ))}
          {overview.source === "stripe" && (
            <Button
              variant="secondary"
              size="sm"
              loading={pending === "portal"}
              disabled={pending !== null}
              onClick={() => void go("portal", openBillingPortal)}
            >
              Invoices and payment method
            </Button>
          )}
          <p className="ad-stat-small basis-full">
            Payment is handled by Stripe on its own pages; Brawzer never sees card numbers. Moving
            to a plan asks you to confirm it’s you first.
            {overview.trialEligible &&
            upgrades.some((plan) => plan.code !== "free" && plan.trialDays !== null)
              ? " A trial is free: Stripe asks for a payment method and charges nothing until it ends."
              : ""}
          </p>
        </div>
      )}
    </div>
  );
}
