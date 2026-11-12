"use client";

import { Button } from "@brawzer/ui/components/button";
import { FolderPlus } from "lucide-react";
import { UploadButton } from "./uploads";

/** What the page head asks of the Drive manager below it. */
export const DRIVE_UPLOAD_EVENT = "brawzer:drive-upload";
export const DRIVE_NEW_FOLDER_EVENT = "brawzer:drive-new-folder";

/**
 * The prototype's Upload button in the page head (and New folder beside it).
 * They sit outside the manager, so they tell it what to do with an event:
 * rendered on the server like the rest of the head, nothing moves on load.
 */
export function DriveActions() {
  return (
    <>
      <UploadButton
        onFiles={(files) => {
          window.dispatchEvent(new CustomEvent(DRIVE_UPLOAD_EVENT, { detail: files }));
        }}
      />
      <Button
        variant="secondary"
        onClick={() => {
          window.dispatchEvent(new Event(DRIVE_NEW_FOLDER_EVENT));
        }}
      >
        <FolderPlus aria-hidden="true" />
        New folder
      </Button>
    </>
  );
}
