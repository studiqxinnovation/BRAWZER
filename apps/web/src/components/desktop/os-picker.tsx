"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@brawzer/ui/components/dialog";

/**
 * "Choose your desktop", as the prototype asks the first time: Mac style
 * or Windows style. The choice is kept with the account.
 */
export function OsPicker({
  open,
  onChoose,
}: {
  open: boolean;
  onChoose: (style: "mac" | "windows") => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next)
          onChoose(document.documentElement.dataset.desktopStyle === "windows" ? "windows" : "mac");
      }}
    >
      <DialogContent className="dt-os">
        <DialogTitle className="dt-os-h">Choose your desktop</DialogTitle>
        <DialogDescription className="dt-os-s">
          Pick the style you’re used to. Brawzer works the same either way.
        </DialogDescription>
        <div className="dt-os-opts">
          <button
            type="button"
            className="dt-os-opt"
            onClick={() => {
              onChoose("mac");
            }}
          >
            <span className="dt-os-prev" data-os="mac" aria-hidden="true">
              <i className="dt-p-bar" />
              <i className="dt-p-win">
                <b />
              </i>
              <i className="dt-p-dock" />
            </span>
            <span className="dt-os-name">Mac style</span>
            <span className="dt-os-d">Dock at the bottom, window buttons on the left</span>
          </button>
          <button
            type="button"
            className="dt-os-opt"
            onClick={() => {
              onChoose("windows");
            }}
          >
            <span className="dt-os-prev" data-os="windows" aria-hidden="true">
              <i className="dt-p-win">
                <b />
              </i>
              <i className="dt-p-task" />
            </span>
            <span className="dt-os-name">Windows style</span>
            <span className="dt-os-d">Taskbar and Start menu, window buttons on the right</span>
          </button>
        </div>
        <p className="dt-os-foot">You can change this any time in Settings → Desktop.</p>
      </DialogContent>
    </Dialog>
  );
}
