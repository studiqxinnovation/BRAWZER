"use client";

import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { PasswordInput } from "@brawzer/ui/components/password-input";
import {
  createContext,
  type ReactNode,
  type SubmitEvent,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { reauthenticate } from "@/lib/api/account";
import type { ApiResult } from "@/lib/api/client";
import { leaveSignedInArea } from "@/lib/session-channel";

type Confirm = () => Promise<boolean>;

const ConfirmIdentityContext = createContext<Confirm | null>(null);

function ConfirmIdentityDialog({
  open,
  onDone,
}: {
  open: boolean;
  onDone: (confirmed: boolean) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function finish(confirmed: boolean) {
    setError(null);
    setFailure(null);
    setPending(false);
    onDone(confirmed);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    if (typeof password !== "string" || password.length === 0) {
      setError("Enter your password.");
      return;
    }
    setPending(true);
    setError(null);
    setFailure(null);
    const result = await reauthenticate(password);
    if (result.ok) {
      finish(true);
      return;
    }
    setPending(false);
    if (result.status === 401) leaveSignedInArea("expired");
    else if (result.error.code === "validation_failed") setError("That isn’t your password.");
    else setFailure(result.error.message);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish(false);
      }}
    >
      <DialogContent>
        <DialogTitle>Confirm it’s you</DialogTitle>
        <DialogDescription>
          This change protects your account, so Brawzer checks it’s really you first.
        </DialogDescription>
        <form ref={formRef} noValidate onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
          {failure && <FormMessage tone="danger">{failure}</FormMessage>}
          <Field name="password" invalid={error !== null}>
            <FieldLabel>Password</FieldLabel>
            <PasswordInput name="password" autoComplete="current-password" required />
            {error && <FieldError match>{error}</FieldError>}
          </Field>
          <DialogFooter className="mt-2">
            <Button
              variant="secondary"
              onClick={() => {
                finish(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Lets sensitive actions in the signed-in app ask the person to confirm it's them. */
export function ConfirmIdentityProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<((confirmed: boolean) => void) | null>(null);
  const confirm = useCallback<Confirm>(
    () =>
      new Promise<boolean>((resolve) => {
        setPending(() => resolve);
      }),
    [],
  );

  return (
    <ConfirmIdentityContext value={confirm}>
      {children}
      <ConfirmIdentityDialog
        open={pending !== null}
        onDone={(confirmed) => {
          pending?.(confirmed);
          setPending(null);
        }}
      />
    </ConfirmIdentityContext>
  );
}

/**
 * Runs an API request. If the server asks the person to confirm it's them
 * (`reauthentication_required`), shows the dialog and retries once.
 */
export function useConfirmedRequest() {
  const confirm = useContext(ConfirmIdentityContext);
  return useCallback(
    async <T,>(request: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
      const first = await request();
      if (first.ok || first.error.code !== "reauthentication_required" || !confirm) return first;
      return (await confirm()) ? request() : first;
    },
    [confirm],
  );
}
