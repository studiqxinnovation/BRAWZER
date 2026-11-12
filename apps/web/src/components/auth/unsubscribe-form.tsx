"use client";

import { Button, buttonVariants } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { unsubscribe } from "@/lib/api/account";
import { forgetLinkToken, useLinkToken } from "@/lib/link-token";
import { AuthHeading } from "./auth-ui";
import { CheckingLink, UnusableLink } from "./link-states";

const NAMES = { usageNotices: "usage notices", teamUpdates: "team updates" } as const;

type Outcome =
  | { kind: "ask" }
  | { kind: "done"; category: keyof typeof NAMES; email: string }
  | { kind: "expired" };

/**
 * Opened from the footer of an optional email. A button, not the link alone,
 * does it: a mail scanner opening the link mustn't change anyone's settings.
 */
export function UnsubscribeForm() {
  const token = useLinkToken();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "ask" });
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (outcome.kind !== "ask") headingRef.current?.focus();
  }, [outcome.kind]);

  if (token === undefined) return <CheckingLink title="Checking the link" />;
  if (token === null || outcome.kind === "expired") {
    return (
      <UnusableLink
        headingRef={headingRef}
        title="This link can’t be used"
        primary={{ href: "/sign-in", label: "Sign in" }}
      >
        <p>
          It has expired or was used already. Every optional email can also be turned off under
          Account → Email notifications once you’re signed in.
        </p>
      </UnusableLink>
    );
  }
  if (outcome.kind === "done") {
    return (
      <div className="flex flex-col gap-6">
        <AuthHeading title={`No more ${NAMES[outcome.category]}`} headingRef={headingRef}>
          <p>
            Brawzer won’t send {NAMES[outcome.category]} to{" "}
            <span className="font-medium text-ink">{outcome.email}</span> again. Emails about
            sign-ins, changes to the account and the plan are still sent, as they must be.
          </p>
        </AuthHeading>
        <Link
          href="/app/account"
          className={buttonVariants({ variant: "secondary", className: "self-start" })}
        >
          Email settings
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <AuthHeading title="Stop these emails?" headingRef={headingRef}>
        <p>
          This turns off the kind of email that brought you here. Emails about sign-ins, changes to
          your account and your plan are always sent.
        </p>
      </AuthHeading>
      {failure && <FormMessage tone="danger">{failure}</FormMessage>}
      <Button
        variant="primary"
        className="self-start"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setFailure(null);
          void unsubscribe(token).then((result) => {
            setPending(false);
            if (result.ok) {
              forgetLinkToken();
              setOutcome({
                kind: "done",
                category: result.data.category,
                email: result.data.email,
              });
            } else if (result.error.code === "token_invalid") {
              setOutcome({ kind: "expired" });
            } else {
              setFailure(result.error.message);
            }
          });
        }}
      >
        {pending ? "Stopping…" : "Stop these emails"}
      </Button>
    </div>
  );
}
