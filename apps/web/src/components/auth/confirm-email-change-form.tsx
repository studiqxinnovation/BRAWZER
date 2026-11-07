"use client";

import { Button, buttonVariants } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { cn } from "@brawzer/ui/lib/cn";
import { useEffect, useRef, useState } from "react";
import { confirmEmailChange } from "@/lib/api/account";
import { forgetLinkToken, useLinkToken } from "@/lib/link-token";
import { AuthHeading } from "./auth-ui";
import { CheckingLink, UnusableLink } from "./link-states";

type State =
  | { kind: "ready"; failure: string | null }
  | { kind: "done"; email: string }
  | { kind: "expired" }
  | { kind: "taken" };

/**
 * Confirms a new email address. It takes a click rather than happening on
 * load, so a mail scanner that opens links can't confirm a change for you.
 */
export function ConfirmEmailChangeForm() {
  const token = useLinkToken();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<State>({ kind: "ready", failure: null });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (state.kind !== "ready") headingRef.current?.focus();
  }, [state.kind]);

  if (state.kind === "done") {
    return (
      <div className="flex flex-col gap-6">
        <AuthHeading title="Your email address was changed" headingRef={headingRef}>
          <p>
            Brawzer now uses <span className="font-medium break-all text-ink">{state.email}</span>{" "}
            for signing in and for security emails. Your password and everything else stay the same.
          </p>
        </AuthHeading>
        {/* A full page load into the signed-in area, which has its own security policy. */}
        <a href="/app/account" className={cn(buttonVariants({ variant: "primary" }), "self-start")}>
          Go to your account
        </a>
      </div>
    );
  }

  if (state.kind === "taken") {
    return (
      <UnusableLink
        headingRef={headingRef}
        title="That address already has an account"
        primary={{ href: "/sign-in", label: "Sign in" }}
      >
        <p>
          Another Brawzer account started using this address after you asked for the change, so your
          account keeps its current address.
        </p>
      </UnusableLink>
    );
  }

  if (token === undefined) return <CheckingLink title="Confirm your new email" />;

  if (token === null || state.kind === "expired") {
    return (
      <UnusableLink
        headingRef={headingRef}
        title={
          state.kind === "expired"
            ? "This link has expired or has already been used"
            : "This link isn’t complete"
        }
        primary={{ href: "/sign-in", label: "Sign in" }}
      >
        {state.kind !== "expired" ? (
          <p>
            Open the link from your email again. If you copied it, make sure you copied all of it.
          </p>
        ) : (
          <p>
            If you’ve already confirmed the change, sign in with your new address. If not, ask for a
            new link under Account. Each link works once, and only the newest one works.
          </p>
        )}
      </UnusableLink>
    );
  }

  async function confirm() {
    if (!token) return;
    setPending(true);
    const result = await confirmEmailChange(token);
    setPending(false);
    if (result.ok) {
      forgetLinkToken();
      setState({ kind: "done", email: result.data.email });
    } else if (result.error.code === "token_invalid") {
      forgetLinkToken();
      setState({ kind: "expired" });
    } else if (result.error.code === "conflict") {
      forgetLinkToken();
      setState({ kind: "taken" });
    } else {
      setState({ kind: "ready", failure: result.error.message });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Confirm your new email" headingRef={headingRef}>
        <p>
          Brawzer will use this address for signing in and for security emails. Your old address
          will be told about the change.
        </p>
      </AuthHeading>
      {state.failure && <FormMessage tone="danger">{state.failure}</FormMessage>}
      <Button
        variant="primary"
        size="lg"
        loading={pending}
        className="w-full"
        onClick={() => void confirm()}
      >
        Confirm new email address
      </Button>
    </div>
  );
}
