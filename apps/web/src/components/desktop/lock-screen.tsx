"use client";

import { BROWSER_LIMITS } from "@brawzer/contracts";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useIdentityCheck } from "@/components/app-shell/confirm-identity";
import { lockClock, subscribeToClock } from "@/lib/clock";
import { isLocked, lockNow, markUnlocked, startLocked, subscribeToLock } from "@/lib/lock";
import { usePasskeysSupported } from "@/lib/passkeys";
import { signOut } from "@/lib/session-channel";
import { StarField } from "@/components/auth/star-field";
import "./lock-screen.css";

interface LockDetails {
  email: string;
  /** "Keep me signed in" sessions don't sign out after a short idle time. */
  persistent: boolean;
  idleTimeoutMinutes: number;
}

/**
 * What the lock screen shows, as the prototype draws it: the time over the
 * blurred desktop, who is signed in, and a password to unlock (with the
 * authenticator's code when the account asks for one, or a passkey). The
 * server holds the lock; this only asks for the proof. "Wipe and sign out"
 * is the way out without the password.
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
  const problem = check.failure ?? check.error ?? check.codeError;
  return (
    <div className="lk-screen" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <h1 id={titleId} className="sr-only">
        Brawzer is locked
      </h1>
      <div className="lk-clock" aria-hidden="true">
        <span className="lk-time">{time}</span>
        <span className="lk-date">{date}</span>
      </div>
      <form
        method="post"
        noValidate
        onSubmit={(event) => void check.submit(event)}
        className="lk-me"
      >
        <span className="lk-avatar" aria-hidden="true">
          {email.slice(0, 1).toUpperCase()}
        </span>
        <p className="lk-name">{email}</p>
        <div className="lk-row">
          <label className="sr-only" htmlFor={`${titleId}-password`}>
            Password
          </label>
          <input
            id={`${titleId}-password`}
            className="lk-input"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter password"
            aria-invalid={check.error !== null || undefined}
            // The lock screen is there to type the password into.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <button type="submit" className="lk-go" aria-label="Unlock" disabled={check.pending}>
            {check.pending ? (
              <span className="lk-spin" aria-hidden="true" />
            ) : (
              <ArrowRight aria-hidden="true" />
            )}
          </button>
        </div>
        {check.needsCode && (
          <div className="lk-row">
            <label className="sr-only" htmlFor={`${titleId}-code`}>
              Authentication code
            </label>
            <input
              id={`${titleId}-code`}
              className="lk-input"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="Authentication code"
            />
          </div>
        )}
        <p
          className="lk-hint"
          role={problem ? "alert" : undefined}
          data-problem={problem ? true : undefined}
        >
          {problem ??
            `Your cloud browsers wait while it’s locked, for up to ${String(BROWSER_LIMITS.idleMinutes)} minutes.${
              persistent
                ? ""
                : ` Brawzer signs out after ${String(idleTimeoutMinutes)} minutes without use.`
            }`}
        </p>
        {passkeys && (
          <button
            type="button"
            className="lk-link"
            disabled={check.passkeyPending}
            onClick={() => void check.withPasskey()}
          >
            {check.passkeyPending ? "Waiting for your passkey…" : "Unlock with a passkey"}
          </button>
        )}
      </form>
      <div className="lk-foot">
        <button
          type="button"
          className="lk-link"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            void signOut("user").then((result) => {
              if (!result.ok) setLeaving(false);
            });
          }}
        >
          {leaving ? "Signing out…" : "Forgot your password? Wipe and sign out"}
        </button>
        <p>Your computer in the cloud. Nothing is saved on this device.</p>
      </div>
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

  // ⌘⇧L or Ctrl+Shift+L locks, as on the prototype.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        if (!isLocked()) void lockNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

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
      <StarField className="lk-sky" earth />
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
    <div className="lk-root" data-standalone="true">
      <StarField className="lk-sky" earth />
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
