"use client";

import { registerRequestSchema } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
} from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { PasswordInput } from "@brawzer/ui/components/password-input";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { register } from "@/lib/api/auth";
import { fieldErrorsFromDetails, fieldErrorsFromIssues } from "@/lib/api/client";
import { AuthHeading, DevMailboxHint, focusFirstInvalid, TextLink } from "./auth-ui";

export function CreateAccountForm() {
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
    const form = new FormData(event.currentTarget);
    const parsed = registerRequestSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    setFailure(null);
    if (!parsed.success) {
      setErrors(fieldErrorsFromIssues(parsed.error.issues));
      focusFirstInvalid(formRef.current);
      return;
    }

    setErrors({});
    setPending(true);
    const result = await register(parsed.data);
    setPending(false);
    if (result.ok) {
      setSentTo(parsed.data.email);
      return;
    }
    if (result.error.code === "validation_failed") {
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
            We’re sending an email to <strong className="font-semibold text-ink">{sentTo}</strong>.
            Open the link in it, then enter the password you just chose to finish creating your
            account.
          </p>
        </AuthHeading>
        <p className="text-callout text-ink-secondary">
          The link works once and expires in 24 hours. If nothing arrives in a few minutes, check
          your spam folder.
        </p>
        <DevMailboxHint />
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => {
            setSentTo(null);
          }}
        >
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Create your Brawzer account" headingRef={headingRef}>
        <p>One account for your cloud browser, profiles and Drive.</p>
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
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
          {errors.email && <FieldError match>{errors.email}</FieldError>}
        </Field>

        <Field name="password" invalid={Boolean(errors.password)}>
          <FieldLabel>Password</FieldLabel>
          <PasswordInput name="password" autoComplete="new-password" required />
          <FieldDescription>
            At least 10 characters. A few unrelated words make a strong password.
          </FieldDescription>
          {errors.password && <FieldError match>{errors.password}</FieldError>}
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-1 w-full">
          Create account
        </Button>
      </form>

      <p className="text-callout text-ink-secondary">
        Already have an account? <TextLink href="/sign-in">Sign in</TextLink>
      </p>
    </div>
  );
}
