"use client";

import type { MfaStatus, TotpSetupResponse } from "@brawzer/contracts";
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
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
} from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { useToast } from "@brawzer/ui/components/toast";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { LocalDate } from "@/components/local-date";
import type { ApiResult } from "@/lib/api/client";
import {
  confirmTotpSetup,
  regenerateRecoveryCodes,
  startTotpSetup,
  turnOffTotp,
} from "@/lib/api/mfa";
import { leaveSignedInArea } from "@/lib/session-channel";

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP", easier to type into an app. */
function groupKey(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

function RecoveryCodes({ codes, onDone }: { codes: readonly string[]; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <FormMessage tone="success" title="Save your recovery codes">
        Each code signs you in once if you lose your authenticator app. They won’t be shown again.
        Write them down or keep them in a password manager on your own device.
      </FormMessage>
      <ol
        aria-label="Recovery codes"
        className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-line bg-canvas-subtle p-4 font-mono text-callout text-ink sm:grid-cols-5"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <Button variant="primary" className="self-start" onClick={onDone}>
        I’ve saved my codes
      </Button>
    </div>
  );
}

function SetupPanel({
  setup,
  sharedComputer,
  onEnabled,
  onCancel,
}: {
  setup: TotpSetupResponse;
  sharedComputer: boolean;
  onEnabled: (codes: string[]) => void;
  onCancel: () => void;
}) {
  const confirmed = useConfirmedRequest();
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("code");
    const code = typeof value === "string" ? value.trim() : "";
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setError(null);
    setFailure(null);
    setPending(true);
    const result = await confirmed(() => confirmTotpSetup(code));
    setPending(false);
    if (result.ok) onEnabled(result.data.recoveryCodes);
    else if (result.status === 401) leaveSignedInArea("expired");
    else if (result.error.code === "validation_failed")
      setError("That code isn’t right. Use the newest code from your app.");
    else setFailure(result.error.message);
  }

  return (
    <div className="flex flex-col gap-5">
      {sharedComputer && (
        <FormMessage tone="info" title="Set this up on your own device if you can">
          Anyone who can see this QR code, in person or through a camera, could copy it.
        </FormMessage>
      )}
      {failure && <FormMessage tone="danger">{failure}</FormMessage>}
      <ol className="flex list-decimal flex-col gap-4 pl-5 text-callout text-ink-secondary">
        <li>
          Scan this QR code with an authenticator app (such as 1Password, Google Authenticator or
          Microsoft Authenticator).
          {/* An SVG inside an image can't run scripts; it's never inlined as HTML. */}
          <Image
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`}
            alt="QR code for your authenticator app"
            width={176}
            height={176}
            unoptimized
            className="mt-3 rounded-lg bg-white p-2"
          />
          <p className="mt-3">
            Can’t scan it? Type this key instead:{" "}
            <span className="font-mono text-ink" data-testid="totp-key">
              {groupKey(setup.secret)}
            </span>
          </p>
        </li>
        <li>
          Enter the 6-digit code the app shows.
          <form noValidate onSubmit={handleSubmit} className="mt-3 flex max-w-sm flex-col gap-4">
            <Field name="code" invalid={error !== null}>
              <FieldLabel>Authentication code</FieldLabel>
              <Input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
              />
              <FieldDescription>Codes change every 30 seconds.</FieldDescription>
              {error && <FieldError match>{error}</FieldError>}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={pending}>
                Turn on
              </Button>
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </form>
        </li>
      </ol>
    </div>
  );
}

/** Two-factor authentication: turn on with an authenticator app, recovery codes, turn off. */
export function TwoFactorSection({
  status,
  sharedComputer,
}: {
  status: MfaStatus;
  sharedComputer: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirmed = useConfirmedRequest();
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<"setup" | "codes" | "off" | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  function handleError(result: Extract<ApiResult<unknown>, { ok: false }>) {
    if (result.status === 401) leaveSignedInArea("expired");
    else if (result.error.code !== "reauthentication_required") setFailure(result.error.message);
  }

  async function beginSetup() {
    setFailure(null);
    setPending("setup");
    const result = await confirmed(() => startTotpSetup());
    setPending(null);
    if (result.ok) setSetup(result.data);
    else handleError(result);
  }

  async function newCodes() {
    setFailure(null);
    setPending("codes");
    const result = await confirmed(() => regenerateRecoveryCodes());
    setPending(null);
    if (result.ok) setCodes(result.data.recoveryCodes);
    else handleError(result);
  }

  async function turnOff() {
    setPending("off");
    const result = await confirmed(() => turnOffTotp());
    setPending(null);
    if (result.ok) {
      setConfirmOff(false);
      toast.add({ type: "success", title: "Two-factor authentication is off" });
      router.refresh();
    } else handleError(result);
  }

  if (codes) {
    return (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          setCodes(null);
          router.refresh();
        }}
      />
    );
  }

  if (setup) {
    return (
      <SetupPanel
        setup={setup}
        sharedComputer={sharedComputer}
        onCancel={() => {
          setSetup(null);
        }}
        onEnabled={(recoveryCodes) => {
          setSetup(null);
          setCodes(recoveryCodes);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-callout text-pretty text-ink-secondary">
        When you sign in with your password, also ask for a code from an authenticator app. Passkeys
        don’t need it: they’re already two factors in one.
      </p>
      {failure && <FormMessage tone="danger">{failure}</FormMessage>}
      {status.totpEnabled ? (
        <>
          <p className="flex flex-wrap items-center gap-2 text-callout text-ink">
            <Badge tone="success">On</Badge>
            {status.enabledAt && (
              <span className="text-ink-secondary">
                Since <LocalDate iso={status.enabledAt} /> ·{" "}
                {status.recoveryCodesRemaining === 1
                  ? "1 recovery code left"
                  : `${String(status.recoveryCodesRemaining)} recovery codes left`}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={pending === "codes"}
              onClick={() => void newCodes()}
            >
              Create new recovery codes
            </Button>
            <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
              <AlertDialogTrigger render={<Button variant="ghost" />}>Turn off</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>Turn off two-factor authentication?</AlertDialogTitle>
                <AlertDialogDescription>
                  Signing in with your password will no longer ask for a code. Your recovery codes
                  stop working.
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogClose render={<Button variant="secondary" />}>
                    Cancel
                  </AlertDialogClose>
                  <Button
                    variant="danger"
                    loading={pending === "off"}
                    onClick={() => void turnOff()}
                  >
                    Turn off
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </>
      ) : (
        <Button
          variant="secondary"
          className="self-start"
          loading={pending === "setup"}
          onClick={() => void beginSetup()}
        >
          Turn on two-factor authentication
        </Button>
      )}
    </div>
  );
}
