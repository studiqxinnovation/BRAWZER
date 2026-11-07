"use client";

import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { Field, FieldError, FieldLabel, Input } from "@brawzer/ui/components/field";
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
import { confirmationOptions, verifyConfirmation } from "@/lib/api/passkeys";
import { requestPasskey, usePasskeysSupported } from "@/lib/passkeys";
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
  const [codeError, setCodeError] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const passkeysSupported = usePasskeysSupported();

  async function confirmWithPasskey() {
    setFailure(null);
    setPasskeyPending(true);
    const options = await confirmationOptions();
    if (!options.ok) {
      setPasskeyPending(false);
      if (options.status === 401) leaveSignedInArea("expired");
      else setFailure(options.error.message);
      return;
    }
    const ceremony = await requestPasskey(options.data.options);
    if (!ceremony.ok) {
      setPasskeyPending(false);
      if (!ceremony.cancelled) setFailure(ceremony.message);
      return;
    }
    const result = await verifyConfirmation({
      challengeId: options.data.challengeId,
      response: ceremony.response,
    });
    setPasskeyPending(false);
    if (result.ok) finish(true);
    else if (result.status === 401) leaveSignedInArea("expired");
    else setFailure(result.error.message);
  }

  function finish(confirmed: boolean) {
    setError(null);
    setCodeError(null);
    setNeedsCode(false);
    setFailure(null);
    setPending(false);
    setPasskeyPending(false);
    onDone(confirmed);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    const code = form.get("code");
    if (typeof password !== "string" || password.length === 0) {
      setError("Enter your password.");
      return;
    }
    setPending(true);
    setError(null);
    setCodeError(null);
    setFailure(null);
    const result = await reauthenticate(
      password,
      typeof code === "string" && code ? code : undefined,
    );
    if (result.ok) {
      finish(true);
      return;
    }
    setPending(false);
    if (result.status === 401) leaveSignedInArea("expired");
    else if (result.error.code === "validation_failed") {
      const codeDetail = result.error.details?.find((detail) => detail.startsWith("code: "));
      if (codeDetail) {
        setNeedsCode(true);
        setCodeError(codeDetail.slice("code: ".length));
      } else setError("That isn’t your password.");
    } else setFailure(result.error.message);
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
          {passkeysSupported && (
            <Button
              variant="secondary"
              loading={passkeyPending}
              onClick={() => void confirmWithPasskey()}
            >
              Use a passkey instead
            </Button>
          )}
          {needsCode && (
            <Field name="code" invalid={codeError !== null}>
              <FieldLabel>Authentication code</FieldLabel>
              <Input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
              />
              {codeError && <FieldError match>{codeError}</FieldError>}
            </Field>
          )}
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
