"use client";

import type { Passkey } from "@brawzer/contracts";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@brawzer/ui/components/alert-dialog";
import { Badge } from "@brawzer/ui/components/badge";
import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@brawzer/ui/components/dialog";
import { Field, FieldError, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { useToast } from "@brawzer/ui/components/toast";
import { KeyRound, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { LocalDate } from "@/components/local-date";
import {
  registrationOptions,
  removePasskey,
  renamePasskey,
  verifyRegistration,
} from "@/lib/api/passkeys";
import { createPasskey, usePasskeysSupported } from "@/lib/passkeys";
import { leaveSignedInArea } from "@/lib/session-channel";
import { timeAgo } from "@/lib/time";

function RenamePasskey({ passkey }: { passkey: Passkey }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("name");
    const name = typeof value === "string" ? value : "";
    setPending(true);
    const result = await renamePasskey(passkey.id, name);
    setPending(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      setError(result.error.details?.[0]?.replace(/^name: /, "") ?? result.error.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        Rename<span className="sr-only"> {passkey.name}</span>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Rename passkey</DialogTitle>
        <form noValidate onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
          <Field name="name" invalid={error !== null}>
            <FieldLabel>Name</FieldLabel>
            <Input name="name" defaultValue={passkey.name} maxLength={60} required />
            {error && <FieldError match>{error}</FieldError>}
          </Field>
          <DialogFooter className="mt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemovePasskey({ passkey }: { passkey: Passkey }) {
  const router = useRouter();
  const toast = useToast();
  const confirmed = useConfirmedRequest();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    const result = await confirmed(() => removePasskey(passkey.id));
    setPending(false);
    if (result.ok) {
      setOpen(false);
      toast.add({ type: "success", title: `Removed “${passkey.name}”` });
      router.refresh();
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      toast.add({
        type: "error",
        title: "Couldn’t remove the passkey",
        description: result.error.message,
      });
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        Remove<span className="sr-only"> {passkey.name}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Remove “{passkey.name}”?</AlertDialogTitle>
        <AlertDialogDescription>
          It won’t be able to sign in to Brawzer any more. The passkey itself stays on the device
          until you delete it there.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
          <Button variant="danger" loading={pending} onClick={() => void remove()}>
            Remove passkey
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The account's passkeys: add, rename, remove. */
export function PasskeysSection({
  passkeys,
  sharedComputer,
  renderedAt,
}: {
  passkeys: readonly Passkey[];
  sharedComputer: boolean;
  renderedAt: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirmed = useConfirmedRequest();
  const supported = usePasskeysSupported();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function add() {
    setFailure(null);
    setPending(true);
    const options = await confirmed(() => registrationOptions());
    if (!options.ok) {
      setPending(false);
      if (options.status === 401) leaveSignedInArea("expired");
      else if (options.error.code !== "reauthentication_required")
        setFailure(options.error.message);
      return;
    }
    const ceremony = await createPasskey(options.data.options);
    if (!ceremony.ok) {
      setPending(false);
      if (!ceremony.cancelled) setFailure(ceremony.message);
      return;
    }
    const saved = await confirmed(() =>
      verifyRegistration({ challengeId: options.data.challengeId, response: ceremony.response }),
    );
    setPending(false);
    if (saved.ok) {
      toast.add({
        type: "success",
        title: "Passkey added",
        description: `“${saved.data.name}” can now sign in.`,
      });
      router.refresh();
    } else if (saved.status === 401) {
      leaveSignedInArea("expired");
    } else {
      setFailure(saved.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-callout text-pretty text-ink-secondary">
        Sign in with your face, fingerprint, device PIN or a security key instead of a password. On
        a public computer, choose to use a phone and approve the sign-in there.
      </p>
      {sharedComputer && (
        <FormMessage tone="info">
          This is a shared-computer session, so a new passkey can only be saved on your phone or a
          security key, never on this computer.
        </FormMessage>
      )}
      {failure && <FormMessage tone="danger">{failure}</FormMessage>}

      {passkeys.length > 0 ? (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <KeyRound
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-ink-secondary"
                />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-callout font-medium text-ink">
                    <span className="break-words">{passkey.name}</span>
                    <Badge tone="neutral">{passkey.synced ? "Synced" : "This device only"}</Badge>
                  </p>
                  <p className="text-footnote text-ink-secondary">
                    Added <LocalDate iso={passkey.createdAt} /> ·{" "}
                    {passkey.lastUsedAt
                      ? `Last used ${timeAgo(passkey.lastUsedAt, renderedAt)}`
                      : "Not used yet"}
                  </p>
                </div>
              </div>
              <div className="flex gap-1 pl-7 sm:pl-0">
                <RenamePasskey passkey={passkey} />
                <RemovePasskey passkey={passkey} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-callout text-ink-secondary">No passkeys yet.</p>
      )}

      {supported ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={pending}
          onClick={() => void add()}
        >
          <Plus aria-hidden="true" />
          Add a passkey
        </Button>
      ) : (
        <p className="text-footnote text-ink-secondary">This browser doesn’t support passkeys.</p>
      )}
    </div>
  );
}
