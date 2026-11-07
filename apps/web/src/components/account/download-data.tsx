"use client";

import { Button } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Download } from "lucide-react";
import { useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { exportAccount } from "@/lib/api/account";
import { leaveSignedInArea } from "@/lib/session-channel";

/** Saves everything Brawzer holds about the account (never secrets) as a JSON file. */
export function DownloadData({ sharedComputer }: { sharedComputer: boolean }) {
  const confirmed = useConfirmedRequest();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function download() {
    setFailure(null);
    setPending(true);
    const result = await confirmed(() => exportAccount());
    setPending(false);
    if (!result.ok) {
      if (result.status === 401) leaveSignedInArea("expired");
      else if (result.error.code !== "reauthentication_required") setFailure(result.error.message);
      return;
    }
    const file = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `brawzer-account-${result.data.exportedAt.slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    // Revoked on the next tick, once the browser has started the download.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-callout text-pretty text-ink-secondary">
        A copy of your account details, signed-in devices, passkey names and security history, as a
        JSON file. It never includes your password, codes or any other secret.
      </p>
      {sharedComputer ? (
        <FormMessage tone="info" title="You’re on a shared computer">
          The file stays in this computer’s downloads, where the next person could open it. Download
          it on your own device if you can, or delete it before you leave.
        </FormMessage>
      ) : (
        <p className="text-footnote text-ink-secondary">
          The file is saved to this computer. Delete it when you no longer need it.
        </p>
      )}
      {failure && <FormMessage tone="danger">{failure}</FormMessage>}
      <Button
        variant="secondary"
        loading={pending}
        className="self-start"
        onClick={() => void download()}
      >
        <Download aria-hidden="true" />
        Download your data
      </Button>
    </div>
  );
}
