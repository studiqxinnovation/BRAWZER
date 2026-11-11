"use client";

import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { useEffect, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { RecordStatus } from "./record-status";
import { useAppRecord } from "./use-app-record";

const logSchema = z.object({
  subject: z.string(),
  minutes: z.number(),
  /** When it finished, as an ISO date. */
  at: z.string(),
});
const stateSchema = z.object({
  focusMinutes: z.number().int().min(5).max(90),
  breakMinutes: z.number().int().min(1).max(30),
  log: z.array(logSchema),
});

type Mode = "focus" | "break" | "long";
/** A long break, as the prototype offers after a few focus sessions. */
const LONG_BREAK_MINUTES = 15;
type Run = { mode: Mode; endsAt: number } | { mode: Mode; paused: number };

const second = (changed: () => void) => {
  const timer = setInterval(changed, 250);
  return () => {
    clearInterval(timer);
  };
};
const now = () => Math.floor(Date.now() / 250) * 250;

const minutesLabel = (total: number) => {
  const hours = Math.floor(total / 60);
  const minutes = Math.round(total % 60);
  return hours > 0 ? `${String(hours)} h ${String(minutes)} min` : `${String(minutes)} min`;
};

/** A focus timer: work, then a break; each finished focus is logged by subject. */
export default function FocusTimerApp() {
  const toast = useToast();
  const { value, update, loaded, save, retry } = useAppRecord("focus-timer", "state", stateSchema, {
    focusMinutes: 25,
    breakMinutes: 5,
    log: [],
  });
  const [subject, setSubject] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [chosen, setChosen] = useState<Mode>("focus");
  const tick = useSyncExternalStore(second, now, () => 0);
  const mode = run?.mode ?? chosen;
  const total =
    (mode === "focus"
      ? value.focusMinutes
      : mode === "long"
        ? LONG_BREAK_MINUTES
        : value.breakMinutes) * 60_000;
  const left = run === null ? total : "endsAt" in run ? Math.max(0, run.endsAt - tick) : run.paused;
  const finished = run !== null && "endsAt" in run && left === 0;

  // A finished focus is logged, then a break begins; a finished break waits for the next focus.
  useEffect(() => {
    if (!finished) return;
    const done = run.mode;
    queueMicrotask(() => {
      if (done === "focus") {
        update((current) => ({
          ...current,
          log: [
            ...current.log.slice(-499),
            {
              subject: subject.trim() || "General",
              minutes: current.focusMinutes,
              at: new Date().toISOString(),
            },
          ],
        }));
        toast.add({ type: "success", title: "Focus done", description: "Time for a break." });
        setRun({ mode: "break", endsAt: Date.now() + value.breakMinutes * 60_000 });
      } else {
        toast.add({
          type: "info",
          title: "Break over",
          description: "Start the next focus when you’re ready.",
        });
        setRun(null);
      }
    });
  }, [finished, run, subject, toast, update, value.breakMinutes]);

  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  const running = run !== null && "endsAt" in run;

  const startOfWeek = (() => {
    const date = new Date(tick || 0);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return date.getTime();
  })();
  const startOfDay = new Date(new Date(tick || 0).setHours(0, 0, 0, 0)).getTime();
  const week = value.log.filter((entry) => Date.parse(entry.at) >= startOfWeek);
  const todayMinutes = value.log
    .filter((entry) => Date.parse(entry.at) >= startOfDay)
    .reduce((sum, entry) => sum + entry.minutes, 0);
  const bySubject = Object.entries(
    week.reduce<Record<string, number>>((sums, entry) => {
      sums[entry.subject] = (sums[entry.subject] ?? 0) + entry.minutes;
      return sums;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const most = bySubject[0]?.[1] ?? 0;
  const subjects = [...new Set(value.log.map((entry) => entry.subject))].slice(-12);

  // The last seven days, today last, for the week's chart.
  const days = Array.from({ length: 7 }, (_, back) => {
    const start = startOfDay - (6 - back) * 86_400_000;
    const minutesThatDay = value.log
      .filter((entry) => {
        const at = Date.parse(entry.at);
        return at >= start && at < start + 86_400_000;
      })
      .reduce((sum, entry) => sum + entry.minutes, 0);
    return {
      label: new Date(start).toLocaleDateString([], { weekday: "short" }),
      minutes: minutesThatDay,
    };
  });
  const busiest = Math.max(1, ...days.map((day) => day.minutes));
  const weekMinutes = days.reduce((sum, day) => sum + day.minutes, 0);

  return (
    <div className="ap-body">
      <div className="ap-main ap-focus">
        <span className="ap-segment" role="tablist" aria-label="Timer">
          {(
            [
              ["focus", "Focus"],
              ["break", "Short break"],
              ["long", "Long break"],
            ] as const
          ).map(([option, label]) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={mode === option}
              disabled={run !== null}
              onClick={() => {
                setChosen(option);
              }}
            >
              {label}
            </button>
          ))}
        </span>
        <span className="ap-focus-time" role="timer" aria-label="Time left">
          {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </span>
        <span className="ap-row">
          <label className="sr-only" htmlFor="focus-subject">
            Subject
          </label>
          <input
            id="focus-subject"
            className="ap-input ap-focus-subject"
            list="focus-subjects"
            value={subject}
            placeholder="Subject"
            onChange={(event) => {
              setSubject(event.target.value);
            }}
          />
          <datalist id="focus-subjects">
            {subjects.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </span>
        <span className="ap-row">
          <Button
            variant="primary"
            size="sm"
            className="ap-focus-go"
            onClick={() => {
              if (running) setRun({ mode, paused: left });
              else setRun({ mode, endsAt: Date.now() + left });
            }}
          >
            {running ? "Pause" : run ? "Resume" : "Start"}
          </Button>
          <Button
            size="sm"
            disabled={run === null}
            onClick={() => {
              setRun(null);
            }}
          >
            Reset
          </Button>
        </span>
        <span className="ap-focus-lengths">
          <label className="ap-field ap-inline">
            <span>Focus</span>
            <input
              className="ap-input"
              type="number"
              min={5}
              max={90}
              value={value.focusMinutes}
              disabled={run !== null}
              onChange={(event) => {
                const minutesValue = Math.min(90, Math.max(5, Number(event.target.value) || 25));
                update((current) => ({ ...current, focusMinutes: minutesValue }));
              }}
            />
          </label>
          <label className="ap-field ap-inline">
            <span>Break</span>
            <input
              className="ap-input"
              type="number"
              min={1}
              max={30}
              value={value.breakMinutes}
              disabled={run !== null}
              onChange={(event) => {
                const minutesValue = Math.min(30, Math.max(1, Number(event.target.value) || 5));
                update((current) => ({ ...current, breakMinutes: minutesValue }));
              }}
            />
          </label>
          <span>minutes</span>
        </span>
        <section className="ap-fc-card" aria-labelledby="focus-week">
          <div className="ap-fc-head">
            <h2 id="focus-week">This week</h2>
            <span>
              {(weekMinutes / 60).toFixed(1)} hours studied · today {minutesLabel(todayMinutes)}
            </span>
          </div>
          <ol className="ap-fc-chart" aria-label="Minutes each day">
            {days.map((day, index) => (
              <li key={index} aria-label={`${day.label}: ${minutesLabel(day.minutes)}`}>
                <i style={{ height: `${String(Math.max(3, (day.minutes / busiest) * 100))}%` }} />
                <span aria-hidden="true">{day.label}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="ap-fc-card" aria-labelledby="focus-subjects-h">
          <div className="ap-fc-head">
            <h2 id="focus-subjects-h">By subject</h2>
          </div>
          {bySubject.length === 0 ? (
            <p className="ap-hint">Finish a focus session to log study time.</p>
          ) : (
            <ul className="ap-bars">
              {bySubject.map(([name, sum]) => (
                <li key={name}>
                  <span>{name}</span>
                  <span className="ap-bar" aria-hidden="true">
                    <i style={{ width: `${String(Math.max(4, (sum / most) * 100))}%` }} />
                  </span>
                  <span>{minutesLabel(sum)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <RecordStatus save={save} loaded={loaded} onRetry={() => void retry()}>
        {String(value.log.length)} sessions logged
      </RecordStatus>
    </div>
  );
}
