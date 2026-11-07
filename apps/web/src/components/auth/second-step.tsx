"use client";

import { Button } from "@brawzer/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
} from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { type SubmitEvent, useRef, useState } from "react";
import { verifySecondStep } from "@/lib/api/mfa";
import { focusFirstInvalid } from "./auth-ui";

/**
 * The second sign-in step for accounts with two-factor authentication: a
 * code from the authenticator app, or one of the recovery codes.
 */
export function SecondStep({
  ticket,
  onSignedIn,
  onRestart,
}: {
  ticket: string;
  onSignedIn: () => void;
  onRestart: (message: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("code");
    const code = typeof value === "string" ? value.trim() : "";
    setFailure(null);
    if (!code) {
      setError(useRecoveryCode ? "Enter one of your recovery codes." : "Enter the 6-digit code.");
      focusFirstInvalid(formRef.current);
      return;
    }
    setError(null);
    setPending(true);
    const result = await verifySecondStep(ticket, code);
    if (result.ok) {
      onSignedIn();
      return;
    }
    setPending(false);
    if (result.status === 401) onRestart(result.error.message);
    else if (result.error.code === "validation_failed") {
      setError(
        useRecoveryCode
          ? "That recovery code isn’t right, or it was already used."
          : "That code isn’t right. Use the newest code from your app.",
      );
      focusFirstInvalid(formRef.current);
    } else setFailure(result.error.message);
  }

  return (
    <form
      method="post"
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
    >
      <FormMessage tone="info" title="One more step">
        Your account uses two-factor authentication.
      </FormMessage>
      {failure && <FormMessage tone="danger">{failure}</FormMessage>}
      <Field name="code" invalid={error !== null} key={useRecoveryCode ? "recovery" : "totp"}>
        <FieldLabel>{useRecoveryCode ? "Recovery code" : "Authentication code"}</FieldLabel>
        <Input
          name="code"
          inputMode={useRecoveryCode ? "text" : "numeric"}
          autoComplete={useRecoveryCode ? "off" : "one-time-code"}
          autoCapitalize="none"
          spellCheck={false}
          maxLength={useRecoveryCode ? 20 : 6}
          required
        />
        <FieldDescription>
          {useRecoveryCode
            ? "Each recovery code works once."
            : "The 6-digit code from your authenticator app."}
        </FieldDescription>
        {error && <FieldError match>{error}</FieldError>}
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
        Verify
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setUseRecoveryCode((current) => !current);
          setError(null);
        }}
      >
        {useRecoveryCode ? "Use the authenticator app instead" : "Use a recovery code instead"}
      </Button>
    </form>
  );
}
