"use client";

import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { Pause, Play, RotateCcw } from "lucide-react";
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

type Mode = "focus" | "break";
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
  const tick = useSyncExternalStore(second, now, () => 0);
  const mode = run?.mode ?? "focus";
  const total = (mode === "focus" ? value.focusMinutes : value.breakMinutes) * 60_000;
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
  const progress = total === 0 ? 0 : 1 - left / total;
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

  return (
    <div className="ap-body">
      <div className="ap-main ap-focus">
        <div
          className="ap-focus-ring"
          style={{ "--ap-progress": String(progress) } as React.CSSProperties}
        >
          <span className="ap-focus-mode">{mode === "focus" ? "Focus" : "Break"}</span>
          <span className="ap-focus-time" role="timer" aria-label="Time left">
            {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </span>
        </div>
        <label className="ap-field ap-focus-subject">
          <span>Subject</span>
          <input
            className="ap-input"
            list="focus-subjects"
            value={subject}
            placeholder="What are you studying?"
            onChange={(event) => {
              setSubject(event.target.value);
            }}
          />
          <datalist id="focus-subjects">
            {subjects.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              if (running) setRun({ mode, paused: left });
              else setRun({ mode, endsAt: Date.now() + left });
            }}
          >
            {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {running ? "Pause" : run ? "Resume" : "Start"}
          </Button>
          <Button
            size="lg"
            disabled={run === null}
            onClick={() => {
              setRun(null);
            }}
          >
            <RotateCcw aria-hidden="true" />
            Reset
          </Button>
        </div>
        <div className="ap-focus-lengths">
          <label className="ap-field">
            <span>Focus (minutes)</span>
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
          <label className="ap-field">
            <span>Break (minutes)</span>
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
        </div>
        <section className="ap-card ap-focus-stats" aria-labelledby="focus-week">
          <h2 id="focus-week" className="ap-group-title">
            This week{" "}
            <span>{minutesLabel(week.reduce((sum, entry) => sum + entry.minutes, 0))}</span>
          </h2>
          <p className="text-footnote text-ink-secondary">Today: {minutesLabel(todayMinutes)}</p>
          {bySubject.length === 0 ? (
            <p className="text-footnote text-ink-secondary">
              Finished focus sessions are logged here by subject.
            </p>
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
