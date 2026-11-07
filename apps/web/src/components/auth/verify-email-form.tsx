"use client";

import { verifyEmailRequestSchema } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { Field, FieldError, FieldLabel } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { PasswordInput } from "@brawzer/ui/components/password-input";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { verifyEmail } from "@/lib/api/auth";
import { fieldErrorsFromDetails, fieldErrorsFromIssues } from "@/lib/api/client";
import { forgetLinkToken, useLinkToken } from "@/lib/link-token";
import { AuthHeading, focusFirstInvalid, KeepSignedIn } from "./auth-ui";
import { CheckingLink, UnusableLink } from "./link-states";

export function VerifyEmailForm() {
  const token = useLinkToken();
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (expired) headingRef.current?.focus();
  }, [expired]);

  if (token === undefined) return <CheckingLink title="Confirm your email" />;

  if (token === null || expired) {
    return (
      <UnusableLink
        headingRef={headingRef}
        title={
          expired ? "This link has expired or has already been used" : "This link isn’t complete"
        }
        primary={{ href: "/sign-in", label: "Sign in" }}
        secondary={{ href: "/create-account", label: "Create an account" }}
      >
        {expired ? (
          <p>
            If you’ve already confirmed your email, sign in. If not, sign in with the email and
            password you chose and we’ll send you a new link.
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
    const form = new FormData(event.currentTarget);
    const parsed = verifyEmailRequestSchema.safeParse({
      token,
      password: form.get("password"),
      keepSignedIn,
    });
    setFailure(null);
    if (!parsed.success) {
      setErrors(fieldErrorsFromIssues(parsed.error.issues));
      focusFirstInvalid(formRef.current);
      return;
    }

    setErrors({});
    setPending(true);
    const result = await verifyEmail(parsed.data);
    if (result.ok) {
      forgetLinkToken();
      window.location.replace("/app");
      return;
    }

    setPending(false);
    const { code, message, details } = result.error;
    if (code === "token_invalid") {
      forgetLinkToken();
      setExpired(true);
    } else if (code === "invalid_credentials") {
      setErrors({ password: message });
      focusFirstInvalid(formRef.current);
    } else if (code === "validation_failed") {
      setErrors(fieldErrorsFromDetails(details));
      focusFirstInvalid(formRef.current);
    } else {
      setFailure(message);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Confirm your email" headingRef={headingRef}>
        <p>
          Enter the password you chose when you created your account. This proves the account is
          yours.
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
          <FieldLabel>Password</FieldLabel>
          <PasswordInput name="password" autoComplete="current-password" required />
          {errors.password && <FieldError match>{errors.password}</FieldError>}
        </Field>

        <KeepSignedIn checked={keepSignedIn} onCheckedChange={setKeepSignedIn} />

        <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-1 w-full">
          Confirm and sign in
        </Button>
      </form>
    </div>
  );
}
