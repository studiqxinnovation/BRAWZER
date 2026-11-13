"use client";

import {
  can,
  type SavedReply,
  type StaffTicket,
  type StaffTicketList,
  type StaffTicketSummary,
  type TicketCategory,
  ticketCategories,
  ticketCategoryNames,
  type TicketPriority,
  ticketPriorities,
  ticketPriorityNames,
  type TicketStatus,
  ticketStatuses,
  type TicketView,
  ticketViews,
} from "@brawzer/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  fetchAssignees,
  fetchInbox,
  fetchSavedReplies,
  fetchStaffTicket,
  replyAsStaff,
  updateTicket,
} from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { ago, Avatar, fdt, fmtMinutes, fsize, percent, Pill, StatusPill } from "../ui";
import { useAction } from "../use-action";

const VIEW_LABEL: Record<TicketView, string> = {
  open: "Open",
  pending: "Pending",
  solved: "Solved",
  all: "All",
};
const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  pending: "Pending",
  solved: "Solved",
};
const PRIORITY_TONE: Record<TicketPriority, "r" | "o" | "b" | ""> = {
  urgent: "r",
  high: "o",
  normal: "",
  low: "b",
};

const HALF_MINUTE = 30_000;
const subscribeToClock = (listener: () => void) => {
  const timer = setInterval(listener, HALF_MINUTE);
  return () => {
    clearInterval(timer);
  };
};
const clockNow = () => Math.floor(Date.now() / HALF_MINUTE) * HALF_MINUTE;
const clockOnServer = () => 0;
/** The time, to the half minute, so targets count down without re-rendering every second. */
function useNow(): number {
  return useSyncExternalStore(subscribeToClock, clockNow, clockOnServer);
}

/** Where a request stands against its response target. */
function TargetPill({ ticket, now }: { ticket: StaffTicketSummary; now: number }) {
  if (ticket.firstResponseAt) return <Pill tone="g">Replied</Pill>;
  if (!ticket.responseDueAt || now === 0) return null;
  const left = Date.parse(ticket.responseDueAt) - now;
  if (left < 0) return <Pill tone="r">Missed by {fmtMinutes(Math.round(-left / 60_000))}</Pill>;
  const total = Date.parse(ticket.responseDueAt) - Date.parse(ticket.createdAt);
  return (
    <Pill tone={left < total * 0.25 ? "o" : ""}>{fmtMinutes(Math.round(left / 60_000))} left</Pill>
  );
}

