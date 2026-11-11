"use client";

import { BROWSER_LIMITS } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { Field, FieldError, FieldLabel } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { PasswordInput } from "@brawzer/ui/components/password-input";
import { ArrowRight, KeyRound, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CodeField, useIdentityCheck } from "@/components/app-shell/confirm-identity";
import { lockClock, subscribeToClock } from "@/lib/clock";
import { isLocked, markUnlocked, startLocked, subscribeToLock } from "@/lib/lock";
import { usePasskeysSupported } from "@/lib/passkeys";
import { signOut } from "@/lib/session-channel";
import "./lock-screen.css";

interface LockDetails {
  email: string;
  /** "Keep me signed in" sessions don't sign out after a short idle time. */
  persistent: boolean;
  idleTimeoutMinutes: number;
}

/**
 * What the lock screen shows: the time over the wallpaper, who is signed in,
 * and unlocking, which is confirming it's you (password, with the
 * authenticator's code if the account asks, or a passkey). The server holds
 * the lock; this only asks for the proof.
 */
function LockPanel({
  email,
  persistent,
  idleTimeoutMinutes,
  onUnlocked,
}: LockDetails & {
  onUnlocked: () => void;
}) {
  const titleId = useId();
  const check = useIdentityCheck(onUnlocked);
  const passkeys = usePasskeysSupported();
  const [time, date] = useSyncExternalStore(subscribeToClock, lockClock, () => "|").split("|");
  const [leaving, setLeaving] = useState(false);
  return (
    <div className="lk-screen" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="lk-clock" aria-hidden="true">
        <span className="lk-time">{time}</span>
        <span className="lk-date">{date}</span>
      </div>
      <form
        method="post"
        noValidate
        onSubmit={(event) => void check.submit(event)}
        className="lk-card"
      >
        <span className="lk-avatar" aria-hidden="true">
          {email.slice(0, 1).toUpperCase()}
        </span>
        <h1 id={titleId} className="lk-title">
          Brawzer is locked
        </h1>
        <p className="lk-email">{email}</p>
        {check.failure && <FormMessage tone="danger">{check.failure}</FormMessage>}
        <Field name="password" invalid={check.error !== null} className="w-full">
          <FieldLabel className="sr-only">Password</FieldLabel>
          <div className="lk-row">
            <PasswordInput
              name="password"
              autoComplete="current-password"
              placeholder="Password"
              required
              // The lock screen is there to type the password into.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
            <Button
              type="submit"
              variant="primary"
              size="icon"
              aria-label="Unlock"
              loading={check.pending}
            >
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
          {check.error && <FieldError match>{check.error}</FieldError>}
        </Field>
        {check.needsCode && <CodeField error={check.codeError} />}
        {passkeys && (
          <Button
            variant="secondary"
            className="w-full"
            loading={check.passkeyPending}
            onClick={() => void check.withPasskey()}
          >
            <KeyRound aria-hidden="true" />
            Unlock with a passkey
          </Button>
        )}
        <p className="lk-note">
          {`Your cloud browsers wait while it’s locked, for up to ${String(BROWSER_LIMITS.idleMinutes)} minutes.`}
          {!persistent &&
            ` On a shared computer Brawzer still signs out after ${String(idleTimeoutMinutes)} minutes without use.`}
        </p>
        <Button
          variant="ghost"
          size="sm"
          loading={leaving}
          onClick={() => {
            setLeaving(true);
            void signOut("user").then((result) => {
              if (!result.ok) setLeaving(false);
            });
          }}
        >
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </form>
    </div>
  );
}

/**
 * The lock screen over the open app (locked from the desktop): everything
 * behind it is inert, the browsers' streams stop, and unlocking brings the
 * page back as it was, its data read again.
 */
export function LockScreen(details: LockDetails) {
  const router = useRouter();
  const locked = useSyncExternalStore(subscribeToLock, isLocked, () => false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Nothing behind the lock screen can be reached, by pointer or keyboard.
  useEffect(() => {
    if (!locked) return;
    const root = rootRef.current;
    const behind = [...document.body.children].filter(
      (element) => element !== root && !element.hasAttribute("inert"),
    );
    for (const element of behind) element.setAttribute("inert", "");
    return () => {
      for (const element of behind) element.removeAttribute("inert");
    };
  }, [locked]);

  if (!locked) return null;
  return createPortal(
    <div ref={rootRef} className="lk-root">
      <LockPanel
        {...details}
        onUnlocked={() => {
          markUnlocked();
          router.refresh();
        }}
      />
    </div>,
    document.body,
  );
}

/**
 * A page loaded while the sign-in is locked: only the lock screen (the
 * server answers nothing else). Unlocking loads the page again.
 */
export function LockedPage(details: LockDetails) {
  useEffect(() => {
    startLocked();
  }, []);
  return (
    <div className="lk-root">
      <LockPanel
        {...details}
        onUnlocked={() => {
          markUnlocked();
          window.location.reload();
        }}
      />
    </div>
  );
}
