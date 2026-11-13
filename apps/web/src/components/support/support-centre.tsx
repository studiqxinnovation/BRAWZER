"use client";

import {
  type Ticket,
  type TicketCategory,
  ticketCategories,
  ticketCategoryNames,
  type TicketSummary,
  ticketStatusNames,
  TICKET_BODY_MAX,
  TICKET_SUBJECT_MAX,
} from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { cn } from "@brawzer/ui/lib/cn";
import { ChevronLeft, Plus } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import type { ApiResult } from "@/lib/api/client";
import {
  createTicket,
  fetchTicket,
  fetchTickets,
  rateTicket,
  replyToTicket,
  solveTicket,
} from "@/lib/api/support";
import { leaveSignedInArea } from "@/lib/session-channel";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const when = (iso: string) => dateFormat.format(new Date(iso));

const STATUS_TONE: Record<TicketSummary["status"], string> = {
  open: "bg-accent/10 text-accent",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  solved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

function StatusBadge({ status }: { status: TicketSummary["status"] }) {
  return (
    <span
      className={cn(
        "text-xs inline-flex items-center rounded-full px-2 py-0.5 font-medium",
        STATUS_TONE[status],
      )}
    >
      {ticketStatusNames[status]}
    </span>
  );
}

/**
 * Help: the account's requests to Brawzer's team. The same view serves the
 * desktop's Help app and the signed-in Help page. Replies arrive here and by
 * email; nothing is kept on this computer.
 */
export function SupportCentre({
  initialTicket = null,
  compact = false,
}: {
  /** Open straight on this request (from an email's link). */
  initialTicket?: string | null;
  /** Inside an app window: tighter spacing. */
  compact?: boolean;
}) {
  const toast = useToast();
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "new" | "ticket">(initialTicket ? "ticket" : "list");
  const [current, setCurrent] = useState<Ticket | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(initialTicket);

  const handle = useCallback(<T,>(result: ApiResult<T>): T | null => {
    if (result.ok) return result.data;
    if (result.status === 401) leaveSignedInArea("expired");
    setError(result.error.message);
    return null;
  }, []);

  const reload = useCallback(() => {
    void fetchTickets().then((result) => {
      const data = handle(result);
      if (data) setTickets(data.tickets);
    });
  }, [handle]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    void fetchTicket(currentId).then((result) => {
      if (cancelled) return;
      const data = handle(result);
      if (data) setCurrent(data);
    });
    return () => {
      cancelled = true;
    };
  }, [currentId, handle]);

  const open = (id: string) => {
    setCurrent(null);
    setCurrentId(id);
    setView("ticket");
  };
  const back = () => {
    setView("list");
    setCurrentId(null);
    setCurrent(null);
    reload();
  };
  const changed = (ticket: Ticket) => {
    setCurrent(ticket);
    setTickets((list) =>
      list ? list.map((entry) => (entry.id === ticket.id ? { ...entry, ...ticket } : entry)) : list,
    );
  };

  const pad = compact ? "p-4" : "p-0";

  if (view === "new") {
    return (
      <div className={cn("flex flex-col gap-4", pad)}>
        <BackButton onClick={back} />
        <NewRequest
          onCreated={(ticket) => {
            toast.add({ type: "success", title: `Request #${String(ticket.number)} sent` });
            setTickets((list) => [ticket, ...(list ?? [])]);
            setCurrent(ticket);
            setCurrentId(ticket.id);
            setView("ticket");
          }}
          handle={handle}
        />
        {error && <Problem text={error} />}
      </div>
    );
  }

  if (view === "ticket") {
    return (
      <div className={cn("flex flex-col gap-4", pad)}>
        <BackButton onClick={back} />
        {error && <Problem text={error} />}
        {current ? (
          <TicketThread ticket={current} onChange={changed} handle={handle} />
        ) : (
          !error && <p className="text-sm text-ink-muted">Loading the request…</p>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", pad)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink-muted">
            Ask Brawzer’s team anything about your account, billing, Drive or a browser that
            misbehaves. Replies come here and to your email.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setError(null);
            setView("new");
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          New request
        </Button>
      </div>
      {error && <Problem text={error} />}
      {tickets === null ? (
        <p className="text-sm text-ink-muted">Loading your requests…</p>
      ) : tickets.length === 0 ? (
        <div className="text-sm text-ink-muted rounded-xl border border-dashed border-line p-6 text-center">
          No requests yet. When you need a hand, start one and we’ll reply by email too.
        </div>
      ) : (
        <ul
          className="divide-y divide-line rounded-xl border border-line"
          aria-label="Your requests"
        >
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <button
                type="button"
                className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => {
                  open(ticket.id);
                }}
              >
                <span className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted">#{ticket.number}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{ticket.subject}</span>
                  <StatusBadge status={ticket.status} />
                </span>
                <span className="text-xs text-ink-muted flex items-center gap-2">
                  <span>{ticketCategoryNames[ticket.category]}</span>
                  <span aria-hidden="true">·</span>
                  <span>{when(ticket.updatedAt)}</span>
                  {ticket.preview && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="min-w-0 truncate">{ticket.preview}</span>
                    </>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="text-sm text-ink-muted inline-flex w-fit items-center gap-1 hover:text-ink"
      onClick={onClick}
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      All requests
    </button>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <p role="alert" className="text-sm rounded-lg bg-danger/10 px-3 py-2 text-danger">
      {text}
    </p>
  );
}

function NewRequest({
  onCreated,
  handle,
}: {
  onCreated: (ticket: Ticket) => void;
  handle: <T>(result: ApiResult<T>) => T | null;
}) {
  const id = useId();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("account");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      method="post"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (subject.trim().length < 3) {
          setProblem("Give the request a short subject.");
          return;
        }
        if (body.trim().length < 2) {
          setProblem("Write what’s happening.");
          return;
        }
        setProblem(null);
        setBusy(true);
        void createTicket({ subject: subject.trim(), category, body: body.trim() }).then(
          (result) => {
            setBusy(false);
            if (!result.ok) {
              setProblem(result.error.message);
              handle(result);
              return;
            }
            onCreated(result.data);
          },
        );
      }}
    >
      <h2 className="text-base font-semibold">New request</h2>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-subject`} className="text-sm font-medium">
          Subject
        </label>
        <input
          id={`${id}-subject`}
          className="text-sm rounded-lg border border-line bg-surface px-3 py-2"
          value={subject}
          maxLength={TICKET_SUBJECT_MAX}
          placeholder="What’s it about, in a few words"
          onChange={(event) => {
            setSubject(event.target.value);
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-category`} className="text-sm font-medium">
          About
        </label>
        <select
          id={`${id}-category`}
          className="text-sm rounded-lg border border-line bg-surface px-3 py-2"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value as TicketCategory);
          }}
        >
          {ticketCategories.map((entry) => (
            <option key={entry} value={entry}>
              {ticketCategoryNames[entry]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-body`} className="text-sm font-medium">
          What’s happening?
        </label>
        <textarea
          id={`${id}-body`}
          className="text-sm min-h-32 rounded-lg border border-line bg-surface px-3 py-2"
          value={body}
          maxLength={TICKET_BODY_MAX}
          placeholder="What you did, what you expected, and what happened instead."
          onChange={(event) => {
            setBody(event.target.value);
          }}
        />
        <p className="text-xs text-ink-muted">
          Don’t include passwords or card numbers. Brawzer’s team never asks for them.
        </p>
      </div>
      {problem && <Problem text={problem} />}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send request"}
        </Button>
      </div>
    </form>
  );
}

function TicketThread({
  ticket,
  onChange,
  handle,
}: {
  ticket: Ticket;
  onChange: (ticket: Ticket) => void;
  handle: <T>(result: ApiResult<T>) => T | null;
}) {
  const id = useId();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState("");
  const run = (request: Promise<ApiResult<Ticket>>) => {
    setBusy(true);
    void request.then((result) => {
      setBusy(false);
      const data = handle(result);
      if (data) onChange(data);
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-muted">#{ticket.number}</span>
        <h2 className="text-base min-w-0 flex-1 font-semibold">{ticket.subject}</h2>
        <StatusBadge status={ticket.status} />
      </div>
      <p className="text-xs text-ink-muted">
        {ticketCategoryNames[ticket.category]} · opened {when(ticket.createdAt)}
      </p>
      <ol className="flex flex-col gap-2" aria-label="Messages">
        {ticket.messages.map((message) => (
          <li
            key={message.id}
            className={cn(
              "text-sm rounded-xl px-3 py-2",
              message.kind === "system"
                ? "text-xs text-ink-muted text-center"
                : message.kind === "customer"
                  ? "ml-8 bg-accent/10"
                  : "mr-8 bg-surface-sunken",
            )}
          >
            {message.kind !== "system" && (
              <p className="text-xs text-ink-muted mb-1 flex gap-2">
                <span className="font-medium">
                  {message.kind === "customer" ? "You" : message.author}
                </span>
                <span className="ml-auto">{when(message.at)}</span>
              </p>
            )}
            <p className="whitespace-pre-wrap">{message.body}</p>
          </li>
        ))}
      </ol>

      {ticket.status === "solved" && ticket.rating === null && (
        <form
          method="post"
          className="flex flex-col gap-2 rounded-xl border border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!rating) return;
            run(rateTicket(ticket.id, { rating, comment: comment.trim() || undefined }));
          }}
        >
          <p className="text-sm font-medium">How did we do?</p>
          <div className="flex gap-1" role="radiogroup" aria-label="Rating out of 5">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={`${String(value)} of 5`}
                className={cn(
                  "text-sm size-9 rounded-full border font-medium",
                  rating >= value
                    ? "text-accent-foreground border-accent bg-accent"
                    : "text-ink-muted border-line",
                )}
                onClick={() => {
                  setRating(value);
                }}
              >
                {value}
              </button>
            ))}
          </div>
          <input
            aria-label="Anything to add?"
            className="text-sm rounded-lg border border-line bg-surface px-3 py-2"
            placeholder="Anything to add? (optional)"
            value={comment}
            maxLength={500}
            onChange={(event) => {
              setComment(event.target.value);
            }}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || rating === 0}>
              Send rating
            </Button>
          </div>
        </form>
      )}
      {ticket.rating !== null && (
        <p className="text-xs text-ink-muted">You rated this {ticket.rating} of 5. Thank you.</p>
      )}

      <form
        method="post"
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (reply.trim().length < 2) return;
          run(replyToTicket(ticket.id, reply.trim()));
          setReply("");
        }}
      >
        <label htmlFor={`${id}-reply`} className="text-sm font-medium">
          {ticket.status === "solved" ? "Not solved after all? Reply and it opens again." : "Reply"}
        </label>
        <textarea
          id={`${id}-reply`}
          className="text-sm min-h-20 rounded-lg border border-line bg-surface px-3 py-2"
          value={reply}
          maxLength={TICKET_BODY_MAX}
          onChange={(event) => {
            setReply(event.target.value);
          }}
        />
        <div className="flex flex-wrap justify-end gap-2">
          {ticket.status !== "solved" && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                run(solveTicket(ticket.id));
              }}
            >
              Mark as solved
            </Button>
          )}
          <Button type="submit" size="sm" disabled={busy || reply.trim().length < 2}>
            Send reply
          </Button>
        </div>
      </form>
    </div>
  );
}
