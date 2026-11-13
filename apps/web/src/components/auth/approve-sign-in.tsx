"use client";

import type { PhoneApproval } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Spinner } from "@brawzer/ui/components/spinner";
import { useEffect, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { Panel } from "@/components/app-shell/page";
import { approvePhoneSignIn, denyPhoneSignIn, describePhoneApproval } from "@/lib/api/phone";
import { leaveSignedInArea } from "@/lib/session-channel";

/**
 * The phone's side: where the request comes from, three numbers of which
 * one is on the computer, and a confirmation that it's the account's owner.
 */
export function ApproveSignIn({
  requestId,
  approvalKey,
}: {
  requestId: string;
  approvalKey: string;
}) {
  const confirmed = useConfirmedRequest();
  const [approval, setApproval] = useState<PhoneApproval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void describePhoneApproval(requestId, approvalKey).then((result) => {
      if (cancelled) return;
      if (result.ok) setApproval(result.data);
      else if (result.status === 401) leaveSignedInArea("expired");
      else setError(result.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [requestId, approvalKey]);

  async function choose(code: string) {
    setPending(code);
    setError(null);
    const result = await confirmed(() => approvePhoneSignIn(requestId, approvalKey, code));
    setPending(null);
    if (result.ok) {
      setApproval(result.data);
      setDone("approved");
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else if (result.error.code !== "reauthentication_required") {
      setError(result.error.message);
      if (result.status === 403 || result.status === 404) setDone("denied");
    }
  }

  async function deny() {
    setPending("deny");
    const result = await denyPhoneSignIn(requestId, approvalKey);
    setPending(null);
    if (result.ok) setDone("denied");
    else setError(result.error.message);
  }

  if (error && !approval) {
    return (
      <FormMessage tone="danger" title="This request can’t be approved">
        {error}
      </FormMessage>
    );
  }
  if (!approval) {
    return (
      <p className="flex items-center gap-2 text-callout text-ink-secondary" role="status">
        <Spinner className="size-4" /> Checking the request…
      </p>
    );
  }
  if (done === "approved" || approval.state === "approved") {
    return (
      <FormMessage tone="success" title="Signed in on the computer">
        It has a shared-computer session now, listed under Sessions. Sign it out from there when
        you’re done, or close its browser.
      </FormMessage>
    );
  }
  if (done === "denied" || approval.state !== "pending") {
    return (
      <FormMessage tone="info" title="Nothing was signed in">
        {approval.state === "expired"
          ? "The request expired."
          : "The request was refused. If you didn’t start it, someone else was at that computer."}
      </FormMessage>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <Panel className="p-5">
        <dl className="grid gap-2 text-callout">
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-ink-secondary">Computer</dt>
            <dd className="text-ink">{approval.device ?? "An unknown browser"}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-ink-secondary">Address</dt>
            <dd className="text-ink">{approval.ipAddress ?? "unknown"}</dd>
          </div>
        </dl>
      </Panel>
      <FormMessage tone="danger" title="Only approve a sign-in you started yourself">
        Someone can show you their code to get into your account. If this computer and address
        aren’t the ones in front of you, choose “This wasn’t me”.
      </FormMessage>
      {error && <FormMessage tone="danger">{error}</FormMessage>}
      <div>
        <p className="text-callout text-ink">Which number does the computer show?</p>
        <div
          className="mt-3 grid grid-cols-3 gap-3"
          role="group"
          aria-label="The number on the computer"
        >
          {approval.codes.map((code) => (
            <Button
              key={code}
              variant="secondary"
              size="lg"
              className="font-mono text-title-3"
              loading={pending === code}
              disabled={pending !== null}
              onClick={() => void choose(code)}
            >
              {code}
            </Button>
          ))}
        </div>
      </div>
      <Button
        variant="ghost"
        loading={pending === "deny"}
        disabled={pending !== null}
        onClick={() => void deny()}
      >
        This wasn’t me
      </Button>
    </div>
  );
}
