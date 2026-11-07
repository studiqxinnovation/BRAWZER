"use client";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@brawzer/ui/components/alert-dialog";
import { Button } from "@brawzer/ui/components/button";
import { useEffect, useMemo, useRef, useState } from "react";
import { checkSession, reportActivity, rotateSession } from "@/lib/api/account";
import { formatCountdown, idleSettings, idleState, nextServerCall } from "@/lib/idle";
import {
  broadcast,
  leaveSignedInArea,
  onSessionMessage,
  signInPathFor,
  signOut,
} from "@/lib/session-channel";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

interface SessionKeeperProps {
  /** "Keep me signed in" sessions have no idle sign-out on this side. */
  persistent: boolean;
  idleTimeoutMinutes: number;
}

/**
 * Keeps the signed-in page honest about its session:
 * - activity (in any Brawzer tab) is reported to the server, at most once a minute;
 * - the session token is rotated every 15 minutes of use;
 * - on a shared computer, 2 minutes of warning, then sign-out after inactivity;
 * - a session ended elsewhere (another device, another tab) clears this page
 *   within about 30 seconds, using a check that doesn't count as activity.
 */
export function SessionKeeper({ persistent, idleTimeoutMinutes }: SessionKeeperProps) {
  const settings = useMemo(() => idleSettings(idleTimeoutMinutes), [idleTimeoutMinutes]);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const clock = useRef<{
    lastActivity: number;
    lastReport: number;
    lastRotation: number;
    lastCheck: number;
    busy: boolean;
    warning: boolean;
    done: boolean;
  } | null>(null);

  useEffect(() => {
    const start = Date.now();
    const state = {
      lastActivity: start,
      lastReport: start,
      lastRotation: start,
      lastCheck: start,
      busy: false,
      warning: false,
      done: false,
    };
    clock.current = state;
    // Lets diagnostics and browser tests know idle tracking is running.
    document.documentElement.dataset.sessionKeeper = persistent ? "persistent" : "shared";

    let lastBroadcast = 0;
    const onActivity = () => {
      // While the warning shows, only "Stay signed in" counts.
      if (state.warning) return;
      const now = Date.now();
      state.lastActivity = now;
      if (now - lastBroadcast > 5_000) {
        lastBroadcast = now;
        broadcast({ type: "activity", at: now });
      }
    };

    const stopListening = onSessionMessage((message) => {
      if (message.type === "activity" && !state.warning) {
        state.lastActivity = Math.max(state.lastActivity, message.at);
      } else if (message.type === "reported") {
        state.lastReport = Math.max(state.lastReport, message.at);
      } else if (message.type === "signed-out") {
        state.done = true;
        window.location.replace(signInPathFor(message.reason, window.location.pathname));
      }
    });

    const tick = async () => {
      if (state.done) return;
      const now = Date.now();

      if (!persistent) {
        const idle = idleState(now, state.lastActivity, settings);
        if (idle.phase === "expired") {
          state.done = true;
          setRemainingMs(null);
          await signOut("idle");
          return;
        }
        state.warning = idle.phase === "warning";
        setRemainingMs(idle.phase === "warning" ? idle.remainingMs : null);
      }

      // Background tabs only watch the clock; the visible tab talks to the server.
      if (state.busy || document.visibilityState !== "visible") return;
      const call = nextServerCall({ now, ...state });
      if (call === "none") return;

      state.busy = true;
      const result =
        call === "rotate"
          ? await rotateSession()
          : call === "report"
            ? await reportActivity()
            : await checkSession();
      state.busy = false;
      state.lastCheck = now;

      if (!result.ok) {
        if (result.status === 401) {
          state.done = true;
          leaveSignedInArea("expired");
        }
        return; // Network trouble: try again on a later tick.
      }
      if (call === "rotate") state.lastRotation = now;
      if (call !== "check") {
        state.lastReport = now;
        broadcast({ type: "reported", at: now });
      }
    };

    const interval = window.setInterval(() => void tick(), 1_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, { passive: true, capture: true });
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      delete document.documentElement.dataset.sessionKeeper;
      window.clearInterval(interval);
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, { capture: true });
      }
      document.removeEventListener("visibilitychange", onVisibility);
      stopListening();
    };
  }, [persistent, settings]);

  async function staySignedIn() {
    const state = clock.current;
    if (!state) return;
    const now = Date.now();
    state.warning = false;
    state.lastActivity = now;
    setRemainingMs(null);
    broadcast({ type: "activity", at: now });
    const result = await rotateSession();
    if (result.ok) {
      state.lastReport = now;
      state.lastRotation = now;
      broadcast({ type: "reported", at: now });
    } else if (result.status === 401) {
      state.done = true;
      leaveSignedInArea("expired");
    }
  }

  return (
    <AlertDialog open={remainingMs !== null}>
      <AlertDialogContent>
        <AlertDialogTitle>Are you still there?</AlertDialogTitle>
        <AlertDialogDescription>
          There’s been no activity for a while. To protect your account on this computer, you’ll be
          signed out in{" "}
          <span className="font-semibold text-ink tabular-nums">
            {formatCountdown(remainingMs ?? 0)}
          </span>
          .
        </AlertDialogDescription>
        <AlertDialogFooter>
          <Button variant="secondary" onClick={() => void signOut("user")}>
            Sign out
          </Button>
          <Button variant="primary" onClick={() => void staySignedIn()}>
            Stay signed in
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
