"use client";

import { useEffect } from "react";
import { setPageMissing } from "@/lib/desktop-focus";

/** Rendered by the 404 page: the desktop's window title says "Not found" while it shows. */
export function NotFoundMark() {
  useEffect(() => {
    setPageMissing(true);
    return () => {
      setPageMissing(false);
    };
  }, []);
  return null;
}
