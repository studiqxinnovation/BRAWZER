"use client";

import {
  browserSupportsWebAuthn,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/** False on the server and in browsers without WebAuthn; true after hydration where supported. */
export function usePasskeysSupported(): boolean {
  return useSyncExternalStore(subscribe, browserSupportsWebAuthn, () => false);
}

export type CeremonyResult<T> =
  { ok: true; response: T } | { ok: false; cancelled: boolean; message: string };

/** The person closed the browser's passkey dialog, or it timed out. */
function isCancellation(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")
  );
}

function failure(error: unknown): { ok: false; cancelled: boolean; message: string } {
  if (isCancellation(error)) return { ok: false, cancelled: true, message: "No passkey was used." };
  if (error instanceof Error && error.name === "InvalidStateError") {
    return {
      ok: false,
      cancelled: false,
      message: "This passkey is already saved to your account.",
    };
  }
  return { ok: false, cancelled: false, message: "The passkey couldn’t be used. Try again." };
}

/** Runs the browser's "create a passkey" dialog. */
export async function createPasskey(
  options: Record<string, unknown>,
): Promise<CeremonyResult<unknown>> {
  try {
    const response = await startRegistration({
      optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
    });
    return { ok: true, response };
  } catch (error) {
    return failure(error);
  }
}

/** Runs the browser's "use a passkey" dialog (including "use a phone" where available). */
export async function requestPasskey(
  options: Record<string, unknown>,
): Promise<CeremonyResult<unknown>> {
  try {
    const response = await startAuthentication({
      optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
    });
    return { ok: true, response };
  } catch (error) {
    return failure(error);
  }
}
