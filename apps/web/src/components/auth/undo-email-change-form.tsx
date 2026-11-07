"use client";

import { undoEmailChangeRequestSchema } from "@brawzer/contracts";
import { Button, buttonVariants } from "@brawzer/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { PasswordInput } from "@brawzer/ui/components/password-input";
import Link from "next/link";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { undoEmailChange } from "@/lib/api/account";
import { fieldErrorsFromDetails, fieldErrorsFromIssues } from "@/lib/api/client";
import { forgetLinkToken, useLinkToken } from "@/lib/link-token";
import { AuthHeading, focusFirstInvalid } from "./auth-ui";
import { CheckingLink, UnusableLink } from "./link-states";

type Outcome =
  { kind: "form" } | { kind: "done"; email: string } | { kind: "expired" } | { kind: "taken" };

/**
 * Opened from the email sent to the old address after an email change. The
 * owner chooses a new password, because whoever changed the address had the
 * old one; the account goes back to this address and every device is signed
 * out.
 */
export function UndoEmailChangeForm() {
  const token = useLinkToken();
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "form" });

  useEffect(() => {
    if (outcome.kind !== "form") headingRef.current?.focus();
  }, [outcome.kind]);

  if (outcome.kind === "done") {
    return (
      <div className="flex flex-col gap-6">
        <AuthHeading title="Your email address was restored" headingRef={headingRef}>
          <p>
            Your account uses{" "}
            <span className="font-medium break-all text-ink">{outcome.email}</span> again, your new
            password is set, and every device was signed out. Sign in, then check your passkeys and
            two-factor settings under Account.
          </p>
        </AuthHeading>
        <Link
          href="/sign-in"
          className={buttonVariants({ variant: "primary", className: "self-start" })}
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (outcome.kind === "taken") {
    return (
      <UnusableLink
        headingRef={headingRef}
        title="That address now belongs to another account"
        primary={{ href: "/sign-in", label: "Sign in" }}
      >
        <p>
          Another Brawzer account started using your previous address after the change, so it can’t
          be restored from this link. Sign in with your current address to review your account.
        </p>
      </UnusableLink>
    );
  }

  if (token === undefined) return <CheckingLink title="Undo an email change" />;

  if (token === null || outcome.kind === "expired") {
    return (
      <UnusableLink
        headingRef={headingRef}
        title={
          outcome.kind === "expired"
            ? "This link has expired or has already been used"
            : "This link isn’t complete"
        }
        primary={{ href: "/sign-in", label: "Sign in" }}
      >
        {outcome.kind === "expired" ? (
          <p>
            Undo links work once and expire after 7 days. If you can still sign in, change your
            email address and password under Account.
          </p>
        ) : (
          <p>
            Open the link from your email again. If you copied it, make sure you copied all of it.
          </p>
        )}
      </UnusableLink>
    );
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const parsed = undoEmailChangeRequestSchema.safeParse({
      token,
      password: new FormData(event.currentTarget).get("password"),
    });
    setFailure(null);
    if (!parsed.success) {
      setErrors(fieldErrorsFromIssues(parsed.error.issues));
      focusFirstInvalid(formRef.current);
      return;
    }

    setErrors({});
    setPending(true);
    const result = await undoEmailChange(parsed.data.token, parsed.data.password);
    setPending(false);
    if (result.ok) {
      forgetLinkToken();
      setOutcome({ kind: "done", email: result.data.email });
      return;
    }
    const { code, message, details } = result.error;
    if (code === "token_invalid") {
      forgetLinkToken();
      setOutcome({ kind: "expired" });
    } else if (code === "conflict") {
      forgetLinkToken();
      setOutcome({ kind: "taken" });
    } else if (code === "validation_failed") {
      setErrors(fieldErrorsFromDetails(details));
      focusFirstInvalid(formRef.current);
    } else {
      setFailure(message);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Undo an email change" headingRef={headingRef}>
        <p>
          Your account goes back to this email address. Whoever changed it had your password too, so
          choose a new one now. Every device is signed out.
        </p>
      </AuthHeading>

      <form
        method="post"
        ref={formRef}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-5"
      >
        {failure && <FormMessage tone="danger">{failure}</FormMessage>}

        <Field name="password" invalid={Boolean(errors.password)}>
          <FieldLabel>New password</FieldLabel>
          <PasswordInput name="password" autoComplete="new-password" required />
          <FieldDescription>
            At least 10 characters. A few unrelated words make a strong password.
          </FieldDescription>
          {errors.password && <FieldError match>{errors.password}</FieldError>}
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-1 w-full">
          Restore my address and set this password
        </Button>
      </form>
    </div>
  );
}
