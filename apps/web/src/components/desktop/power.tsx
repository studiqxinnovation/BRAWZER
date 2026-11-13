"use client";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@brawzer/ui/components/alert-dialog";
import { Button } from "@brawzer/ui/components/button";
import { Logo } from "@brawzer/ui/brand";
import { useEffect, useRef, useState } from "react";

export type PowerAction = "shut-down" | "restart";

/** As a Mac asks: the dialog goes ahead on its own after a minute. */
const AUTO_SECONDS = 60;

/**
 * Shut Down and Restart, as a computer asks before doing either. Shutting
 * down closes every window, ends the cloud browsers (as quitting them
 * would) and signs out; restarting closes the windows and starts Brawzer
 * again, the cloud browsers waiting where they were.
 */
export function PowerDialog({
  action,
  sessions,
  onOpenChange,
  onConfirm,
}: {
  action: PowerAction | null;
  /** Cloud browsers running now, which shutting down ends. */
  sessions: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (action: PowerAction) => void;
}) {
  const [left, setLeft] = useState(AUTO_SECONDS);
  const fired = useRef(false);
  useEffect(() => {
    if (!action) return;
    fired.current = false;
    const timer = setInterval(() => {
      setLeft((current) => current - 1);
    }, 1_000);
    return () => {
      clearInterval(timer);
      setLeft(AUTO_SECONDS);
    };
  }, [action]);
  useEffect(() => {
    if (action && left <= 0 && !fired.current) {
      fired.current = true;
      onConfirm(action);
    }
  }, [action, left, onConfirm]);
  const verb = action === "restart" ? "restart" : "shut down";
  return (
    <AlertDialog open={action !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>Are you sure you want to {verb} your computer now?</AlertDialogTitle>
        <AlertDialogDescription>
          {action === "restart"
            ? "Every window closes and Brawzer starts again. Your cloud browsers wait where they are."
            : sessions > 0
              ? `Every window closes, ${sessions === 1 ? "your cloud browser ends" : `your ${String(sessions)} cloud browsers end`} (a profile that keeps its data saves it) and you are signed out.`
              : "Every window closes and you are signed out. Nothing stays on this computer."}{" "}
          It will {verb} on its own in {String(Math.max(0, left))} second{left === 1 ? "" : "s"}.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant={action === "restart" ? "primary" : "danger"}
            onClick={() => {
              if (action) onConfirm(action);
            }}
          >
            {action === "restart" ? "Restart" : "Shut Down"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The black screen while it happens, as the start-up's is. */
export function PowerScreen({ action }: { action: PowerAction }) {
  return (
    <div className="dt-power" role="status" aria-live="polite" data-testid="power-screen">
      <Logo size={40} className="text-white" />
      <span className="dt-boot-bar">
        <i />
      </span>
      <span className="dt-power-text">
        {action === "restart" ? "Restarting…" : "Shutting down…"}
      </span>
    </div>
  );
}
