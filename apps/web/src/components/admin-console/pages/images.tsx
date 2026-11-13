"use client";

import type { BrowserImages } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { fetchBrowserImages } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { Card, Loading, Pill } from "../ui";

/** Browser images: what the containers run from, and which engines this installation offers. */
export function ImagesPage() {
  const [data, setData] = useState<BrowserImages | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchBrowserImages().then((result) => {
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
  if (!data) return <Loading what="images" />;
  return (
    <>
      <p className="muted" style={{ marginBottom: 16 }}>
        Each cloud browser runs from the runtime image; each session’s network leaves through the
        egress image. New versions deploy by digest with a release. Gradual rollouts by percentage
        aren’t built: every new session gets the image the hosts have.
      </p>
      <div className="card p0">
        <table>
          <thead>
            <tr>
              <th>Browser</th>
              <th>Offered here</th>
              <th>Live now</th>
              <th>Profiles using it</th>
            </tr>
          </thead>
          <tbody>
            {data.engines.map((engine) => (
              <tr key={engine.engine}>
                <td>
                  <b style={{ fontWeight: 500 }}>{engine.name}</b>
                </td>
                <td>{engine.offered ? <Pill tone="g">Yes</Pill> : <Pill>Off</Pill>}</td>
                <td>{engine.live}</td>
                <td>{engine.profiles}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="g3 grid" style={{ marginTop: 16 }}>
        <Card title="Runtime image">
          <div className="mask">{data.runtimeImage}</div>
          <div className="muted sm" style={{ marginTop: 6 }}>
            Engines, the agent, fonts, audio and video streaming (apps/runtime-agent).
          </div>
        </Card>
        <Card title="Egress image">
          <div className="mask">{data.egressImage}</div>
          <div className="muted sm" style={{ marginTop: 6 }}>
            One per session: the only way out to the internet, through the account’s proxy when set.
          </div>
        </Card>
        <Card title="API">
          <div className="mask">{data.apiVersion}</div>
          <div className="muted sm" style={{ marginTop: 6 }}>
            Browser versions inside the image are whatever it was built with; the API doesn’t read
            them at run time, so none are claimed here.
          </div>
        </Card>
      </div>
    </>
  );
}
