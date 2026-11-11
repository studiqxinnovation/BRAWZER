"use client";

import {
  AlertDialog,
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
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { Tile } from "./apps/registry";

const SHORTCUTS: [string, string][] = [
  ["Search apps and pages", "Ctrl+K or ⌘K"],
  ["Lock the screen", "Ctrl+Shift+L"],
  ["Minimise the active window", "Ctrl+M or ⌘M"],
  ["Switch windows", "Alt+` (Option+` on a Mac)"],
  ["Zoom the window", "Double-click a title bar"],
  ["Wallpaper, style and more", "Right-click the desktop"],
  ["Move through an open menu", "Arrow keys and Enter"],
  ["Close menus and dialogs", "Esc"],
];

/** Help → Keyboard shortcuts, as the prototype lists them. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(30rem,calc(100vw-2rem))]">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription className="sr-only">
          What each key does on the desktop.
        </DialogDescription>
        <dl className="dt-keys">
          {SHORTCUTS.map(([what, keys]) => (
            <div key={what}>
              <dt>{what}</dt>
              <dd>{keys}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** File → Wipe this computer…: end everything, clear what's here, and sign out. */
export function WipeDialog({
  open,
  onOpenChange,
  onWipe,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWipe: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>Wipe this computer?</AlertDialogTitle>
        <AlertDialogDescription>
          This closes every app, ends all browser sessions, stops music, clears your clipboard,
          signs you out and removes everything Brawzer kept in this browser. Your Drive stays safe
          in the cloud.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={onWipe}>
            Wipe now
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Control Centre → Leave no trace: close everything, without signing out. */
export function LeaveNoTraceDialog({
  state,
  onOpenChange,
  onConfirm,
}: {
  /** "ask", then the result once it's done. */
  state: "ask" | { windows: number; sessions: number } | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={state !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {state === "ask" ? (
          <>
            <AlertDialogTitle>Leave no trace?</AlertDialogTitle>
            <AlertDialogDescription>
              This closes every window and app, ends every browser session and clears this
              computer’s clipboard. Your files in Brawzer Drive stay safe in the cloud.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <Button
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={onConfirm}>
                Leave no trace
              </Button>
            </AlertDialogFooter>
          </>
        ) : state ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <Tile glyph="shield" colour="green" size={56} />
            <AlertDialogTitle>No trace left</AlertDialogTitle>
            <AlertDialogDescription>
              {state.windows} window{state.windows === 1 ? "" : "s"} closed
              <br />
              {state.sessions} browser session{state.sessions === 1 ? "" : "s"} ended
              <br />
              Clipboard cleared
            </AlertDialogDescription>
            <Button
              variant="primary"
              className="mt-2"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Done
            </Button>
          </div>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
