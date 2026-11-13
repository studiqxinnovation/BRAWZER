"use client";

import type { Fleet } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { fetchFleet } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { Card, HBar, Kpi, Loading, Pill } from "../ui";

/** Fleet: the runtime hosts the API knows, their capacity, and today's starts. One region. */
export function FleetPage() {
  const [data, setData] = useState<Fleet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchFleet().then((result) => {
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
  if (!data) return <Loading what="the fleet" />;
  const capacity = data.hosts.reduce((sum, host) => sum + host.capacity, 0);
  const used = Math.min(
    100,
    Math.round((data.live / Math.max(1, Math.min(capacity, data.maxLiveSessions))) * 100),
  );
  return (
    <>
      <div className="g4 grid" style={{ marginBottom: 16 }}>
        <Kpi
          label="Sessions in use"
          value={`${String(data.live)} / ${String(Math.min(capacity, data.maxLiveSessions))}`}
          note={`${String(used)}% of capacity`}
          tone={used > 80 ? "dn" : null}
        />
        <Kpi
          label="Median start time, 24 h"
          value={data.medianStartSeconds === null ? "—" : `${String(data.medianStartSeconds)} s`}
          note={`${String(data.startedLast24h)} started · ${String(data.failedStarts24h)} never started`}
          tone={data.failedStarts24h > 0 ? "dn" : null}
        />
        <Kpi
          label="Hosts"
          value={`${String(data.hosts.filter((host) => host.healthy).length)} healthy`}
          note={`${String(data.hosts.filter((host) => !host.healthy).length)} not answering`}
          tone={data.hosts.some((host) => !host.healthy) ? "dn" : null}
        />
        <Kpi
          label="Warm pool"
          value={String(data.warmPool.size)}
          note={`browsers ready · ${String(data.warmPool.waiting)} waiting for one`}
        />
      </div>
      <Card
        title="This installation’s region"
        right={
          <Pill tone={data.hosts.every((host) => host.healthy) ? "g" : "r"}>
            {data.hosts.every((host) => host.healthy) ? "Healthy" : "Degraded"}
          </Pill>
        }
      >
        <div className="muted sm" style={{ marginBottom: 14 }}>
          Brawzer runs where it is installed: one region, the hosts below. Adding or draining hosts
          is a hosting change (BROWSER_RUNTIME_HOSTS), not a button here, because there is no
          provider API behind it.
        </div>
        <div className="g3 grid">
          {data.hosts.map((host) => (
            <div key={host.name} className="card" style={{ margin: 0 }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <b>{host.name}</b>
                <span style={{ marginLeft: "auto" }}>
                  <Pill tone={host.healthy ? "g" : "r"}>
                    {host.healthy ? "Online" : "Unreachable"}
                  </Pill>
                </span>
              </div>
              <div className="muted sm" style={{ marginBottom: 6 }}>
                {host.live} / {host.capacity} sessions
                {host.containers !== null && host.containers !== host.live
                  ? ` · ${String(host.containers)} containers running`
                  : ""}
              </div>
              <HBar value={(host.live / Math.max(1, host.capacity)) * 100} />
            </div>
          ))}
        </div>
      </Card>
      <div className="g2 grid" style={{ marginTop: 16 }}>
        <Card title="Images in use">
          <dl className="kv">
            <dt>Runtime</dt>
            <dd className="mask">{data.runtimeImage}</dd>
            <dt>Egress</dt>
            <dd className="mask">{data.egressImage}</dd>
          </dl>
        </Card>
        <Card title="What isn’t measured yet">
          <div className="sm" style={{ lineHeight: 1.6 }}>
            Host CPU, memory and per-session frame rates aren’t collected by the API, so they aren’t
            shown. Uptime is on the status page as the health checks see it.
          </div>
        </Card>
      </div>
    </>
  );
}
