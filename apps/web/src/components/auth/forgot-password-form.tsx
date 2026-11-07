"use client";

import { emailRequestSchema } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { Field, FieldError, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { requestPasswordReset } from "@/lib/api/auth";
import { fieldErrorsFromDetails, fieldErrorsFromIssues } from "@/lib/api/client";
import { AuthHeading, DevMailboxHint, focusFirstInvalid, TextLink } from "./auth-ui";

export function ForgotPasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (sentTo) headingRef.current?.focus();
  }, [sentTo]);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = emailRequestSchema.safeParse({
      email: new FormData(event.currentTarget).get("email"),
    });
    setFailure(null);
    if (!parsed.success) {
      setErrors(fieldErrorsFromIssues(parsed.error.issues));
      focusFirstInvalid(formRef.current);
      return;
    }

    setErrors({});
    setPending(true);
    const result = await requestPasswordReset(parsed.data.email);
    setPending(false);
    if (result.ok) {
      setSentTo(parsed.data.email);
    } else if (result.error.code === "validation_failed") {
      setErrors(fieldErrorsFromDetails(result.error.details));
      focusFirstInvalid(formRef.current);
    } else {
      setFailure(result.error.message);
    }
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-6">
        <AuthHeading title="Check your email" headingRef={headingRef}>
          <p>
            If there’s a Brawzer account for{" "}
            <strong className="font-semibold text-ink">{sentTo}</strong>, we’ve sent it a link to
            choose a new password. The link works once and expires in 30 minutes.
          </p>
        </AuthHeading>
        <DevMailboxHint />
        <p className="text-callout text-ink-secondary">
          Remembered it? <TextLink href="/sign-in">Back to sign in</TextLink>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Reset your password" headingRef={headingRef}>
        <p>Enter the email address for your Brawzer account and we’ll email you a link.</p>
      </AuthHeading>

      <form
        method="post"
        ref={formRef}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-5"
      >
        {failure && <FormMessage tone="danger">{failure}</FormMessage>}

        <Field name="email" invalid={Boolean(errors.email)}>
          <FieldLabel>Email</FieldLabel>
          <Input
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
          {errors.email && <FieldError match>{errors.email}</FieldError>}
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-1 w-full">
          Send reset link
        </Button>
      </form>

      <p className="text-callout text-ink-secondary">
        Remembered it? <TextLink href="/sign-in">Back to sign in</TextLink>
      </p>
    </div>
  );
}
