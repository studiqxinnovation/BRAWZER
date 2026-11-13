"use client";

import { useEffect } from "react";
import { apiRequest } from "@/lib/api/client";

/** Tells the audit log that this role tried a page it can't open. */
export function RefusedPageNotice({ page }: { page: string }) {
  useEffect(() => {
    void apiRequest<undefined>("/console/refused", { method: "POST", body: { page } });
  }, [page]);
  return null;
}
