"use client";

import { useToast } from "@brawzer/ui/components/toast";
import { useCallback, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import type { ApiResult } from "@/lib/api/client";
import { leaveSignedInArea } from "@/lib/session-channel";

/** A console mutation: needs a recent sign-in, toasts when done, keeps the problem to show. */
export function useAction() {
  const toast = useToast();
  const confirmed = useConfirmedRequest();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = useCallback(
    async <T>(
      request: () => Promise<ApiResult<T>>,
      done: string | null,
    ): Promise<{ data: T } | null> => {
      setBusy(true);
      setProblem(null);
      const result = await confirmed(request);
      setBusy(false);
      if (result.ok) {
        if (done) toast.add({ type: "success", title: done });
        return { data: result.data };
      }
      if (result.status === 401) leaveSignedInArea("expired");
      else if (result.error.code !== "reauthentication_required") setProblem(result.error.message);
      return null;
    },
    [confirmed, toast],
  );
  return { run, busy, problem, setProblem };
}
