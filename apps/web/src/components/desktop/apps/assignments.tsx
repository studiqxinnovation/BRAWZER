"use client";

import { Button } from "@brawzer/ui/components/button";
import { CalendarClock, Check, Plus, Trash2 } from "lucide-react";
import { type SubmitEvent, useId, useState } from "react";
import { z } from "zod";
import { RecordStatus } from "./record-status";
import { formText, newId, useAppRecord } from "./use-app-record";

const assignmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  module: z.string(),
  /** yyyy-mm-dd, the day it's due. */
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  done: z.boolean(),
});
const stateSchema = z.object({ assignments: z.array(assignmentSchema) });
type Assignment = z.infer<typeof assignmentSchema>;

const DAY = 24 * 60 * 60 * 1000;
const today = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};
const dayOf = (due: string) => {
  const [year, month, day] = due.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).getTime();
};

/** "Due today", "Due in 3 days", "2 days late". */
export function dueLabel(due: string, now = today()): string {
  const days = Math.round((dayOf(due) - now) / DAY);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days > 1) return `Due in ${String(days)} days`;
  return days === -1 ? "1 day late" : `${String(-days)} days late`;
}

/** Coursework and its due dates, grouped as they come up. */
export default function AssignmentsApp() {
  const formId = useId();
  const { value, update, loaded, save, retry } = useAppRecord("assignments", "state", stateSchema, {
    assignments: [],
  });
  const [error, setError] = useState<string | null>(null);
  const now = today();

  function add(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = formText(form, "title").trim();
    const course = formText(form, "module").trim();
    const due = formText(form, "due");
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      setError("Give it a title and a due date.");
      return;
    }
    setError(null);
    update((current) => ({
      assignments: [
        ...current.assignments,
        { id: newId(), title, module: course, due, done: false },
      ],
    }));
    event.currentTarget.reset();
  }

  const sorted = [...value.assignments].sort((a, b) => a.due.localeCompare(b.due));
  const groups: { label: string; items: Assignment[] }[] = [
    { label: "Late", items: sorted.filter((item) => !item.done && dayOf(item.due) < now) },
    {
      label: "This week",
      items: sorted.filter(
        (item) => !item.done && dayOf(item.due) >= now && dayOf(item.due) < now + 7 * DAY,
      ),
    },
    {
      label: "Later",
      items: sorted.filter((item) => !item.done && dayOf(item.due) >= now + 7 * DAY),
    },
    { label: "Done", items: sorted.filter((item) => item.done) },
  ].filter((group) => group.items.length > 0);

  return (
    <div className="ap-body">
      <form method="post" id={formId} className="ap-toolbar ap-form-row" onSubmit={add} noValidate>
        <label className="ap-field ap-grow">
          <span>Assignment</span>
          <input className="ap-input" name="title" placeholder="Essay on…" required />
        </label>
        <label className="ap-field">
          <span>Module</span>
          <input className="ap-input" name="module" placeholder="Optional" />
        </label>
        <label className="ap-field">
          <span>Due</span>
          <input className="ap-input" name="due" type="date" required />
        </label>
        <Button type="submit" variant="primary">
          <Plus aria-hidden="true" />
          Add
        </Button>
        {error && (
          <p className="ap-error" role="alert">
            {error}
          </p>
        )}
      </form>
      <div className="ap-main">
        {loaded === "loading" ? null : groups.length === 0 ? (
          <div className="ap-empty">
            <CalendarClock aria-hidden="true" className="size-8" />
            <p>Nothing due. Add your coursework above to see what’s coming up.</p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="ap-group">
              <h2 className="ap-group-title">
                {group.label} <span>{group.items.length}</span>
              </h2>
              <ul className="ap-list">
                {group.items.map((item) => (
                  <li key={item.id} className="ap-list-item" data-done={item.done || undefined}>
                    <button
                      type="button"
                      className="ap-check"
                      role="checkbox"
                      aria-checked={item.done}
                      aria-label={`${item.title} done`}
                      onClick={() => {
                        update((current) => ({
                          assignments: current.assignments.map((candidate) =>
                            candidate.id === item.id
                              ? { ...candidate, done: !candidate.done }
                              : candidate,
                          ),
                        }));
                      }}
                    >
                      {item.done && <Check aria-hidden="true" />}
                    </button>
                    <span className="ap-list-main">
                      <b>{item.title}</b>
                      <span>
                        {item.module ? `${item.module} · ` : ""}
                        {new Date(dayOf(item.due)).toLocaleDateString([], {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </span>
                    {!item.done && (
                      <span className="ap-pill" data-late={dayOf(item.due) < now || undefined}>
                        {dueLabel(item.due, now)}
                      </span>
                    )}
                    <button
                      type="button"
                      className="ap-icon-button"
                      aria-label={`Delete ${item.title}`}
                      onClick={() => {
                        update((current) => ({
                          assignments: current.assignments.filter(
                            (candidate) => candidate.id !== item.id,
                          ),
                        }));
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <RecordStatus save={save} loaded={loaded} onRetry={() => void retry()}>
        {String(value.assignments.filter((item) => !item.done).length)} to do
      </RecordStatus>
    </div>
  );
}
