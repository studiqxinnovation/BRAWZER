"use client";

import { type SaveState, saveLabel } from "./use-app-record";

/** The status bar of an app that keeps records: where they are, and whether the last change is saved. */
export function RecordStatus({
  save,
  loaded,
  onRetry,
  children,
}: {
  save: SaveState;
  loaded: "loading" | "ready" | "failed";
  onRetry: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="ap-statusbar">
      <span>{children}</span>
      <span role="status">
        {loaded === "failed" ? (
          "Couldn’t load. Close the window and open it again."
        ) : save === "failed" ? (
          <>
            {saveLabel(save)}{" "}
            <button type="button" className="ap-text-button" onClick={onRetry}>
              Try again
            </button>
          </>
        ) : (
          saveLabel(save)
        )}
      </span>
    </div>
  );
}
