"use client";

import type { WeeklyPreview, WeeklySettings } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { fetchWeekly, sendWeeklyTest, setWeekly } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { Card, fdt, FormDialog, Loading } from "../ui";
import { useAction } from "../use-action";

/** The weekly founder email: what Monday's message says, when it goes, and to whom. */
export function WeeklyPage() {
  const me = useStaff();
  const [data, setData] = useState<WeeklyPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void fetchWeekly().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) leaveSignedInArea("expired");
        setError(result.error.message);
        return;
      }
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="warnbox">{error}</div>;
  if (!data) return <Loading what="the weekly email" />;
  const save = (settings: WeeklySettings, done: string) => {
    void action
      .run(() => setWeekly(settings), done)
      .then((result) => {
        if (result) setData(result.data);
      });
  };
  const { settings } = data;
  return (
    <div className="g21 grid">
      <Card title="Preview of Monday’s email">
        <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 24 }}>
          <div className="muted sm" style={{ marginBottom: 8 }}>
            Brawzer this week
          </div>
          <p style={{ marginBottom: 12 }}>
            Where Brawzer stands this Monday, from the console’s own figures. Nothing here is
            estimated.
          </p>
          <p style={{ marginBottom: 12 }}>
            {data.needsYou.length
              ? `Needs you: ${data.needsYou.join("; ")}.`
              : "Nothing is waiting for you in the console."}
          </p>
          <dl className="kv">
            {data.facts.map(([label, value]) => (
              <>
                <dt key={`${label}-k`}>{label}</dt>
                <dd key={`${label}-v`}>{value}</dd>
              </>
            ))}
          </dl>
        </div>
      </Card>
      <div className="stack">
        <Card title="Delivery">
          <div className="list-i sm">
            <span style={{ flex: 1 }}>Send weekly</span>
            <button
              type="button"
              role="switch"
              className="tgl"
              aria-checked={settings.on}
              aria-label="Send weekly"
              disabled={action.busy}
              onClick={() => {
                save(
                  { ...settings, on: !settings.on },
                  settings.on ? "Weekly email off" : "Weekly email on",
                );
              }}
            />
          </div>
          <div className="list-i sm">
            <span style={{ flex: 1 }}>When</span>
            <select
              className="in"
              aria-label="Hour, UTC"
              value={settings.hourUtc}
              disabled={action.busy}
              onChange={(event) => {
                save({ ...settings, hourUtc: Number(event.target.value) }, "Time changed");
              }}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  Mondays {String(hour).padStart(2, "0")}:00 UTC
                </option>
              ))}
            </select>
          </div>
          <div className="list-i sm">
            <span style={{ flex: 1 }}>Last sent</span>
            <span className="muted">{data.lastSentAt ? fdt(data.lastSentAt) : "never"}</span>
          </div>
          <div className="list-i sm">
            <span style={{ flex: 1 }}>Next</span>
            <span className="muted">
              {data.nextAt ? fdt(data.nextAt) : settings.on ? "add a recipient" : "off"}
            </span>
          </div>
          <button
            type="button"
            className="btn sm pri"
            style={{ marginTop: 12 }}
            disabled={action.busy}
            onClick={() => {
              void action.run(() => sendWeeklyTest(), `Test sent to ${me.email}`);
            }}
          >
            Send me a test now
          </button>
          {action.problem && (
            <div className="warnbox" style={{ marginTop: 10 }}>
              {action.problem}
            </div>
          )}
        </Card>
        <Card title="Recipients">
          {settings.recipients.length === 0 && <div className="muted sm">Nobody yet.</div>}
          {settings.recipients.map((recipient) => (
            <div key={recipient.email} className="list-i sm">
              <span style={{ flex: 1 }}>{recipient.email}</span>
              <span className="muted">{recipient.version === "short" ? "short" : "full"}</span>
              <button
                type="button"
                className="btn sm"
                aria-label={`Remove ${recipient.email}`}
                disabled={action.busy}
                onClick={() => {
                  save(
                    {
                      ...settings,
                      recipients: settings.recipients.filter(
                        (entry) => entry.email !== recipient.email,
                      ),
                    },
                    "Recipient removed",
                  );
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="muted sm" style={{ margin: "8px 0" }}>
            The short version carries the figures without the “needs you” list, for advisers.
          </div>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              setAdding(true);
            }}
          >
            Add a recipient
          </button>
        </Card>
      </div>
      <FormDialog
        open={adding}
        onOpenChange={(open) => {
          setAdding(open);
          if (!open) action.setProblem(null);
        }}
        title="Add a recipient"
        fields={[
          { key: "email", label: "Email", type: "email", required: true },
          {
            key: "version",
            label: "Version",
            options: [
              { value: "full", label: "Full" },
              { value: "short", label: "Short (figures only)" },
            ],
          },
        ]}
        okText="Add"
        busy={action.busy}
        error={action.problem}
        onSubmit={(values) => {
          const email = (values.email ?? "").trim().toLowerCase();
          if (!email) return;
          void action
            .run(
              () =>
                setWeekly({
                  ...settings,
                  recipients: [
                    ...settings.recipients.filter((entry) => entry.email !== email),
                    { email, version: values.version === "short" ? "short" : "full" },
                  ],
                }),
              "Recipient added",
            )
            .then((result) => {
              if (result) {
                setData(result.data);
                setAdding(false);
              }
            });
        }}
      />
    </div>
  );
}
