"use client";

import { useEffect, useState } from "react";
import { cancelRecovery, confirmRecovery } from "@/lib/api/recovery";
import { forgetLinkToken, useLinkToken } from "@/lib/link-token";
import { AuthHeading, TextLink } from "./auth-ui";
import { CheckingLink } from "./link-states";

const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short" });

/** The confirm and cancel pages: the token lives in the URL fragment and is used once. */
export function RecoverLink({ action }: { action: "confirm" | "cancel" }) {
  const token = useLinkToken();
  const [outcome, setOutcome] = useState<
    | { kind: "pending" }
    | { kind: "confirmed"; releaseAt: string }
    | { kind: "cancelled" }
    | { kind: "bad"; message: string }
  >({ kind: "pending" });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const request =
      action === "confirm"
        ? confirmRecovery(token).then((result) =>
            result.ok
              ? ({ kind: "confirmed", releaseAt: result.data.releaseAt } as const)
              : ({ kind: "bad", message: result.error.message } as const),
          )
        : cancelRecovery(token).then((result) =>
            result.ok
              ? ({ kind: "cancelled" } as const)
              : ({ kind: "bad", message: result.error.message } as const),
          );
    void request.then((next) => {
      if (cancelled) return;
      forgetLinkToken();
      setOutcome(next);
    });
    return () => {
      cancelled = true;
    };
  }, [token, action]);

  const title = action === "confirm" ? "Confirm your recovery" : "Cancel the recovery";
  // Once the link is used the token is forgotten, so the outcome decides what shows.
  if (outcome.kind === "pending" && token !== null) {
    return <CheckingLink title={title} />;
  }
  if (outcome.kind === "bad" || (outcome.kind === "pending" && token === null)) {
    return (
      <div className="flex flex-col gap-6">
        <AuthHeading title="This link isn’t valid">
          <p>
            {outcome.kind === "bad"
              ? outcome.message
              : "It may have been used already, or it has expired."}
          </p>
        </AuthHeading>
        <p className="text-callout text-ink-secondary">
          <TextLink href="/recover">Start recovery again</TextLink> ·{" "}
          <TextLink href="/sign-in">Back to sign in</TextLink>
        </p>
      </div>
    );
  }
  if (outcome.kind === "confirmed") {
    return (
      <div className="flex flex-col gap-6">
        <AuthHeading title="Recovery confirmed">
          <p>
            Thanks. There is now a 48-hour wait: the account can be released at the earliest on{" "}
            <strong className="font-semibold text-ink">
              {when.format(new Date(outcome.releaseAt))}
            </strong>
            . Brawzer’s team checks the request meanwhile and may email you questions only you could
            answer.
          </p>
          <p>
            We’ve emailed you a link that cancels all of this. If you didn’t ask for recovery, use
            it.
          </p>
        </AuthHeading>
        <p className="text-callout text-ink-secondary">
          <TextLink href="/sign-in">Back to sign in</TextLink>
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <AuthHeading title="Recovery cancelled">
        <p>
          Nothing has changed on your account, and our security team has been told that someone may
          have tried to get in. If you can still sign in, change your password from Shield.
        </p>
      </AuthHeading>
      <p className="text-callout text-ink-secondary">
        <TextLink href="/sign-in">Back to sign in</TextLink>
      </p>
    </div>
  );
}
