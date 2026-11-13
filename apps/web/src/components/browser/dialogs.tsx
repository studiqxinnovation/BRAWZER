"use client";

import type { DialogKind } from "@brawzer/contracts";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@brawzer/ui/components/alert-dialog";
import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { Field, FieldLabel, Input } from "@brawzer/ui/components/field";
import { Kbd } from "@brawzer/ui/components/kbd";
import { type SubmitEvent, useState } from "react";

export interface PageDialogState {
  tabId: string;
  kind: DialogKind;
  message: string;
  defaultValue: string;
  /** Where the page is, so the person knows who is asking. */
  host: string | null;
}

const TITLES: Record<DialogKind, string> = {
  alert: "says",
  confirm: "asks",
  prompt: "asks",
  beforeunload: "asks before you leave",
};

/** A page's alert, confirm or prompt, drawn by Brawzer so it can never be mistaken for Brawzer. */
export function PageDialog({
  dialog,
  onAnswer,
}: {
  dialog: PageDialogState | null;
  onAnswer: (accept: boolean, text?: string) => void;
}) {
  const [text, setText] = useState("");
  const open = dialog !== null;
  const kind = dialog?.kind ?? "alert";

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onAnswer(true, kind === "prompt" ? text : undefined);
    setText("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onAnswer(false);
          setText("");
        }
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <form method="post" onSubmit={submit} className="flex flex-col gap-4">
          <DialogTitle>
            {dialog?.host ?? "The page"} {TITLES[kind]}
          </DialogTitle>
          <DialogDescription className="break-words whitespace-pre-wrap">
            {dialog?.kind === "beforeunload"
              ? "Changes you made may not be saved."
              : (dialog?.message ?? "\u00a0")}
          </DialogDescription>
          {kind === "prompt" && (
            <Field>
              <FieldLabel>Your answer</FieldLabel>
              <Input
                name="answer"
                defaultValue={dialog?.defaultValue}
                onChange={(event) => {
                  setText(event.target.value);
                }}
                autoComplete="off"
              />
            </Field>
          )}
          <DialogFooter>
            {kind !== "alert" && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  onAnswer(false);
                  setText("");
                }}
              >
                {kind === "beforeunload" ? "Stay" : "Cancel"}
              </Button>
            )}
            <Button type="submit" variant="primary">
              {kind === "beforeunload" ? "Leave" : "OK"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EndSessionDialog({
  open,
  onOpenChange,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>End this browser session?</AlertDialogTitle>
        <AlertDialogDescription>
          The cloud browser is destroyed, with every tab, cookie and page it held. Nothing is kept.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>Keep browsing</AlertDialogClose>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            End session
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const SHORTCUTS: readonly { keys: readonly string[]; does: string }[] = [
  { keys: ["Alt", "L"], does: "Edit the address" },
  { keys: ["Alt", "T"], does: "New tab" },
  { keys: ["Alt", "W"], does: "Close tab" },
  { keys: ["Delete"], does: "Close the focused tab" },
  { keys: ["Alt", "R"], does: "Reload" },
  { keys: ["Alt", "P"], does: "Save the page as a PDF in Drive" },
  { keys: ["Alt", "←"], does: "Back" },
  { keys: ["Alt", "→"], does: "Forward" },
  { keys: ["Shift", "Esc"], does: "Leave the page, back to Brawzer’s controls" },
];

/** Brawzer's shortcuts, from the "…" menu. The local browser reserves ⌘/Ctrl+T, W and N. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-footnote">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.does} className="contents">
              <dt className="flex gap-1">
                {shortcut.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dt>
              <dd className="text-ink-secondary">{shortcut.does}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-caption text-ink-tertiary">
          Everything else goes to the page. Full screen also sends ⌘/Ctrl shortcuts where the local
          browser allows it.
        </p>
      </DialogContent>
    </Dialog>
  );
}
