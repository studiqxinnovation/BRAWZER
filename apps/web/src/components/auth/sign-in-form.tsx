"use client";

import { loginRequestSchema } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { Field, FieldError, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { PasswordInput } from "@brawzer/ui/components/password-input";
import { KeyRound } from "lucide-react";
import { type SubmitEvent, useRef, useState } from "react";
import { login } from "@/lib/api/auth";
import { signInOptions, verifySignIn } from "@/lib/api/passkeys";
import { requestPasskey, usePasskeysSupported } from "@/lib/passkeys";
import { fieldErrorsFromDetails, fieldErrorsFromIssues } from "@/lib/api/client";
import { safeNextPath } from "@/lib/redirect";
import { focusFirstInvalid, KeepSignedIn, TextLink } from "./auth-ui";
import { SecondStep } from "./second-step";

interface Notice {
  tone: "danger" | "info";
  title?: string;
  message: string;
}

export function SignInForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [pending, setPending] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const passkeysSupported = usePasskeysSupported();

  function goToNext() {
    // A full page load: the signed-in area renders on the server with the new cookie.
    window.location.replace(safeNextPath(new URLSearchParams(window.location.search).get("next")));
  }

  async function signInWithPasskey() {
    setNotice(null);
    setPasskeyPending(true);
    const options = await signInOptions();
    if (!options.ok) {
      setPasskeyPending(false);
      setNotice({ tone: "danger", message: options.error.message });
      return;
    }
    const ceremony = await requestPasskey(options.data.options);
    if (!ceremony.ok) {
      setPasskeyPending(false);
      if (!ceremony.cancelled) setNotice({ tone: "danger", message: ceremony.message });
      return;
    }
    const result = await verifySignIn({
      challengeId: options.data.challengeId,
      keepSignedIn,
      response: ceremony.response,
    });
    if (result.ok) {
      goToNext();
      return;
    }
    setPasskeyPending(false);
    setNotice({ tone: "danger", message: result.error.message });
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = loginRequestSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
      keepSignedIn,
    });
    setNotice(null);
    if (!parsed.success) {
      setErrors(fieldErrorsFromIssues(parsed.error.issues));
      focusFirstInvalid(formRef.current);
      return;
    }

    setErrors({});
    setPending(true);
    const result = await login(parsed.data);
    if (result.ok) {
      if ("mfaRequired" in result.data) {
        setPending(false);
        setTicket(result.data.ticket);
        return;
      }
      goToNext();
      return;
    }

    setPending(false);
    const { code, message, details } = result.error;
    if (code === "validation_failed") {
      setErrors(fieldErrorsFromDetails(details));
      focusFirstInvalid(formRef.current);
    } else if (code === "email_not_verified") {
      setNotice({ tone: "info", title: "Confirm your email first", message });
    } else {
      setNotice({ tone: "danger", message });
    }
  }

  if (ticket) {
    return (
      <SecondStep
        ticket={ticket}
        onSignedIn={goToNext}
        onRestart={(message) => {
          setTicket(null);
          setNotice({ tone: "danger", message });
        }}
      />
    );
  }

  return (
    <form
      method="post"
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
    >
      {notice && (
        <FormMessage tone={notice.tone} title={notice.title}>
          {notice.message}
        </FormMessage>
      )}

      {passkeysSupported && (
        <>
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            loading={passkeyPending}
            onClick={() => void signInWithPasskey()}
          >
            <KeyRound aria-hidden="true" />
            Sign in with a passkey
          </Button>
          <p className="flex items-center gap-3 text-footnote text-ink-secondary">
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
            or use your password
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
          </p>
        </>
      )}

      <p className="text-footnote text-ink-secondary">
        No Bluetooth on this computer?{" "}
        <TextLink href="/sign-in/phone">Sign in with your phone</TextLink> instead.
      </p>

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

      <Field name="password" invalid={Boolean(errors.password)}>
        <div className="flex items-baseline justify-between gap-4">
          <FieldLabel>Password</FieldLabel>
          <TextLink href="/forgot-password" className="text-footnote">
            Forgot password?
          </TextLink>
        </div>
        <PasswordInput name="password" autoComplete="current-password" required />
        {errors.password && <FieldError match>{errors.password}</FieldError>}
      </Field>

      <KeepSignedIn checked={keepSignedIn} onCheckedChange={setKeepSignedIn} />

      <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-1 w-full">
        Sign in
      </Button>
    </form>
  );
}
