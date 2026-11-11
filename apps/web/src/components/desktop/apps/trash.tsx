"use client";

import { FilesBrowser } from "./files";

/** Trash: Drive's deleted files, to put back or remove for good. */
export default function TrashApp() {
  return <FilesBrowser start="trash" />;
}
