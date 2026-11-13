"use client";

import { can, type Goal, type GoalList, goalUnits } from "@brawzer/contracts";
import { useEffect, useState, useSyncExternalStore } from "react";
import { addGoal, fetchGoals, removeGoal, updateGoal } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { Avatar, fdate, FormDialog, HBar, Loading, Pill, ReasonDialog } from "../ui";
import { useAction } from "../use-action";

const subscribeToClock = (listener: () => void) => {
  const timer = setInterval(listener, 60_000);
  return () => {
    clearInterval(timer);
  };
};
const clockNow = () => Math.floor(Date.now() / 60_000) * 60_000;
const clockOnServer = () => 0;

const QUARTER_DAYS = 92;

function format(goal: Goal, value: number): string {
  if (goal.unit === "GBP") return `£${value.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
  if (goal.unit === "%") return `${String(value)}%`;
  if (goal.unit === "min") return `${String(value)} min`;
  return value.toLocaleString("en-GB");
}

function progress(goal: Goal): number {
  if (goal.lowerIsBetter) {
    if (goal.current <= goal.target) return 100;
    return Math.max(0, Math.round((goal.target / Math.max(goal.current, 1)) * 100));
  }
  return goal.target ? Math.min(100, Math.round((goal.current / goal.target) * 100)) : 0;
}

/** This quarter's goals: a number, a target, who owns it, and where you'd be if progress were even. */
export function GoalsPage() {
  const me = useStaff();
  const now = useSyncExternalStore(subscribeToClock, clockNow, clockOnServer);
  const [data, setData] = useState<GoalList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [removing, setRemoving] = useState<Goal | null>(null);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void fetchGoals().then((result) => {
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
  if (!data) return <Loading what="goals" />;
  const mayUpdate = can(me.role, "goals");
  const mayManage = can(me.role, "staff");
  const quarterGone = (goal: Goal) => {
    if (!now) return 0;
    const end = Date.parse(goal.quarterEnd);
    const start = end - QUARTER_DAYS * 86_400_000;
    return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <span className="muted">
          Goals are numbers you set yourselves; Brawzer doesn’t guess them. The thin line on each
          bar shows where you’d be if progress were even across the quarter.
        </span>
        {mayManage && (
          <button
            type="button"
            className="btn pri sm"
            style={{ marginLeft: "auto" }}
            onClick={() => {
              setAdding(true);
            }}
          >
            Add goal
          </button>
        )}
      </div>
      <div className="g2 grid">
        {data.goals.length === 0 && <div className="card empty">No goals yet</div>}
        {data.goals.map((goal) => {
          const p = progress(goal);
          const gone = quarterGone(goal);
          const onTrack = p >= gone - 10;
          return (
            <div key={goal.id} className="card">
              <div className="ch">
                <h2>{goal.name}</h2>
                <div className="r">
                  {p >= 100 ? (
                    <Pill tone="g">Achieved</Pill>
                  ) : onTrack ? (
                    <Pill tone="b">On track</Pill>
                  ) : (
                    <Pill tone="o">Behind</Pill>
                  )}
                </div>
              </div>
              <div className="row" style={{ alignItems: "flex-end", gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 26, fontWeight: 600 }}>{format(goal, goal.current)}</div>
                <div className="muted" style={{ paddingBottom: 4 }}>
                  of {format(goal, goal.target)}
                  {goal.lowerIsBetter ? " (lower is better)" : ""}
                </div>
              </div>
              <div style={{ position: "relative" }}>
                <HBar value={p} />
                <div
                  aria-hidden="true"
                  title="Where you should be by now"
                  style={{
                    position: "absolute",
                    top: -3,
                    left: `${String(gone)}%`,
                    width: 2,
                    height: 12,
                    background: "var(--text)",
                    opacity: 0.4,
                  }}
                />
              </div>
              <div className="row sm muted" style={{ marginTop: 8 }}>
                {goal.owner && (
                  <>
                    <Avatar name={goal.owner} size={20} />
                    {goal.owner}
                  </>
                )}
                <span>quarter ends {fdate(goal.quarterEnd)}</span>
                <span style={{ marginLeft: "auto" }}>{p}%</span>
                {mayUpdate && (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setEditing(goal);
                    }}
                  >
                    Update
                  </button>
                )}
                {mayManage && (
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={`Remove “${goal.name}”`}
                    onClick={() => {
                      setRemoving(goal);
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <FormDialog
        open={adding}
        onOpenChange={(open) => {
          setAdding(open);
          if (!open) action.setProblem(null);
        }}
        title="New goal"
        fields={[
          { key: "name", label: "Goal", required: true, placeholder: "e.g. Paying accounts" },
          { key: "current", label: "Current value", type: "number", value: "0" },
          { key: "target", label: "Target", type: "number", required: true },
          {
            key: "unit",
            label: "Unit",
            options: goalUnits.map((unit) => ({ value: unit, label: unit || "a count" })),
          },
          {
            key: "lower",
            label: "Direction",
            options: [
              { value: "higher", label: "Higher is better" },
              { value: "lower", label: "Lower is better" },
            ],
          },
          { key: "quarterEnd", label: "Quarter ends", type: "date", required: true },
        ]}
        okText="Add"
        busy={action.busy}
        error={action.problem}
        onSubmit={(values) => {
          void action
            .run(
              () =>
                addGoal({
                  name: values.name ?? "",
                  current: Number(values.current ?? 0),
                  target: Number(values.target ?? 0),
                  unit: (values.unit ?? "") as Goal["unit"],
                  lowerIsBetter: values.lower === "lower",
                  ownerId: me.id,
                  quarterEnd: new Date(`${values.quarterEnd ?? ""}T23:59:59`).toISOString(),
                }),
              "Goal added",
            )
            .then((result) => {
              if (result) {
                setData(result.data);
                setAdding(false);
              }
            });
        }}
      />
      {editing && (
        <FormDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
              action.setProblem(null);
            }
          }}
          title={`Update ${editing.name}`}
          fields={[
            {
              key: "current",
              label: "Current value",
              type: "number",
              value: String(editing.current),
              required: true,
            },
            {
              key: "target",
              label: "Target",
              type: "number",
              value: String(editing.target),
              required: true,
            },
          ]}
          okText="Save"
          busy={action.busy}
          error={action.problem}
          onSubmit={(values) => {
            const goal = editing;
            void action
              .run(
                () =>
                  updateGoal(goal.id, {
                    current: Number(values.current ?? 0),
                    target: Number(values.target ?? goal.target),
                  }),
                "Goal updated",
              )
              .then((result) => {
                if (result) {
                  setData(result.data);
                  setEditing(null);
                }
              });
          }}
        />
      )}
      {removing && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
          title={`Remove “${removing.name}”?`}
          text="It disappears from everyone’s Goals page."
          okText="Remove"
          danger
          reason={false}
          busy={action.busy}
          error={action.problem}
          onConfirm={() => {
            const goal = removing;
            void action
              .run(() => removeGoal(goal.id), "Goal removed")
              .then((result) => {
                if (result) {
                  setData(result.data);
                  setRemoving(null);
                }
              });
          }}
        />
      )}
    </>
  );
}
