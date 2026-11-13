"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { type ReactNode, type SubmitEvent, useId, useState } from "react";

/* ── Formatting ── */

/* Avatar backgrounds: dark enough for white initials at 4.5:1. */
const COLORS = [
  "#8e3b46",
  "#2f5d8a",
  "#2e6b45",
  "#6b4a9b",
  "#9a5500",
  "#1f6f7a",
  "#7a3a6a",
  "#4a5a2a",
];

/** Minutes, hours or days ago (or ahead), as the prototype says it. */
/** Whole minutes between a moment and now. */
export function minutesSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
}

/** True when the moment is still ahead, but less than `ms` away. */
export function within(iso: string | null, ms: number, now = Date.now()): boolean {
  if (!iso) return false;
  const delta = Date.parse(iso) - now;
  return delta > 0 && delta < ms;
}

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const seconds = (now - Date.parse(iso)) / 1000;
  if (seconds < 0) {
    const ahead = -seconds;
    if (ahead < 3600) return `in ${String(Math.ceil(ahead / 60))}m`;
    if (ahead < 86400) return `in ${String(Math.floor(ahead / 3600))}h`;
    return `in ${String(Math.floor(ahead / 86400))}d`;
  }
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))}m ago`;
  if (seconds < 86400) return `${String(Math.floor(seconds / 3600))}h ago`;
  return `${String(Math.floor(seconds / 86400))}d ago`;
}

export const fdate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const fdt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function fsize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function fmtMinutes(minutes: number): string {
  if (minutes < 60) return `${String(minutes)}m`;
  if (minutes < 1440) return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
  return `${String(Math.floor(minutes / 1440))}d ${String(Math.floor((minutes % 1440) / 60))}h`;
}

/** Money from minor units, in the price's currency. */
export function money(amount: number, currency: string, cents = false): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: cents ? 2 : 0,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(cents ? 2 : 0)} ${currency.toUpperCase()}`;
  }
}

export const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

/* ── Pieces ── */

/** The prototype's avatar: initials on a colour that follows the name. */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const initials = name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="av"
      aria-hidden="true"
      style={{
        background: COLORS[hash % COLORS.length],
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
      }}
    >
      {initials}
    </span>
  );
}

export type Tone = "g" | "o" | "r" | "b" | "p" | "";

