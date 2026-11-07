"use client";

import { resetPasswordRequestSchema } from "@brawzer/contracts";
import { Button, buttonVariants } from "@brawzer/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { PasswordInput } from "@brawzer/ui/components/password-input";
import Link from "next/link";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { resetPassword } from "@/lib/api/auth";
import { fieldErrorsFromDetails, fieldErrorsFromIssues } from "@/lib/api/client";
import { forgetLinkToken, useLinkToken } from "@/lib/link-token";
import { AuthHeading, focusFirstInvalid } from "./auth-ui";
import { CheckingLink, UnusableLink } from "./link-states";

type Outcome = "form" | "changed" | "expired";

export function ResetPasswordForm() {
  const token = useLinkToken();
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("form");

  useEffect(() => {
    if (outcome !== "form") headingRef.current?.focus();
  }, [outcome]);

  if (outcome === "changed") {
    return (
      <div className="flex flex-col gap-6">
        <AuthHeading title="Password changed" headingRef={headingRef}>
          <p>
            You’ve been signed out on every device, including any shared computers you forgot to
            sign out of. Sign in with your new password.
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

  if (token === undefined) return <CheckingLink title="Choose a new password" />;

  if (token === null || outcome === "expired") {
    return (
      <UnusableLink
        headingRef={headingRef}
        title={
          outcome === "expired"
            ? "This link has expired or has already been used"
            : "This link isn’t complete"
        }
        primary={{ href: "/forgot-password", label: "Request a new link" }}
        secondary={{ href: "/sign-in", label: "Sign in" }}
      >
        {outcome === "expired" ? (
          <p>Reset links work once and expire after 30 minutes. Request a new one to continue.</p>
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
    const parsed = resetPasswordRequestSchema.safeParse({
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
    const result = await resetPassword(parsed.data);
    setPending(false);
    if (result.ok) {
      forgetLinkToken();
      setOutcome("changed");
      return;
    }
    const { code, message, details } = result.error;
    if (code === "token_invalid") {
      forgetLinkToken();
      setOutcome("expired");
    } else if (code === "validation_failed") {
      setErrors(fieldErrorsFromDetails(details));
      focusFirstInvalid(formRef.current);
    } else {
      setFailure(message);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Choose a new password" headingRef={headingRef}>
        <p>Changing your password signs you out on every device.</p>
      </AuthHeading>

      <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
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
          Change password
        </Button>
      </form>
    </div>
  );
}
