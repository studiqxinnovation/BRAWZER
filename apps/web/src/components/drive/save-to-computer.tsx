"use client";

import type { DriveFile } from "@brawzer/contracts";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@brawzer/ui/components/alert-dialog";
import { Button } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { useToast } from "@brawzer/ui/components/toast";
import { useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { requestDownloadTicket } from "@/lib/api/drive";
import { shortName } from "@/lib/drive";
import { leaveSignedInArea } from "@/lib/session-channel";

/** Starts the browser's download of a single-use link, without leaving the page. */
function startDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * "Save to this computer": a deliberate act. The dialog says what it means,
 * the server asks the person to confirm it's them if their sign-in isn't
 * recent, and the download link works once, for a minute.
 */
export function SaveToComputerDialog({
  file,
  open,
  onOpenChange,
  sharedComputer,
}: {
  file: DriveFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sharedComputer: boolean;
}) {
  const confirmed = useConfirmedRequest();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setFailure(null);
    const result = await confirmed(() => requestDownloadTicket(file.id));
    setPending(false);
    if (!result.ok) {
      if (result.status === 401) leaveSignedInArea("expired");
      else if (result.error.code !== "reauthentication_required") setFailure(result.error.message);
      return;
    }
    startDownload(result.data.url);
    onOpenChange(false);
    toast.add({
      type: "success",
      title: `Saving “${shortName(file.name)}” to this computer`,
      description: sharedComputer
        ? "Delete it from this computer before you leave."
        : "Check the browser’s downloads.",
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFailure(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>Save “{shortName(file.name)}” to this computer?</AlertDialogTitle>
        <AlertDialogDescription>
          A copy leaves Drive and lands in this computer’s downloads. Brawzer records it in your
          security history.
        </AlertDialogDescription>
        <div className="mt-4 flex flex-col gap-3">
          {sharedComputer ? (
            <FormMessage tone="info" title="You’re on a shared computer">
              The file stays on this computer after you sign out, where the next person could open
              it. Preview it in Drive instead if you can, or delete the copy before you leave.
            </FormMessage>
          ) : (
            <p className="text-footnote text-ink-secondary">
              Files from sources you don’t trust are safer previewed in Drive: the scan lowers the
              risk, but no scanner catches everything.
            </p>
          )}
          {failure && <FormMessage tone="danger">{failure}</FormMessage>}
        </div>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
          <Button variant="primary" loading={pending} onClick={() => void save()}>
            Save to this computer
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
