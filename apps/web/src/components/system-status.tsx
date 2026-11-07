"use client";

import type { DependencyCheck } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { StatusDot, type StatusTone } from "@brawzer/ui/components/status-dot";
import { cn } from "@brawzer/ui/lib/cn";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchHealth, type HealthResult } from "@/lib/api/health";

type State = { phase: "checking" } | { phase: "done"; result: HealthResult; checkedAt: Date };

interface Row {
  name: string;
  detail: string;
  tone: StatusTone;
  status: string;
}

function dependencyRow(name: string, detail: string, check: DependencyCheck | undefined): Row {
  if (!check) return { name, detail, tone: "neutral", status: "Unknown" };
  return check.status === "up"
    ? { name, detail, tone: "success", status: `${check.latencyMs?.toFixed(1) ?? "–"} ms` }
    : { name, detail, tone: "danger", status: "Unreachable" };
}

function rowsFor(state: State): Row[] {
  const web: Row = {
    name: "Web app",
    detail: "This page, Next.js",
    tone: "success",
    status: "Running",
  };
  if (state.phase === "checking") {
    return [
      web,
      { name: "API", detail: "NestJS · port 4100", tone: "neutral", status: "Checking…" },
      { name: "PostgreSQL", detail: "Application data", tone: "neutral", status: "Checking…" },
      {
        name: "Redis",
        detail: "Valkey · sessions and queues",
        tone: "neutral",
        status: "Checking…",
      },
    ];
  }

  const { result } = state;
  if (result.kind === "unreachable") {
    return [
      web,
      { name: "API", detail: "NestJS · port 4100", tone: "danger", status: "Unreachable" },
      { name: "PostgreSQL", detail: "Application data", tone: "neutral", status: "Unknown" },
      { name: "Redis", detail: "Valkey · sessions and queues", tone: "neutral", status: "Unknown" },
    ];
  }

  return [
    web,
    {
      name: "API",
      detail: `NestJS · ${result.report.version}`,
      tone: "success",
      status: "Running",
    },
    dependencyRow("PostgreSQL", "Application data", result.report.checks?.database),
    dependencyRow("Redis", "Valkey · sessions and queues", result.report.checks?.redis),
  ];
}

const done = (result: HealthResult): State => ({ phase: "done", result, checkedAt: new Date() });

/** Live check of the local stack, through the web app's own /api/v1 route. */
export function SystemStatus({ className }: { className?: string }) {
  const [state, setState] = useState<State>({ phase: "checking" });

  // Initial check: state changes only when the request settles.
  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal).then(
      (result) => {
        setState(done(result));
      },
      () => undefined, // aborted on unmount
    );
    return () => {
      controller.abort();
    };
  }, []);

  const checkAgain = useCallback(() => {
    setState({ phase: "checking" });
    void fetchHealth().then((result) => {
      setState(done(result));
    });
  }, []);

  const checking = state.phase === "checking";
  const unreachable = state.phase === "done" && state.result.kind === "unreachable";
  const degraded = state.phase === "done" && state.result.kind === "degraded";

  return (
    <section
      aria-labelledby="system-status-title"
      className={cn("rounded-xl border border-line bg-surface", className)}
    >
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        <div>
          <h2 id="system-status-title" className="text-callout font-semibold text-ink">
            Local system status
          </h2>
          <p className="text-footnote text-ink-tertiary" aria-live="polite">
            {state.phase === "checking"
              ? "Checking services…"
              : `Checked at ${state.checkedAt.toLocaleTimeString()}`}
          </p>
        </div>
        <Button variant="ghost" size="sm" loading={checking} onClick={checkAgain}>
          <RefreshCw aria-hidden="true" />
          Check again
        </Button>
      </header>

      <ul className="divide-y divide-line">
        {rowsFor(state).map((row) => (
          <li key={row.name} className="flex items-center gap-3 px-5 py-3">
            <StatusDot tone={row.tone} pulse={row.tone === "neutral" && checking} />
            <div className="min-w-0 flex-1">
              <p className="text-callout font-medium text-ink">{row.name}</p>
              <p className="truncate text-footnote text-ink-tertiary">{row.detail}</p>
            </div>
            <span
              className={cn(
                "font-mono text-footnote",
                row.tone === "danger"
                  ? "text-danger"
                  : row.tone === "success"
                    ? "text-ink-secondary"
                    : "text-ink-tertiary",
              )}
            >
              {row.status}
            </span>
          </li>
        ))}
      </ul>

      {(unreachable || degraded) && (
        <p className="border-t border-line px-5 py-3 text-footnote text-ink-secondary">
          {unreachable ? (
            <>
              Start the API with <code className="text-ink">pnpm dev</code>.
            </>
          ) : (
            <>
              Start the local services with <code className="text-ink">pnpm infra:up</code>, then
              check again.
            </>
          )}
        </p>
      )}
    </section>
  );
}
