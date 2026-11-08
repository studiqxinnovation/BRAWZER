"use client";

import type { PhoneSignInStart } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Spinner } from "@brawzer/ui/components/spinner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { pollPhoneSignIn, startPhoneSignIn } from "@/lib/api/phone";

const POLL_MS = 2_000;

type State =
  | { kind: "starting" }
  | { kind: "waiting"; request: PhoneSignInStart }
  | { kind: "approved" }
  | { kind: "over"; title: string; message: string }
  | { kind: "failed"; message: string };

/**
 * The computer's side of signing in with a phone: a QR code and a two-digit
 * number, polled until the phone answers. Nothing typed, nothing kept here.
 */
export function PhoneSignIn() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "starting" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void startPhoneSignIn().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({ kind: "failed", message: result.error.message });
        return;
      }
      const request = result.data;
      setState({ kind: "waiting", request });
      const poll = async () => {
        const answer = await pollPhoneSignIn(request.requestId, request.pollToken);
        if (cancelled) return;
        if (!answer.ok) {
          setState({ kind: "failed", message: answer.error.message });
          return;
        }
        switch (answer.data.state) {
          case "pending":
            timer = setTimeout(() => void poll(), POLL_MS);
            return;
          case "approved":
            setState({ kind: "approved" });
            router.replace("/app");
            return;
          case "denied":
            setState({
              kind: "over",
              title: "The sign-in was refused",
              message:
                "The phone said this wasn’t you, or the wrong number was chosen three times.",
            });
            return;
          case "expired":
            setState({
              kind: "over",
              title: "The code expired",
              message: "A code works for two minutes. Start again when your phone is ready.",
            });
        }
      };
      timer = setTimeout(() => void poll(), POLL_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [attempt, router]);

  if (state.kind === "starting") {
    return (
      <p className="flex items-center gap-2 text-callout text-ink-secondary" role="status">
        <Spinner className="size-4" /> Preparing a code…
      </p>
    );
  }
  if (state.kind === "approved") {
    return (
      <p className="flex items-center gap-2 text-callout text-ink-secondary" role="status">
        <Spinner className="size-4" /> Approved. Opening Brawzer…
      </p>
    );
  }
  if (state.kind === "failed" || state.kind === "over") {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage
          tone={state.kind === "failed" ? "danger" : "info"}
          title={state.kind === "failed" ? "That didn’t work" : state.title}
        >
          {state.message}
        </FormMessage>
        <Button
          variant="primary"
          onClick={() => {
            setState({ kind: "starting" });
            setAttempt((n) => n + 1);
          }}
        >
          Start again
        </Button>
      </div>
    );
  }
  const { request } = state;
  const qr = `data:image/svg+xml;base64,${btoa(request.qrSvg)}`;
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      {/* An SVG from the API as a data URL: nothing to optimise, and nothing fetched. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qr}
        alt="QR code to scan with your phone"
        width={208}
        height={208}
        className="rounded-lg border border-line bg-white p-2"
        data-approval-url={request.approvalUrl}
      />
      <div>
        <p className="text-footnote text-ink-secondary">Your phone will ask for this number</p>
        <p className="mt-1 font-mono text-[2.5rem] leading-none font-semibold tracking-wider text-ink">
          {request.code}
        </p>
      </div>
      <p className="flex items-center gap-2 text-footnote text-ink-tertiary" role="status">
        <Spinner className="size-3.5" /> Waiting for your phone…
      </p>
    </div>
  );
}