/** The support inbox: the queue, the conversation, the customer beside it. */
export function InboxPage() {
  const me = useStaff();
  const params = useSearchParams();
  const [view, setView] = useState<TicketView>("open");
  const [mine, setMine] = useState(false);
  const [list, setList] = useState<StaffTicketList | null>(null);
  const [selected, setSelected] = useState<string | null>(params.get("t"));
  const [ticket, setTicket] = useState<StaffTicket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replies, setReplies] = useState<SavedReply[]>([]);
  const [assignees, setAssignees] = useState<{ id: string; email: string }[]>([]);
  const now = useNow();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchInbox({ view, mine }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) leaveSignedInArea("expired");
        setError(result.error.message);
        return;
      }
      setList(result.data);
      // Keep what is open (a request just solved leaves the Open list but stays on screen).
      setSelected((current) => current ?? result.data.tickets[0]?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [view, mine, version]);

  useEffect(() => {
    void fetchSavedReplies().then((result) => {
      if (result.ok) setReplies(result.data.replies);
    });
    void fetchAssignees().then((result) => {
      if (result.ok) setAssignees(result.data.assignees);
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void fetchStaffTicket(selected).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setTicket(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, version]);

  const changed = useCallback((next: StaffTicket) => {
    setTicket(next);
    setVersion((current) => current + 1);
  }, []);

  const tickets = list?.tickets ?? [];
  const shown = ticket?.id === selected ? ticket : null;
  return (
    <div className="ticket-layout">
      <div className="card p0">
        <div
          className="row"
          style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}
        >
          <div className="seg" role="tablist" aria-label="Which requests">
            {ticketViews.map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={entry === view}
                className={entry === view ? "on" : ""}
                onClick={() => {
                  setView(entry);
                }}
              >
                {VIEW_LABEL[entry]}
                {list && list.counts[entry] > 0 ? ` ${String(list.counts[entry])}` : ""}
              </button>
            ))}
          </div>
          <label className="row sm" style={{ marginLeft: "auto", gap: 5 }}>
            <input
              type="checkbox"
              checked={mine}
              onChange={(event) => {
                setMine(event.target.checked);
              }}
            />
            Mine
          </label>
        </div>
        <div className="tq" role="list" aria-label="Requests">
          {error && !list ? (
            <div className="warnbox" style={{ margin: 12 }}>
              {error}
            </div>
          ) : !list ? (
            <div className="empty">Loading…</div>
          ) : tickets.length === 0 ? (
            <div className="empty">No requests</div>
          ) : (
            tickets.map((entry) => (
              <div
                key={entry.id}
                role="listitem"
                className={`t${entry.id === selected ? "on" : ""}`}
              >
                <button
                  type="button"
                  className="t-open"
                  aria-current={entry.id === selected ? "true" : undefined}
                  onClick={() => {
                    setSelected(entry.id);
                  }}
                >
                  <div className="row sm">
                    <span className="muted">
                      #{entry.number} · {entry.customer.handle}
                      {entry.customer.teamName ? ` · ${entry.customer.teamName}` : ""}
                    </span>
                    <span style={{ marginLeft: "auto" }}>
                      <TargetPill ticket={entry} now={now} />
                    </span>
                  </div>
                  <b>{entry.subject}</b>
                  <div className="row sm">
                    <Pill tone={PRIORITY_TONE[entry.priority]}>
                      {ticketPriorityNames[entry.priority]}
                    </Pill>
                    <span className="muted">{ticketCategoryNames[entry.category]} · Help</span>
                    <span className="muted" style={{ marginLeft: "auto" }}>
                      {entry.assignee ? entry.assignee.email.split("@")[0] : "Unassigned"}
                    </span>
                  </div>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {shown ? (
        <Conversation
          key={shown.id}
          ticket={shown}
          now={now}
          replies={replies}
          assignees={assignees}
          mayAct={can(me.role, "tickets")}
          onChange={changed}
        />
      ) : (
        <div className="card empty">{selected ? "Loading…" : "Select a request"}</div>
      )}

      {shown && <CustomerSide ticket={shown} />}
    </div>
  );
}

function Conversation({
  ticket,
  now,
  replies,
  assignees,
  mayAct,
  onChange,
}: {
  ticket: StaffTicket;
  now: number;
  replies: SavedReply[];
  assignees: { id: string; email: string }[];
  mayAct: boolean;
  onChange: (ticket: StaffTicket) => void;
}) {
  const action = useAction();
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const first = ticket.customer.handle.split(/[._-]/)[0] ?? ticket.customer.handle;
  const change = (body: Parameters<typeof updateTicket>[1]) => {
    void action
      .run(() => updateTicket(ticket.id, body), null)
      .then((result) => {
        if (result) onChange(result.data);
      });
  };
  const send = (setStatus: "pending" | "solved" | null) => {
    const body = text.trim();
    if (body.length < 2) return;
    void action
      .run(
        () =>
          replyAsStaff(ticket.id, {
            body,
            kind: mode,
            setStatus: mode === "note" ? null : setStatus,
          }),
        mode === "note" ? "Note added" : "Reply sent by email",
      )
      .then((result) => {
        if (result) {
          setText("");
          onChange(result.data);
        }
      });
  };
  const lostAccess =
    ticket.category === "account" &&
    /lost|locked|can.t sign in|passkey|two-factor|2fa/i.test(ticket.subject);
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="muted sm">
          #{ticket.number} · Help · opened {ago(ticket.createdAt)}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <TargetPill ticket={ticket} now={now} />
        </span>
      </div>
      <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 12 }}>{ticket.subject}</h2>
      <div className="row" style={{ flexWrap: "wrap", marginBottom: 14 }}>
        <select
          className="in"
          aria-label="Status"
          value={ticket.status}
          disabled={!mayAct || action.busy}
          onChange={(event) => {
            change({ status: event.target.value as TicketStatus });
          }}
        >
          {ticketStatuses.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </select>
        <select
          className="in"
          aria-label="Priority"
          value={ticket.priority}
          disabled={!mayAct || action.busy}
          onChange={(event) => {
            change({ priority: event.target.value as TicketPriority });
          }}
        >
          {ticketPriorities.map((priority) => (
            <option key={priority} value={priority}>
              {ticketPriorityNames[priority]}
            </option>
          ))}
        </select>
        <select
          className="in"
          aria-label="Assigned to"
          value={ticket.assignee?.id ?? ""}
          disabled={!mayAct || action.busy}
          onChange={(event) => {
            change({ assigneeId: event.target.value || null });
          }}
        >
          <option value="">Unassigned</option>
          {assignees.map((person) => (
            <option key={person.id} value={person.id}>
              {person.email}
            </option>
          ))}
        </select>
        <select
          className="in"
          aria-label="Category"
          value={ticket.category}
          disabled={!mayAct || action.busy}
          onChange={(event) => {
            change({ category: event.target.value as TicketCategory });
          }}
        >
          {ticketCategories.map((category) => (
            <option key={category} value={category}>
              {ticketCategoryNames[category]}
            </option>
          ))}
        </select>
      </div>
      {lostAccess && (
        <div className="infobox">
          This looks like someone locked out. Check their sign-in methods before resetting anything
          by hand:{" "}
          <Link href={`/admin/customers/${ticket.customer.id}` as never}>open the account</Link>. If
          they lost every way in, <Link href="/admin/recovery">start account recovery</Link> rather
          than resetting anything by hand.
        </div>
      )}
      {ticket.category === "drive" && (
        <div className="infobox">
          Deleted files stay in their Trash for 30 days.{" "}
          <Link href={`/admin/customers/${ticket.customer.id}` as never}>Open the account</Link> to
          restore one.
        </div>
      )}
      {ticket.category === "privacy" && (
        <div className="infobox">
          Privacy requests have a legal one-month deadline. Note the date here; the privacy request
          pages come with 11.5.
        </div>
      )}
      <div>
        {ticket.messages.map((message) => (
          <div
            key={message.id}
            className={`msg${message.kind === "note" ? "note" : message.kind === "staff" ? "me" : message.kind === "system" ? "sys" : ""}`}
          >
            <div className="mh">
              <b>{message.kind === "customer" ? ticket.customer.handle : message.author}</b>
              {message.kind === "note" && "Internal note"}
              <span style={{ marginLeft: "auto" }}>{fdt(message.at)}</span>
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>{message.body}</div>
          </div>
        ))}
      </div>
      {mayAct && (
        <div style={{ marginTop: 14 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <div className="seg" role="tablist" aria-label="Reply or note">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "reply"}
                className={mode === "reply" ? "on" : ""}
                onClick={() => {
                  setMode("reply");
                }}
              >
                Reply
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "note"}
                className={mode === "note" ? "on" : ""}
                onClick={() => {
                  setMode("note");
                }}
              >
                Internal note
              </button>
            </div>
            <select
              className="in"
              aria-label="Insert saved reply"
              style={{ marginLeft: "auto" }}
              value=""
              onChange={(event) => {
                const reply = replies.find((entry) => entry.id === event.target.value);
                if (reply)
                  setText((current) => (current ? `${current}\n\n${reply.body}` : reply.body));
              }}
            >
              <option value="">Insert saved reply…</option>
              {replies.map((reply) => (
                <option key={reply.id} value={reply.id}>
                  {reply.name}
                </option>
              ))}
            </select>
          </div>
          <textarea
            className="in"
            rows={4}
            style={{ width: "100%" }}
            aria-label={mode === "note" ? "Internal note" : "Reply"}
            placeholder={
              mode === "note"
                ? "Note for the team (the customer can’t see this)"
                : `Write a reply to ${first}`
            }
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          {action.problem && (
            <div className="warnbox" style={{ marginTop: 8 }}>
              {action.problem}
            </div>
          )}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
            {mode === "note" ? (
              <button
                type="button"
                className="btn pri"
                disabled={action.busy || text.trim().length < 2}
                onClick={() => {
                  send(null);
                }}
              >
                Add note
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={action.busy || text.trim().length < 2}
                  onClick={() => {
                    send("pending");
                  }}
                >
                  Send, set Pending
                </button>
                <button
                  type="button"
                  className="btn pri"
                  disabled={action.busy || text.trim().length < 2}
                  onClick={() => {
                    send("solved");
                  }}
                >
                  Send and solve
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CustomerSide({ ticket }: { ticket: StaffTicket }) {
  const account = ticket.account;
  const secondFactor = account.issues.some((issue) => issue.title.startsWith("No passkey"))
    ? "Off"
    : "On";
  return (
    <div className="card cside">
      <div className="row" style={{ marginBottom: 12 }}>
        <Avatar name={account.handle} size={40} />
        <div style={{ minWidth: 0 }}>
          <b>{account.handle}</b>
          <div className="muted sm">
            {account.planName}
            {account.teamName ? ` · ${account.teamName}` : ""}
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <StatusPill status={account.status} />{" "}
        {account.role !== "user" && <Pill tone="p">Staff</Pill>}
      </div>
      <div className="sm" style={{ fontWeight: 600, margin: "12px 0 6px" }}>
        Account check
      </div>
      {account.issues.length === 0 ? (
        <div className="sm muted">No problems found</div>
      ) : (
        account.issues.slice(0, 4).map((issue) => (
          <div
            key={issue.title}
            className="sm"
            style={{ display: "flex", gap: 6, marginBottom: 6 }}
          >
            <Pill tone={issue.severity === "high" ? "r" : issue.severity === "medium" ? "o" : "b"}>
              {""}
            </Pill>
            {issue.title}
          </div>
        ))
      )}
      <dl className="kv sm" style={{ gridTemplateColumns: "76px 1fr", marginTop: 12 }}>
        <dt>Sessions</dt>
        <dd>{account.liveSessions} live</dd>
        <dt>Drive</dt>
        <dd>
          {percent(account.driveBytes, account.driveLimitBytes)}% full · {fsize(account.driveBytes)}
        </dd>
        <dt>2FA</dt>
        <dd>{secondFactor}</dd>
        <dt>Since</dt>
        <dd>{ago(account.createdAt)}</dd>
      </dl>
      <Link
        href={`/admin/customers/${account.id}` as never}
        className="btn pri"
        style={{ width: "100%", justifyContent: "center", marginTop: 14 }}
      >
        Open full account
      </Link>
    </div>
  );
}
