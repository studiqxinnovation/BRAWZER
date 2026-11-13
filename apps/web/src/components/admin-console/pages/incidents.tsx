"use client";

import {
  can,
  type Incident,
  type IncidentSeverity,
  incidentSeverities,
  incidentSeverityNames,
  type IncidentStatus,
  incidentStatuses,
  incidentStatusNames,
  type PublicStatus,
  type StatusComponent,
  statusComponentNames,
  statusComponents,
} from "@brawzer/contracts";
import { useEffect, useState } from "react";
import {
  declareIncident,
  fetchIncidents,
  fetchPublicStatus,
  postIncidentUpdate,
} from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { ago, Card, fdt, FormDialog, Loading, Pill } from "../ui";
import { useAction } from "../use-action";

const SEV_TONE: Record<IncidentSeverity, "r" | "o" | "b"> = { sev1: "r", sev2: "o", sev3: "b" };
const SEV_SHORT: Record<IncidentSeverity, string> = { sev1: "SEV-1", sev2: "SEV-2", sev3: "SEV-3" };
const STATE_TONE: Record<PublicStatus["components"][number]["state"], "g" | "o" | "r"> = {
  operational: "g",
  incident: "o",
  degraded: "o",
  down: "r",
};
const STATE_NAME: Record<PublicStatus["components"][number]["state"], string> = {
  operational: "Operational",
  incident: "Incident",
  degraded: "Degraded",
  down: "Down",
};

