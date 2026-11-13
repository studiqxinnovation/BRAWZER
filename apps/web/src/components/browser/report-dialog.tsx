"use client";

import {
  MAX_REPORT_MESSAGE_CHARS,
  MAX_REPORT_PICTURE_BYTES,
  type PageReportKind,
  REPORT_PICTURE_DAYS,
} from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { Checkbox } from "@brawzer/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { inputClassName } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Select } from "@brawzer/ui/components/select";
import { useToast } from "@brawzer/ui/components/toast";
import { cn } from "@brawzer/ui/lib/cn";
import { type SubmitEvent, useEffect, useId, useState } from "react";
import { sendPageReport } from "@/lib/api/reports";
import { displayUrl } from "@/lib/browser/input";
import { base64Of, fittingJpeg } from "@/lib/browser/picture";
import { leaveSignedInArea } from "@/lib/session-channel";

/** The page a report is about, as the tab shows it. */
export interface ReportTarget {
  sessionId: string;
  url: string | null;
  title: string | null;
  errorCode: string | null;
}

const KINDS: readonly { value: PageReportKind; label: string }[] = [
  { value: "broken", label: "The page doesn’t work properly" },
  { value: "blocked", label: "Brawzer blocked something it shouldn’t have" },
  { value: "other", label: "Something else" },
];

/**
 * Report a page to Brawzer's administrators (Phase 8, idea 12). Nothing is
 * taken unless the person includes it: the address is ticked and can be
 * left out; a picture is made only when they tick for one, and they see it
 * before it is sent.
 */
export function ReportPageDialog({
  target,
  canvas,
  onClose,
}: {
  /** Null: closed. */
  target: ReportTarget | null;
  /** What the page shows now, read only when a picture is asked for. */
  canvas: () => HTMLCanvasElement | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto">
        {target && <ReportForm target={target} canvas={canvas} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ReportForm({
  target,
  canvas,
  onClose,
}: {
  target: ReportTarget;
  canvas: () => HTMLCanvasElement | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const messageId = useId();
  const [kind, setKind] = useState<PageReportKind>(
    target.errorCode?.startsWith("BRAWZER_REFUSED") ? "blocked" : "broken",
  );
  const [message, setMessage] = useState("");
  const [includeAddress, setIncludeAddress] = useState(target.url !== null);
  const [picture, setPicture] = useState<{ blob: Blob; url: string } | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // The preview's object URL lives as long as the preview.
  useEffect(
    () => () => {
      if (picture) URL.revokeObjectURL(picture.url);
    },
    [picture],
  );

  async function togglePicture(attach: boolean) {
    setPictureError(null);
    if (!attach) {
      setPicture(null);
      return;
    }
    const source = canvas();
    const blob = source ? await fittingJpeg(source, MAX_REPORT_PICTURE_BYTES) : null;
    if (!blob) {
      setPictureError(
        source ? "The page is too detailed to attach." : "The page hasn’t shown anything yet.",
      );
      return;
    }
    setPicture({ blob, url: URL.createObjectURL(blob) });
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (message.trim() === "") {
      setError("Say what went wrong.");
      return;
    }
    setSending(true);
    setError(null);
    const result = await sendPageReport({
      kind,
      message,
      url: includeAddress ? target.url : null,
      title: includeAddress ? (target.title?.slice(0, 300) ?? null) : null,
      errorCode: target.errorCode,
      sessionId: target.sessionId,
      picture: picture ? await base64Of(picture.blob) : null,
    });
    setSending(false);
    if (result.ok) {
      toast.add({
        type: "success",
        title: "Report sent",
        description: "Thank you. Brawzer’s administrators will see it.",
      });
      onClose();
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      setError(result.error.message);
    }
  }

  return (
    <form method="post" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <DialogTitle>Report a problem with this page</DialogTitle>
      <DialogDescription>
        Brawzer’s administrators see the report on their Admin page, with your email address, what
        you write and what you include below. Nothing else about your session goes with it.
      </DialogDescription>
      <Select label="What happened?" options={KINDS} value={kind} onValueChange={setKind} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={messageId} className="text-callout font-medium text-ink">
          What went wrong?
        </label>
        <textarea
          id={messageId}
          name="message"
          required
          rows={4}
          maxLength={MAX_REPORT_MESSAGE_CHARS}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
          }}
          className={cn(inputClassName, "h-auto min-h-24 py-2 pointer-coarse:h-auto")}
        />
      </div>
      {target.url !== null && (
        <label className="flex items-start gap-3 text-callout text-ink">
          <Checkbox
            className="mt-0.5"
            checked={includeAddress}
            onCheckedChange={(checked) => {
              setIncludeAddress(checked);
            }}
          />
          <span className="min-w-0">
            Include the page’s address
            <span className="block truncate text-footnote text-ink-secondary">
              {displayUrl(target.url)}
            </span>
          </span>
        </label>
      )}
      <label className="flex items-start gap-3 text-callout text-ink">
        <Checkbox
          className="mt-0.5"
          checked={picture !== null}
          onCheckedChange={(checked) => void togglePicture(checked)}
        />
        <span>
          Attach a picture of what the page shows now
          <span className="block text-footnote text-ink-secondary">
            It’s deleted when the report is closed, or after {String(REPORT_PICTURE_DAYS)} days.
          </span>
        </span>
      </label>
      {pictureError && <p className="text-footnote text-danger">{pictureError}</p>}
      {picture && (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL, never optimised
        <img
          src={picture.url}
          alt="What will be sent: the page as it looks now"
          className="max-h-48 w-full rounded-md border border-line object-contain object-left-top"
        />
      )}
      {error && (
        <FormMessage tone="danger" title="The report wasn’t sent">
          {error}
        </FormMessage>
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={sending}>
          Send report
        </Button>
      </DialogFooter>
    </form>
  );
}
