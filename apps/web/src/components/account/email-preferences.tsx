"use client";

import type { AccountEmail, EmailCategory } from "@brawzer/contracts";
import { Switch } from "@brawzer/ui/components/switch";
import { useEffect, useId, useState } from "react";
import { fetchAccountEmail, updateEmailPreferences } from "@/lib/api/account";
import { leaveSignedInArea } from "@/lib/session-channel";

const CHOICES: readonly { category: EmailCategory; label: string; sub: string }[] = [
  {
    category: "usageNotices",
    label: "Usage notices",
    sub: "Once at 80% and once at 100% of browsing hours, Drive space or files.",
  },
  {
    category: "teamUpdates",
    label: "Team updates",
    sub: "When someone joins a team you run.",
  },
];

/**
 * Which optional emails the account gets. Security emails (sign-ins, changes
 * to the account) and billing emails are always sent; these two can be
 * turned off here or from any such email's footer.
 */
export function EmailPreferences() {
  const id = useId();
  const [state, setState] = useState<AccountEmail | null | "failed">(null);
  const [pending, setPending] = useState<EmailCategory | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAccountEmail().then((result) => {
      if (cancelled) return;
      if (result.ok) setState(result.data);
      else if (result.status === 401) leaveSignedInArea("expired");
      else setState("failed");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(category: EmailCategory, on: boolean) {
    if (state === null || state === "failed") return;
    setPending(category);
    const result = await updateEmailPreferences({ [category]: on });
    setPending(null);
    if (result.ok) setState(result.data);
    else if (result.status === 401) leaveSignedInArea("expired");
  }

  if (state === "failed") {
    return <p className="ad-li-sub">Couldn’t read your email settings. Try again later.</p>;
  }
  return (
    <div className="flex flex-col gap-3" data-testid="email-preferences">
      {state?.deliveryProblem && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-footnote text-danger" role="status">
          {state.deliveryProblem === "complained"
            ? "Email to your address was marked as spam, so Brawzer has stopped sending to it."
            : "Email to your address couldn’t be delivered, so Brawzer has stopped sending to it."}{" "}
          Change your address under Profile to start again.
        </p>
      )}
      {CHOICES.map((choice, index) => (
        <label
          key={choice.category}
          className="flex items-start gap-3"
          htmlFor={`${id}-${String(index)}`}
        >
          <Switch
            id={`${id}-${String(index)}`}
            checked={state?.preferences[choice.category] ?? true}
            disabled={state === null || pending !== null}
            onCheckedChange={(checked) => void toggle(choice.category, checked)}
          />
          <span className="min-w-0">
            <span className="ad-li-title block">{choice.label}</span>
            <span className="ad-li-sub block">{choice.sub}</span>
          </span>
        </label>
      ))}
      <p className="ad-li-sub">
        Emails about sign-ins, changes to your account and your plan are always sent.
      </p>
    </div>
  );
}
