"use client";

import { can, type ComplianceList } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import {
  addComplianceItem,
  fetchCompliance,
  removeComplianceItem,
  toggleComplianceItem,
} from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { ago, Card, FormDialog, HBar, Loading } from "../ui";
import { useAction } from "../use-action";

/** Compliance: the controls the team keeps itself honest about, grouped, with who ticked what when. */
export function CompliancePage() {
  const me = useStaff();
  const [data, setData] = useState<ComplianceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void fetchCompliance().then((result) => {
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
  if (!data) return <Loading what="the checklist" />;
  const may = can(me.role, "dsar");
  const frameworks = [...new Set(data.items.map((item) => item.framework))];
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted sm">
          A checklist, not a certificate: tick what is true, and the audit log keeps who ticked it.
          Policies and training records live in your document store, not here.
        </span>
        {may && (
          <button
            type="button"
            className="btn sm"
            style={{ marginLeft: "auto" }}
            onClick={() => {
              setAdding(true);
            }}
          >
            Add a control
          </button>
        )}
      </div>
      <div className="g3 grid">
        {frameworks.map((framework) => {
          const items = data.items.filter((item) => item.framework === framework);
          const done = items.filter((item) => item.done).length;
          const percent = Math.round((done / Math.max(1, items.length)) * 100);
          return (
            <Card key={framework} title={framework} right={<b>{percent}%</b>}>
              <div style={{ marginBottom: 14 }}>
                <HBar value={percent} />
              </div>
              {items.map((item) => (
                <div key={item.id} className="list-i sm" style={{ alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    id={`control-${item.id}`}
                    checked={item.done}
                    disabled={!may || action.busy}
                    style={{ accentColor: "var(--green)", width: 16, height: 16, marginTop: 2 }}
                    onChange={(event) => {
                      void action
                        .run(() => toggleComplianceItem(item.id, event.target.checked), null)
                        .then((result) => {
                          if (result) setData(result.data);
                        });
                    }}
                  />
                  <label
                    htmlFor={`control-${item.id}`}
                    style={{ flex: 1, fontWeight: item.done ? 400 : 500 }}
                  >
                    {item.item}
                    {item.done && item.doneBy && (
                      <div className="muted" style={{ fontWeight: 400 }}>
                        {item.doneBy} · {ago(item.doneAt)}
                      </div>
                    )}
                  </label>
                  {may && (
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={`Remove “${item.item}”`}
                      onClick={() => {
                        void action
                          .run(() => removeComplianceItem(item.id), "Control removed")
                          .then((result) => {
                            if (result) setData(result.data);
                          });
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </Card>
          );
        })}
      </div>
      <FormDialog
        open={adding}
        onOpenChange={(open) => {
          setAdding(open);
          if (!open) action.setProblem(null);
        }}
        title="Add a control"
        fields={[
          {
            key: "framework",
            label: "Group",
            required: true,
            placeholder: "e.g. Access",
            value: frameworks[0] ?? "",
          },
          { key: "item", label: "What must be true", required: true },
        ]}
        okText="Add"
        busy={action.busy}
        error={action.problem}
        onSubmit={(values) => {
          void action
            .run(
              () =>
                addComplianceItem({ framework: values.framework ?? "", item: values.item ?? "" }),
              "Control added",
            )
            .then((result) => {
              if (result) {
                setData(result.data);
                setAdding(false);
              }
            });
        }}
      />
    </>
  );
}
