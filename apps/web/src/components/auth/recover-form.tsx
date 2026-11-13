"use client";

import { emailRequestSchema } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { Field, FieldError, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { fieldErrorsFromDetails, fieldErrorsFromIssues } from "@/lib/api/client";
import { startRecovery } from "@/lib/api/recovery";
import { AuthHeading, DevMailboxHint, focusFirstInvalid, TextLink } from "./auth-ui";

/**
 * Account recovery: for someone who lost every way in (passkey, authenticator,
 * recovery codes). It starts with an email, then a 48-hour wait that the real
 * owner can cancel, then Brawzer's team releases the account.
 */
export function RecoverForm() {
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
    const result = await startRecovery(parsed.data.email);
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
            confirm the recovery. The link works once and expires in 24 hours.
          </p>
          <p>
            After you confirm there is a 48-hour wait, which you can cancel from the next email if
            it wasn’t you. Then Brawzer’s team checks the request and releases the account.
          </p>
        </AuthHeading>
        <DevMailboxHint />
        <p className="text-callout text-ink-secondary">
          Found your passkey? <TextLink href="/sign-in">Back to sign in</TextLink>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Recover your account" headingRef={headingRef}>
        <p>
          For when you’ve lost every way in: your passkey, your authenticator and your recovery
          codes. If you only forgot your password,{" "}
          <TextLink href="/forgot-password">reset it instead</TextLink>.
        </p>
        <p>
          Recovery takes at least 48 hours and ends with the lost sign-in methods removed and a link
          to choose a new password. Your files and settings stay as they are.
        </p>
      </AuthHeading>

      <form
        method="post"
        ref={formRef}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-5"
      >
        <Field name="email" invalid={Boolean(errors.email)}>
          <FieldLabel>Email</FieldLabel>
          <Input type="email" name="email" autoComplete="email" inputMode="email" required />
          {errors.email && <FieldError match>{errors.email}</FieldError>}
        </Field>
        {failure && <FormMessage tone="danger">{failure}</FormMessage>}
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Email me a confirmation link"}
        </Button>
      </form>
      <p className="text-callout text-ink-secondary">
        <TextLink href="/sign-in">Back to sign in</TextLink>
      </p>
    </div>
  );
}
