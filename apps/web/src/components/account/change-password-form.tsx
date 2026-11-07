"use client";

import { changePasswordRequestSchema } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { PasswordInput } from "@brawzer/ui/components/password-input";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useRef, useState } from "react";
import { focusFirstInvalid } from "@/components/auth/auth-ui";
import { changePassword } from "@/lib/api/account";
import { fieldErrorsFromDetails, fieldErrorsFromIssues } from "@/lib/api/client";
import { leaveSignedInArea } from "@/lib/session-channel";

/** Changes the password; the API signs out every other device. */
export function ChangePasswordForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ tone: "success" | "danger"; message: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = changePasswordRequestSchema.safeParse({
      currentPassword: data.get("currentPassword"),
      newPassword: data.get("newPassword"),
    });
    setResult(null);
    if (!parsed.success) {
      setErrors(fieldErrorsFromIssues(parsed.error.issues));
      focusFirstInvalid(formRef.current);
      return;
    }

    setErrors({});
    setPending(true);
    const response = await changePassword(parsed.data);
    setPending(false);
    if (response.ok) {
      form.reset();
      setResult({ tone: "success", message: response.data.message });
      // The session token was rotated; refresh server-rendered data with it.
      router.refresh();
      return;
    }
    const { code, message, details } = response.error;
    if (response.status === 401) {
      leaveSignedInArea("expired");
    } else if (code === "validation_failed") {
      setErrors(fieldErrorsFromDetails(details));
      focusFirstInvalid(formRef.current);
    } else {
      setResult({ tone: "danger", message });
    }
  }

  return (
    <form
      method="post"
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      className="flex max-w-sm flex-col gap-5"
    >
      {result && <FormMessage tone={result.tone}>{result.message}</FormMessage>}

      <Field name="currentPassword" invalid={Boolean(errors.currentPassword)}>
        <FieldLabel>Current password</FieldLabel>
        <PasswordInput name="currentPassword" autoComplete="current-password" required />
        {errors.currentPassword && <FieldError match>{errors.currentPassword}</FieldError>}
      </Field>

      <Field name="newPassword" invalid={Boolean(errors.newPassword)}>
        <FieldLabel>New password</FieldLabel>
        <PasswordInput name="newPassword" autoComplete="new-password" required />
        <FieldDescription>
          At least 10 characters. Changing it signs out every other device.
        </FieldDescription>
        {errors.newPassword && <FieldError match>{errors.newPassword}</FieldError>}
      </Field>

      <Button type="submit" variant="primary" loading={pending} className="self-start">
        Change password
      </Button>
    </form>
  );
}
