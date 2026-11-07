"use client";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@brawzer/ui/components/alert-dialog";
import { Button } from "@brawzer/ui/components/button";
import { Field, FieldError, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { type SubmitEvent, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { deleteAccount } from "@/lib/api/account";
import { leaveSignedInArea } from "@/lib/session-channel";

const MISMATCH = "Type your email address exactly as it is shown.";

/** Deletes the account at once. Typing the address makes it a deliberate act. */
export function DeleteAccount({ email }: { email: string }) {
  const confirmed = useConfirmedRequest();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(null);
      setFailure(null);
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("email");
    const typed = typeof value === "string" ? value.trim().toLowerCase() : "";
    setFailure(null);
    if (typed !== email) {
      setError(MISMATCH);
      return;
    }

    setError(null);
    setPending(true);
    const result = await confirmed(() => deleteAccount(typed));
    if (result.ok) {
      leaveSignedInArea("deleted");
      return;
    }
    setPending(false);
    if (result.status === 401) {
      leaveSignedInArea("expired");
    } else if (result.error.code === "validation_failed") {
      setError(MISMATCH);
    } else if (result.error.code !== "reauthentication_required") {
      setFailure(result.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-callout text-pretty text-ink-secondary">
        Deleting your account removes it and everything stored with it straight away: passkeys,
        two-factor settings, security history and every signed-in session. It can’t be undone.
      </p>
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogTrigger render={<Button variant="danger" className="self-start" />}>
          Delete account…
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Delete your Brawzer account?</AlertDialogTitle>
          <AlertDialogDescription>
            Your account and everything stored with it are deleted immediately, and every device is
            signed out. This can’t be undone.
          </AlertDialogDescription>
          <form
            method="post"
            noValidate
            onSubmit={handleSubmit}
            className="mt-5 flex flex-col gap-4"
          >
            {failure && <FormMessage tone="danger">{failure}</FormMessage>}
            <Field name="email" invalid={error !== null}>
              <FieldLabel>
                Type <span className="font-medium break-all">{email}</span> to confirm
              </FieldLabel>
              <Input
                name="email"
                type="email"
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
                required
              />
              {error && <FieldError match>{error}</FieldError>}
            </Field>
            <AlertDialogFooter className="mt-2">
              <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
              <Button type="submit" variant="danger" loading={pending}>
                Delete account
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