/** Incidents and the status page: declare, update, resolve; what the public page shows right now. */
export function IncidentsPage() {
  const me = useStaff();
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [version, setVersion] = useState(0);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchIncidents(), fetchPublicStatus()]).then(([list, pub]) => {
      if (cancelled) return;
      if (!list.ok) {
        if (list.status === 401) leaveSignedInArea("expired");
        setError(list.error.message);
        return;
      }
      setIncidents(list.data.incidents);
      if (pub.ok) setStatus(pub.data);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (error) return <div className="warnbox">{error}</div>;
  if (!incidents) return <Loading what="incidents" />;
  const may = can(me.role, "incident");
  const changed = (incident: Incident) => {
    setIncidents((current) =>
      current
        ? current.some((entry) => entry.id === incident.id)
          ? current.map((entry) => (entry.id === incident.id ? incident : entry))
          : [incident, ...current]
        : [incident],
    );
    setVersion((current) => current + 1);
  };
  return (
    <div className="g21 grid">
      <div>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="muted sm">
            Public incidents appear on /status and as a banner inside Brawzer until resolved.
          </span>
          {may && (
            <button
              type="button"
              className="btn pri sm"
              style={{ marginLeft: "auto" }}
              onClick={() => {
                setDeclaring(true);
              }}
            >
              Declare incident
            </button>
          )}
        </div>
        {incidents.length === 0 && <div className="card empty">No incidents declared</div>}
        {incidents.map((incident) => (
          <IncidentCard key={incident.id} incident={incident} may={may} onChange={changed} />
        ))}
      </div>
      <div className="stack">
        <Card title="Status page, right now">
          {!status ? (
            <div className="muted sm">Couldn’t read /status</div>
          ) : (
            <>
              {status.components.map((component) => (
                <div key={component.key} className="list-i sm">
                  <span style={{ flex: 1 }}>{component.name}</span>
                  <Pill tone={STATE_TONE[component.state]}>{STATE_NAME[component.state]}</Pill>
                </div>
              ))}
              <div className="muted sm" style={{ marginTop: 10 }}>
                States come from the API’s own health checks (database, cache, store, scanner,
                runtime) and from open public incidents. Checked {ago(status.generatedAt)}.
              </div>
            </>
          )}
        </Card>
        <Card title="Planned maintenance">
          {!status || status.maintenance.length === 0 ? (
            <div className="muted sm">
              None. Maintenance is announced from In-app announcements with the type “Maintenance”;
              it shows here and on /status.
            </div>
          ) : (
            status.maintenance.map((entry) => (
              <div key={entry.id} className="list-i sm" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <b style={{ fontWeight: 500 }}>{entry.title}</b>
                  <div className="muted">
                    {fdt(entry.startsAt)}
                    {entry.endsAt ? ` → ${fdt(entry.endsAt)}` : ""}
                  </div>
                </div>
              </div>
            ))
          )}
        </Card>
      </div>

      <FormDialog
        open={declaring}
        onOpenChange={(open) => {
          setDeclaring(open);
          if (!open) action.setProblem(null);
        }}
        title="Declare an incident"
        intro="Say what people see, not what you suspect. A public incident goes on /status and into a banner for everyone right away."
        fields={[
          { key: "title", label: "What’s happening?", required: true },
          {
            key: "severity",
            label: "Severity",
            options: incidentSeverities.map((severity) => ({
              value: severity,
              label: incidentSeverityNames[severity],
            })),
            value: "sev3",
          },
          {
            key: "component",
            label: "Part affected",
            options: [
              { value: "", label: "Not one part in particular" },
              ...statusComponents.map((key) => ({ value: key, label: statusComponentNames[key] })),
            ],
          },
          {
            key: "isPublic",
            label: "Public?",
            options: [
              { value: "yes", label: "Yes: status page and in-app banner" },
              { value: "no", label: "No: internal only" },
            ],
          },
          {
            key: "body",
            label: "First update",
            area: true,
            required: true,
            placeholder: "We’re looking into slow starts for cloud browsers.",
          },
        ]}
        okText="Declare"
        busy={action.busy}
        error={action.problem}
        onSubmit={(values) => {
          void action
            .run(
              () =>
                declareIncident({
                  title: values.title ?? "",
                  severity: (values.severity ?? "sev3") as IncidentSeverity,
                  components: values.component ? [values.component as StatusComponent] : [],
                  isPublic: values.isPublic !== "no",
                  body: values.body ?? "",
                }),
              "Incident declared",
            )
            .then((result) => {
              if (result) {
                setDeclaring(false);
                changed(result.data);
              }
            });
        }}
      />
    </div>
  );
}

function IncidentCard({
  incident,
  may,
  onChange,
}: {
  incident: Incident;
  may: boolean;
  onChange: (incident: Incident) => void;
}) {
  const action = useAction();
  const [text, setText] = useState("");
  const [next, setNext] = useState<IncidentStatus>(incident.status);
  const open = incident.status !== "resolved";
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="ch">
        <Pill tone={SEV_TONE[incident.severity]}>{SEV_SHORT[incident.severity]}</Pill>
        <h2>{incident.title}</h2>
        <div className="r">
          <Pill tone={open ? "o" : "g"}>{incidentStatusNames[incident.status]}</Pill>
        </div>
      </div>
      <div className="row sm muted" style={{ marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <span>Started {fdt(incident.startedAt)}</span>
        {incident.owner && <span>Owner {incident.owner}</span>}
        <span>{incident.isPublic ? "Public" : "Internal"}</span>
        {incident.components.length > 0 && (
          <span>{incident.components.map((key) => statusComponentNames[key]).join(", ")}</span>
        )}
        {incident.resolvedAt && <span>Resolved {fdt(incident.resolvedAt)}</span>}
      </div>
      <div className="tl">
        {incident.updates.map((update) => (
          <div key={update.id} className="e">
            <div>
              <b style={{ fontWeight: 500 }}>{incidentStatusNames[update.status]}</b> ·{" "}
              {update.body}
            </div>
            <div className="muted">
              {fdt(update.at)}
              {update.author ? ` · ${update.author}` : ""}
            </div>
          </div>
        ))}
      </div>
      {open && may && (
        <div className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
          <input
            className="in"
            aria-label={`Update on ${incident.title}`}
            placeholder="Post an update"
            style={{ flex: 1, minWidth: 200 }}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          <select
            className="in"
            aria-label="New status"
            value={next}
            onChange={(event) => {
              setNext(event.target.value as IncidentStatus);
            }}
          >
            {incidentStatuses.map((status) => (
              <option key={status} value={status}>
                {incidentStatusNames[status]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn sm pri"
            disabled={action.busy || text.trim().length < 3}
            onClick={() => {
              void action
                .run(
                  () => postIncidentUpdate(incident.id, { status: next, body: text.trim() }),
                  next === "resolved" ? "Resolved. Its banner is off." : "Update posted",
                )
                .then((result) => {
                  if (result) {
                    setText("");
                    onChange(result.data);
                  }
                });
            }}
          >
            Post
          </button>
          {action.problem && (
            <div className="warnbox" style={{ width: "100%" }}>
              {action.problem}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
