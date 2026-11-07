"use client";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@brawzer/ui/components/alert-dialog";
import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { endOtherSessions, endSession } from "@/lib/api/account";
import { leaveSignedInArea } from "@/lib/session-channel";

const devicesLabel = (count: number) => (count === 1 ? "1 device" : `${String(count)} devices`);

/** Signs out one other device. The accessible name includes the device. */
export function EndSessionButton({ id, device }: { id: string; device: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function end() {
    setPending(true);
    const result = await endSession(id);
    if (!result.ok && result.status === 401) {
      leaveSignedInArea("expired");
      return;
    }
    setPending(false);
    if (result.ok || result.status === 404) {
      toast.add({
        type: "success",
        title: result.ok ? `Signed out ${device}` : "That session had already ended",
      });
      router.refresh();
    } else {
      toast.add({
        type: "error",
        title: "Couldn’t sign out that device",
        description: result.error.message,
      });
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={pending} onClick={() => void end()}>
      Sign out<span className="sr-only"> {device}</span>
    </Button>
  );
}

/** Signs out every device except this one, after confirming. */
export function EndOtherSessionsButton({ count }: { count: number }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    const result = await endOtherSessions();
    if (!result.ok && result.status === 401) {
      leaveSignedInArea("expired");
      return;
    }
    setPending(false);
    if (!result.ok) {
      toast.add({
        type: "error",
        title: "Couldn’t sign out your other devices",
        description: result.error.message,
      });
      return;
    }
    setOpen(false);
    toast.add({ type: "success", title: `Signed out ${devicesLabel(result.data.revoked)}` });
    router.refresh();
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="secondary" />}>
        Sign out all other devices
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Sign out {devicesLabel(count)}?</AlertDialogTitle>
        <AlertDialogDescription>
          {count === 1 ? "It" : "They"} will need your password to sign in again. This device stays
          signed in.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
          <Button variant="danger" loading={pending} onClick={() => void confirm()}>
            Sign out {devicesLabel(count)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
