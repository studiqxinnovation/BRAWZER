"use client";

import { type AdminPageReport, engineDetails, type PageReportKind } from "@brawzer/contracts";
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
import { SegmentedControl } from "@brawzer/ui/components/segmented-control";
import { Spinner } from "@brawzer/ui/components/spinner";
import { useToast } from "@brawzer/ui/components/toast";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { Panel } from "@/components/app-shell/page";
import { LocalDate } from "@/components/local-date";
import { closeReport, fetchAdminReports, fetchReportPicture } from "@/lib/api/reports";
import { leaveSignedInArea } from "@/lib/session-channel";

const KIND_LABELS: Record<PageReportKind, string> = {
  broken: "Doesn’t work",
  blocked: "Blocked wrongly",
  other: "Something else",
};

type State = "open" | "closed";

/** Pages people reported (Phase 8, idea 12), with what they chose to send. */
export function AdminReports() {
  const toast = useToast();
  const confirmed = useConfirmedRequest();
  const [state, setState] = useState<State>("open");
  const [list, setList] = useState<{ state: State; reports: AdminPageReport[]; open: number }>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pictures, setPictures] = useState<Record<string, string>>({});
  const [closing, setClosing] = useState<AdminPageReport | null>(null);
  const [pending, setPending] = useState(false);

  const apply = useCallback(
    (wanted: State, result: Awaited<ReturnType<typeof fetchAdminReports>>) => {
      if (result.ok) {
        setList({ state: wanted, ...result.data });
        setError(null);
      } else if (result.status === 401) {
        leaveSignedInArea("expired");
      } else {
        setError(result.error.message);
      }
    },
    [],
  );

  const load = useCallback(
    async (wanted: State) => {
      setLoading(true);
      const result = await confirmed(() => fetchAdminReports(wanted));
      setLoading(false);
      apply(wanted, result);
    },
    [confirmed, apply],
  );

  // The first load sets state only when the answer arrives.
  useEffect(() => {
    let cancelled = false;
    void confirmed(() => fetchAdminReports("open")).then((result) => {
      if (!cancelled) apply("open", result);
    });
    return () => {
      cancelled = true;
    };
  }, [confirmed, apply]);

  async function showPicture(id: string) {
    const result = await confirmed(() => fetchReportPicture(id));
    if (result.ok) {
      setPictures((current) => ({ ...current, [id]: result.data.picture }));
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      toast.add({ type: "error", title: "Couldn’t show it", description: result.error.message });
    }
  }

  async function close() {
    if (!closing) return;
    setPending(true);
    const result = await confirmed(() => closeReport(closing.id));
    setPending(false);
    if (result.ok) {
      toast.add({ type: "success", title: "Report closed" });
      setPictures(({ [closing.id]: _gone, ...rest }) => rest);
      setClosing(null);
      void load(state);
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      toast.add({ type: "error", title: "Couldn’t close it", description: result.error.message });
    }
  }

  const shown = list?.state === state ? list.reports : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="Which reports"
          value={state}
          onValueChange={(next) => {
            setState(next);
            void load(next);
          }}
          options={[
            {
              value: "open",
              label: list ? `Open (${String(list.open)})` : "Open",
            },
            { value: "closed", label: "Closed" },
          ]}
        />
        <Button variant="secondary" size="sm" loading={loading} onClick={() => void load(state)}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>
      <p className="text-footnote text-ink-secondary">
        Only what the person chose to send. A picture is deleted when its report is closed, or after
        30 days; closed reports go after 90.
      </p>
      {error && (
        <FormMessage tone="danger" title="Reports can’t be loaded">
          {error}
        </FormMessage>
      )}
      {!shown && !error && (
        <p className="flex items-center gap-2 text-callout text-ink-secondary" role="status">
          <Spinner className="size-4" /> Loading…
        </p>
      )}
      {shown?.length === 0 && (
        <p className="text-callout text-ink-secondary">
          {state === "open" ? "No open reports." : "No closed reports."}
        </p>
      )}
      {shown && shown.length > 0 && (
        <Panel>
          <ul
            aria-label={state === "open" ? "Open reports" : "Closed reports"}
            className="divide-y divide-line"
          >
            {shown.map((report) => (
              <li key={report.id} className="flex flex-col gap-2 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={report.kind === "blocked" ? "warning" : "neutral"}>
                    {KIND_LABELS[report.kind]}
                  </Badge>
                  <span className="text-callout font-medium text-ink">{report.account.email}</span>
                  <span className="text-footnote text-ink-secondary">
                    <LocalDate iso={report.createdAt} />
                    {report.engine ? ` · ${engineDetails[report.engine].name}` : ""}
                    {report.closedAt ? (
                      <>
                        {" "}
                        · closed <LocalDate iso={report.closedAt} />
                      </>
                    ) : null}
                  </span>
                </div>
                {report.url && (
                  <p className="text-footnote break-all text-ink-secondary">
                    {report.title ? `${report.title} · ` : ""}
                    <span className="font-mono">{report.url}</span>
                  </p>
                )}
                {report.errorCode && (
                  <p className="text-footnote text-ink-secondary">
                    Error page: <code className="font-mono">{report.errorCode}</code>
                  </p>
                )}
                <p className="text-callout whitespace-pre-wrap text-ink">{report.message}</p>
                {pictures[report.id] && (
                  // eslint-disable-next-line @next/next/no-img-element -- the report's own JPEG, never optimised
                  <img
                    src={`data:image/jpeg;base64,${pictures[report.id] ?? ""}`}
                    alt={`What ${report.account.email} saw`}
                    className="max-h-96 w-full rounded-md border border-line object-contain object-left-top"
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  {report.hasPicture && !pictures[report.id] && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void showPicture(report.id)}
                    >
                      Show the picture
                    </Button>
                  )}
                  {!report.closedAt && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setClosing(report);
                      }}
                    >
                      Close<span className="sr-only"> {report.account.email}’s report</span>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <AlertDialog
        open={closing !== null}
        onOpenChange={(open) => {
          if (!open) setClosing(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Close this report?</AlertDialogTitle>
          <AlertDialogDescription>
            {closing?.hasPicture
              ? "Its picture is deleted now. The report stays under Closed for 90 days."
              : "It stays under Closed for 90 days."}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>
              Keep it open
            </AlertDialogClose>
            <Button variant="primary" loading={pending} onClick={() => void close()}>
              Close report
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
