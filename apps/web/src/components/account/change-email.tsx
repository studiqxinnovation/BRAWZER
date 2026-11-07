"use client";

import { changeEmailRequestSchema } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@brawzer/ui/components/dialog";
import { Field, FieldError, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { type SubmitEvent, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { requestEmailChange } from "@/lib/api/account";
import { fieldErrorsFromDetails, fieldErrorsFromIssues } from "@/lib/api/client";
import { leaveSignedInArea } from "@/lib/session-channel";

/** Asks for a new address; it changes only once the link sent there is opened. */
export function ChangeEmail({ currentEmail }: { currentEmail: string }) {
  const confirmed = useConfirmedRequest();
  const [open, setOpen] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSentTo(null);
      setError(null);
      setFailure(null);
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = changeEmailRequestSchema.safeParse({
      email: new FormData(event.currentTarget).get("email"),
    });
    setFailure(null);
    if (!parsed.success) {
      setError(fieldErrorsFromIssues(parsed.error.issues).email ?? "Enter an email address.");
      return;
    }
    if (parsed.data.email === currentEmail) {
      setError("That’s already your email address.");
      return;
    }

    setError(null);
    setPending(true);
    const result = await confirmed(() => requestEmailChange(parsed.data.email));
    setPending(false);
    if (result.ok) {
      setSentTo(parsed.data.email);
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else if (result.error.code === "validation_failed") {
      setError(fieldErrorsFromDetails(result.error.details).email ?? result.error.message);
    } else if (result.error.code !== "reauthentication_required") {
      setFailure(result.error.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="secondary" size="sm" />}>
        Change<span className="sr-only"> email address</span>
      </DialogTrigger>
      <DialogContent>
        {sentTo ? (
          <>
            <DialogTitle>Check your new inbox</DialogTitle>
            <DialogDescription>
              We’ve sent an email to{" "}
              <span className="font-medium break-all text-ink">{sentTo}</span>. To finish the
              change, open the link in it within 24 hours. Until then, Brawzer keeps using{" "}
              <span className="break-all">{currentEmail}</span>.
            </DialogDescription>
            <DialogFooter>
              <DialogClose render={<Button variant="primary" />}>Done</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogTitle>Change your email address</DialogTitle>
            <DialogDescription>
              We’ll send a link to the new address, and your address changes only when you open it.
              We’ll also tell <span className="break-all">{currentEmail}</span>.
            </DialogDescription>
            <form
              method="post"
              noValidate
              onSubmit={handleSubmit}
              className="mt-5 flex flex-col gap-4"
            >
              {failure && <FormMessage tone="danger">{failure}</FormMessage>}
              <Field name="email" invalid={error !== null}>
                <FieldLabel>New email address</FieldLabel>
                <Input name="email" type="email" inputMode="email" autoComplete="email" required />
                {error && <FieldError match>{error}</FieldError>}
              </Field>
              <DialogFooter className="mt-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    handleOpenChange(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={pending}>
                  Send link
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
