import { type PublicStatus, publicStatusSchema } from "@brawzer/contracts";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Container, PageHero } from "@/components/site/layout-primitives";

export const metadata: Metadata = {
  title: "Status",
  description: "Whether Brawzer is working right now, open incidents and planned maintenance.",
  alternates: { canonical: "/status" },
};

const apiOrigin = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100";

const STATE: Record<PublicStatus["overall"], { label: string; dot: string }> = {
  operational: { label: "All systems operational", dot: "bg-emerald-500" },
  incident: { label: "An incident is open", dot: "bg-amber-500" },
  degraded: { label: "Some parts are degraded", dot: "bg-amber-500" },
  down: { label: "Some parts are down", dot: "bg-danger" },
};
const COMPONENT_STATE: Record<PublicStatus["components"][number]["state"], string> = {
  operational: "Operational",
  incident: "Incident",
  degraded: "Degraded",
  down: "Down",
};
const SEVERITY: Record<PublicStatus["incidents"][number]["severity"], string> = {
  sev1: "Everyone affected",
  sev2: "Many affected",
  sev3: "Some people affected",
};
const STATUS: Record<PublicStatus["incidents"][number]["status"], string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

const when = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

async function readStatus(): Promise<PublicStatus | null> {
  try {
    const response = await fetch(`${apiOrigin}/api/v1/status`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return publicStatusSchema.parse(await response.json());
  } catch {
    return null;
  }
}

/** The public status page: what the health checks and the team's incidents say right now. */
export default async function StatusPage() {
  await connection();
  const status = await readStatus();
  return (
    <>
      <PageHero
        eyebrow="Status"
        title={status ? STATE[status.overall].label : "Status unavailable"}
        lede={
          status
            ? `Checked ${when.format(new Date(status.generatedAt))}. Incidents are posted here by Brawzer’s team as they happen.`
            : "Brawzer’s API couldn’t be reached from this page. If you can’t sign in either, we are looking into it."
        }
      />
      {status && (
        <Container className="pb-20">
          <section aria-labelledby="components" className="rounded-2xl border border-line">
            <h2 id="components" className="sr-only">
              Parts of Brawzer
            </h2>
            <ul className="divide-y divide-line">
              {status.components.map((component) => (
                <li key={component.key} className="flex items-center gap-3 px-5 py-4">
                  <span
                    aria-hidden="true"
                    className={`size-2.5 rounded-full ${component.state === "operational" ? "bg-emerald-500" : component.state === "down" ? "bg-danger" : "bg-amber-500"}`}
                  />
                  <span className="flex-1 text-ink">{component.name}</span>
                  <span className="text-sm text-ink-muted">{COMPONENT_STATE[component.state]}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="incidents" className="mt-12">
            <h2 id="incidents" className="text-title-3 text-ink">
              Incidents
            </h2>
            {status.incidents.length === 0 ? (
              <p className="text-ink-muted mt-3">
                No incidents open, and none resolved in the last 7 days.
              </p>
            ) : (
              <ol className="mt-4 flex flex-col gap-6">
                {status.incidents.map((incident) => (
                  <li key={incident.id} className="rounded-2xl border border-line p-5">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 className="text-base font-semibold text-ink">{incident.title}</h3>
                      <span className="text-sm text-ink-muted">
                        {SEVERITY[incident.severity]} · {STATUS[incident.status]}
                      </span>
                    </div>
                    {incident.components.length > 0 && (
                      <p className="text-sm text-ink-muted mt-1">
                        Affects:{" "}
                        {incident.components
                          .map((key) => status.components.find((c) => c.key === key)?.name ?? key)
                          .join(", ")}
                      </p>
                    )}
                    <ol className="mt-4 flex flex-col gap-3 border-l border-line pl-4">
                      {[...incident.updates].reverse().map((update) => (
                        <li key={update.id} className="text-sm">
                          <p className="text-ink">
                            <span className="font-medium">{STATUS[update.status]}</span> ·{" "}
                            {update.body}
                          </p>
                          <p className="text-ink-muted">{when.format(new Date(update.at))}</p>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="maintenance" className="mt-12">
            <h2 id="maintenance" className="text-title-3 text-ink">
              Planned maintenance
            </h2>
            {status.maintenance.length === 0 ? (
              <p className="text-ink-muted mt-3">Nothing planned.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-4">
                {status.maintenance.map((entry) => (
                  <li key={entry.id} className="rounded-2xl border border-line p-5">
                    <h3 className="text-base font-semibold text-ink">{entry.title}</h3>
                    <p className="text-sm text-ink-muted mt-1">{entry.body}</p>
                    <p className="text-sm text-ink-muted mt-2">
                      {when.format(new Date(entry.startsAt))}
                      {entry.endsAt ? ` to ${when.format(new Date(entry.endsAt))}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Container>
      )}
    </>
  );
}