export function Pill({ tone = "", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`pill ${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, [string, Tone]> = {
  active: ["Active", "g"],
  past_due: ["Past due", "o"],
  locked: ["Locked", "r"],
  suspended: ["Suspended", "r"],
  unverified: ["Not confirmed", "o"],
};

export function StatusPill({ status }: { status: string }) {
  const [label, tone] = STATUS_TONE[status] ?? [status, ""];
  return <Pill tone={tone}>{label}</Pill>;
}

export function Card({
  title,
  right,
  flush = false,
  className = "",
  children,
}: {
  title?: ReactNode;
  right?: ReactNode;
  /** No padding: a table fills it. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card ${flush ? "p0" : ""} ${className}`}>
      {title !== undefined && (
        <div className="ch">
          <h2>{title}</h2>
          {right && <div className="r">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "up" | "dn" | null;
}) {
  return (
    <section className="card kpi" aria-label={label}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {note !== undefined && <div className={`d ${tone ?? "muted"}`}>{note}</div>}
    </section>
  );
}

export function HBar({ value, colour }: { value: number; colour?: string }) {
  const width = Math.min(100, Math.max(0, value));
  const fill =
    colour ?? (width > 90 ? "var(--red)" : width > 75 ? "var(--orange)" : "var(--green)");
  return (
    <div className="bar" role="presentation">
      <i style={{ width: `${width.toFixed(1)}%`, background: fill }} />
    </div>
  );
}

export function Tabs<Key extends string>({
  tabs,
  current,
  onChange,
  label,
}: {
  tabs: readonly { key: Key; label: string; count?: number | null }[];
  current: Key;
  onChange: (key: Key) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === current}
          onClick={() => {
            onChange(tab.key);
          }}
        >
          {tab.label}
          {tab.count !== undefined && tab.count !== null && <span className="ct">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading({ what }: { what: string }) {
  return (
    <div className="empty" role="status">
      Loading {what}…
    </div>
  );
}

/* ── Charts, as the prototype draws them, inline ── */

export function LineChart({
  series,
  height = 200,
  zero = false,
  format,
}: {
  series: readonly { name?: string; colour: string; points: readonly [string, number][] }[];
  height?: number;
  zero?: boolean;
  format?: (value: number) => string;
}) {
  const first = series[0];
  if (!first || first.points.length < 2) return <Empty>Not enough data yet</Empty>;
  const W = 640;
  const H = height;
  const P = 30;
  const all = series.flatMap((s) => s.points.map((p) => p[1]));
  const max = Math.max(...all) * 1.1 || 1;
  const min = zero ? 0 : Math.min(...all) * 0.9;
  const n = first.points.length;
  const X = (i: number) => P + (i * (W - P * 2)) / (n - 1);
  const Y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - P * 2);
  const label = format ?? ((v: number) => String(Math.round(v)));
  return (
    <>
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        width="100%"
        style={{ display: "block" }}
        role="img"
        aria-label={series.map((s) => s.name ?? "series").join(", ")}
      >
        {[0, 0.5, 1].map((f) => {
          const v = min + (max - min) * f;
          return (
            <g key={f}>
              <line x1={P} x2={W - P} y1={Y(v)} y2={Y(v)} stroke="var(--line)" />
              <text x={P - 6} y={Y(v) + 4} fontSize="10" textAnchor="end" fill="var(--sub)">
                {label(v)}
              </text>
            </g>
          );
        })}
        {series.map((s, index) => {
          const d = s.points
            .map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p[1]).toFixed(1)}`)
            .join(" ");
          return (
            <g key={s.name ?? index}>
              {index === 0 && (
                <path
                  d={`${d} L${String(X(n - 1))} ${String(H - P)} L${String(X(0))} ${String(H - P)}Z`}
                  fill={s.colour}
                  opacity=".08"
                />
              )}
              <path d={d} fill="none" stroke={s.colour} strokeWidth="2.2" strokeLinejoin="round" />
            </g>
          );
        })}
        {first.points.map((p, i) => (
          <text key={i} x={X(i)} y={H - 8} fontSize="10" textAnchor="middle" fill="var(--sub)">
            {p[0]}
          </text>
        ))}
      </svg>
      {series.length > 1 && (
        <div className="row sm" style={{ gap: 14, marginTop: 4 }}>
          {series.map((s) => (
            <span key={s.name} className="row" style={{ gap: 5 }}>
              <span className="sw" style={{ background: s.colour }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function Bars({
  rows,
  format,
}: {
  rows: readonly [string, number, string?][];
  format?: (value: number) => string;
}) {
  const max = Math.max(1, ...rows.map((row) => row[1]));
  return (
    <div>
      {rows.map((row) => (
        <div key={row[0]} style={{ margin: "9px 0" }}>
          <div className="row sm" style={{ justifyContent: "space-between", marginBottom: 4 }}>
            <span>{row[0]}</span>
            <span className="muted">{format ? format(row[1]) : row[1]}</span>
          </div>
          <div className="bar">
            <i
              style={{
                width: `${((row[1] / max) * 100).toFixed(1)}%`,
                ...(row[2] ? { background: row[2] } : {}),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Dialogs: the prototype's confirm box and form, drawn with the UI kit's dialog ── */

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  text,
  okText,
  danger = false,
  reason = true,
  typeToConfirm,
  busy = false,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  text: ReactNode;
  okText: string;
  danger?: boolean;
  /** Ask for a reason, saved to the audit log. */
  reason?: boolean;
  /** A word to type before the action goes ahead. */
  typeToConfirm?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
}) {
  const [why, setWhy] = useState("");
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const reasonId = useId();
  const typeId = useId();
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reason && why.trim().length < 4) {
      setProblem("Please give a reason.");
      return;
    }
    if (typeToConfirm && typed.trim() !== typeToConfirm) {
      setProblem("That doesn’t match.");
      return;
    }
    setProblem(null);
    onConfirm(why.trim());
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setWhy("");
          setTyped("");
          setProblem(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="adm-modal w-[min(460px,92vw)]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{text}</DialogDescription>
        <form method="post" onSubmit={submit} className="stack" style={{ marginTop: 14 }}>
          {reason && (
            <div className="fld">
              <label htmlFor={reasonId}>Reason (required, saved to the audit log)</label>
              <textarea
                id={reasonId}
                className="in"
                rows={2}
                value={why}
                onChange={(event) => {
                  setWhy(event.target.value);
                }}
              />
            </div>
          )}
          {typeToConfirm && (
            <div className="fld">
              <label htmlFor={typeId}>
                Type <b>{typeToConfirm}</b> to confirm
              </label>
              <input
                id={typeId}
                className="in"
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                }}
              />
            </div>
          )}
          <div className="sm" style={{ color: "var(--red)", minHeight: 16 }} role="alert">
            {problem ?? error ?? ""}
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </button>
            <button type="submit" className={`btn ${danger ? "dng" : "pri"}`} disabled={busy}>
              {okText}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface FormFieldSpec {
  key: string;
  label: string;
  type?: "text" | "email" | "number" | "date";
  area?: boolean;
  rows?: number;
  options?: readonly { value: string; label: string }[];
  value?: string;
  placeholder?: string;
  required?: boolean;
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  intro,
  fields,
  okText,
  busy = false,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  intro?: ReactNode;
  fields: readonly FormFieldSpec[];
  okText: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const prefix = useId();
  const valueOf = (field: FormFieldSpec) =>
    values[field.key] ?? field.value ?? field.options?.[0]?.value ?? "";
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const out: Record<string, string> = {};
    for (const field of fields) out[field.key] = valueOf(field).trim();
    const missing = fields.find((field) => field.required && !out[field.key]);
    if (missing) {
      setProblem(`${missing.label} is required.`);
      return;
    }
    setProblem(null);
    onSubmit(out);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setValues({});
          setProblem(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className={`adm-modal ${fields.length > 4 ? "w-[min(620px,94vw)]" : "w-[min(460px,92vw)]"}`}
      >
        <DialogTitle>{title}</DialogTitle>
        {intro ? (
          <DialogDescription>{intro}</DialogDescription>
        ) : (
          <DialogDescription className="sr-only">{title}</DialogDescription>
        )}
        <form method="post" onSubmit={submit} className="stack" style={{ marginTop: 12 }}>
          {fields.map((field) => {
            const id = `${prefix}-${field.key}`;
            const set = (value: string) => {
              setValues((current) => ({ ...current, [field.key]: value }));
            };
            return (
              <div className="fld" key={field.key}>
                <label htmlFor={id}>{field.label}</label>
                {field.options ? (
                  <select
                    id={id}
                    className="in"
                    value={valueOf(field)}
                    onChange={(e) => set(e.target.value)}
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.area ? (
                  <textarea
                    id={id}
                    className="in"
                    rows={field.rows ?? 3}
                    value={valueOf(field)}
                    onChange={(e) => set(e.target.value)}
                  />
                ) : (
                  <input
                    id={id}
                    className="in"
                    type={field.type ?? "text"}
                    value={valueOf(field)}
                    placeholder={field.placeholder}
                    onChange={(e) => set(e.target.value)}
                  />
                )}
              </div>
            );
          })}
          <div className="sm" style={{ color: "var(--red)", minHeight: 16 }} role="alert">
            {problem ?? error ?? ""}
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn pri" disabled={busy}>
              {okText}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
