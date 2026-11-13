"use client";

import { type AdminRuntime, engineDetails } from "@brawzer/contracts";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@brawzer/ui/components/alert-dialog";
import { Badge } from "@brawzer/ui/components/badge";
import { Button } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Spinner } from "@brawzer/ui/components/spinner";
import { useToast } from "@brawzer/ui/components/toast";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { Panel } from "@/components/app-shell/page";
import { LocalDate } from "@/components/local-date";
import { endSessionAsAdmin, fetchAdminRuntime } from "@/lib/api/billing";
import { leaveSignedInArea } from "@/lib/session-channel";

/** The cloud browser as an administrator sees it: hosts, the warm pool and live sessions. */
export function AdminRuntimeView() {
  const toast = useToast();
  const confirmed = useConfirmedRequest();
  const [runtime, setRuntime] = useState<AdminRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ending, setEnding] = useState<{ id: string; email: string } | null>(null);
  const [pending, setPending] = useState(false);

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchAdminRuntime>>) => {
    if (result.ok) {
      setRuntime(result.data);
      setError(null);
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      setError(result.error.message);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await confirmed(() => fetchAdminRuntime());
    setLoading(false);
    apply(result);
  }, [confirmed, apply]);

  // The first load sets state only when the answer arrives.
  useEffect(() => {
    let cancelled = false;
    void confirmed(() => fetchAdminRuntime()).then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [confirmed, apply]);

  async function end() {
    if (!ending) return;
    setPending(true);
    const result = await confirmed(() => endSessionAsAdmin(ending.id));
    setPending(false);
    if (result.ok) {
      toast.add({ type: "success", title: `Ended ${ending.email}’s session` });
      setEnding(null);
      void load();
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      toast.add({ type: "error", title: "Couldn’t end it", description: result.error.message });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-footnote text-ink-secondary">
          Who has a session, where and since when; never what it browses.
        </p>
        <Button variant="secondary" size="sm" loading={loading} onClick={() => void load()}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>
      {error && (
        <FormMessage tone="danger" title="The runtime view can’t be loaded">
          {error}
        </FormMessage>
      )}
      {!runtime && !error && (
        <p className="flex items-center gap-2 text-callout text-ink-secondary" role="status">
          <Spinner className="size-4" /> Loading…
        </p>
      )}
      {runtime && (
        <>
          <ul aria-label="Runtime hosts" className="grid gap-3 sm:grid-cols-2">
            {runtime.hosts.map((host) => (
              <li key={host.name}>
                <Panel className="flex items-center justify-between gap-3 p-4">
                  <span className="flex flex-col">
                    <span className="text-callout font-medium text-ink">{host.name}</span>
                    <span className="text-footnote text-ink-secondary">
                      {String(host.live)} of {String(host.capacity)} sessions
                    </span>
                  </span>
                  <Badge tone={host.healthy ? "success" : "danger"}>
                    {host.healthy ? "Reachable" : "Unreachable"}
                  </Badge>
                </Panel>
              </li>
            ))}
          </ul>
          <p className="text-footnote text-ink-secondary">
            Warm pool:{" "}
            {runtime.warmPool.size === 0
              ? "off"
              : `${String(runtime.warmPool.waiting)} of ${String(runtime.warmPool.size)} pairs waiting on this instance`}
          </p>
          {runtime.sessions.length === 0 ? (
            <p className="text-callout text-ink-secondary">No live sessions.</p>
          ) : (
            <Panel>
              <ul aria-label="Live sessions" className="divide-y divide-line">
                {runtime.sessions.map((session) => (
                  <li
                    key={session.id}
                    className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-callout font-medium text-ink">{session.email}</p>
                      <p className="text-footnote text-ink-secondary">
                        {engineDetails[session.engine].name} · {session.host} ·{" "}
                        {session.status === "starting" ? "Starting" : "Running"} since{" "}
                        <LocalDate iso={session.createdAt} />
                        {session.throughProxy ? " · Through a proxy" : ""}
                        {session.extensions > 0
                          ? ` · ${String(session.extensions)} extension${session.extensions === 1 ? "" : "s"}`
                          : ""}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEnding({ id: session.id, email: session.email });
                      }}
                    >
                      End<span className="sr-only"> {session.email}’s session</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
      <AlertDialog
        open={ending !== null}
        onOpenChange={(open) => {
          if (!open) setEnding(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>End {ending?.email ?? "this"}’s session?</AlertDialogTitle>
          <AlertDialogDescription>
            It ends as a sign-out would: their profile data is saved and the containers go. Their
            security history will say an administrator ended it.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>Keep it</AlertDialogClose>
            <Button variant="danger" loading={pending} onClick={() => void end()}>
              End session
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
