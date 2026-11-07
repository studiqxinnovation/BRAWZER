"use client";

import type { SecurityEvent, SecurityEventPage } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { cn } from "@brawzer/ui/lib/cn";
import { CircleCheck, Dot, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { describeEvent } from "@/content/app";
import { securityEvents } from "@/lib/api/account";
import { leaveSignedInArea } from "@/lib/session-channel";
import { timeAgo } from "@/lib/time";

function EventRow({ event, now }: { event: SecurityEvent; now: number }) {
  const { title, tone } = describeEvent(event);
  const Icon = tone === "success" ? CircleCheck : tone === "warning" ? TriangleAlert : Dot;
  const facts = [
    event.device ?? "Unknown device",
    event.ipAddress ? `IP ${event.ipAddress}` : null,
  ];
  return (
    <li className="flex items-start gap-3 px-5 py-3.5">
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "neutral" && "text-ink-tertiary",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-callout text-ink">{title}</p>
        <p className="text-footnote text-ink-secondary">
          {facts.filter(Boolean).join(" · ")} ·{" "}
          <time dateTime={event.occurredAt}>{timeAgo(event.occurredAt, now)}</time>
        </p>
      </div>
    </li>
  );
}

/**
 * The security history. The first page is rendered on the server; older
 * pages load on request. Times are relative to when the page was rendered,
 * so the server and the browser show the same words.
 */
export function ActivityList({
  initial,
  renderedAt,
}: {
  initial: SecurityEventPage;
  renderedAt: number;
}) {
  const [events, setEvents] = useState(initial.events);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadOlder() {
    if (!cursor) return;
    setPending(true);
    setError(null);
    const result = await securityEvents(cursor);
    setPending(false);
    if (result.ok) {
      setEvents((current) => [...current, ...result.data.events]);
      setCursor(result.data.nextCursor);
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      setError(result.error.message);
    }
  }

  if (events.length === 0) {
    return <p className="text-callout text-ink-secondary">No activity yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-line bg-surface">
        <ol className="divide-y divide-line">
          {events.map((event) => (
            <EventRow key={event.id} event={event} now={renderedAt} />
          ))}
        </ol>
      </div>
      {error && <FormMessage tone="danger">{error}</FormMessage>}
      {cursor && (
        <Button
          variant="secondary"
          className="self-start"
          loading={pending}
          onClick={() => void loadOlder()}
        >
          Show older activity
        </Button>
      )}
    </div>
  );
}
