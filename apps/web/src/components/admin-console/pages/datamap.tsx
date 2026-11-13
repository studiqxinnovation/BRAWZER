"use client";

import type { DataMap } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { fetchDataMap } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { Card, Loading, Pill } from "../ui";

/** Data map & suppliers: where customers' data goes and for how long, from what is configured. */
export function DataMapPage() {
  const [data, setData] = useState<DataMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchDataMap().then((result) => {
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
  if (!data) return <Loading what="the data map" />;
  return (
    <>
      <p className="muted" style={{ marginBottom: 16 }}>
        Built from this installation’s configuration and the code’s own retention rules, so it is
        what Brawzer does, not what a document says it does. Agreements with suppliers are yours to
        sign and file.
      </p>
      <div className="g2 grid">
        <Card title="Suppliers that handle customer data" flush>
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>What for</th>
                <th>What reaches them</th>
                <th>Where</th>
                <th>In use</th>
              </tr>
            </thead>
            <tbody>
              {data.suppliers.map((supplier) => (
                <tr key={supplier.name}>
                  <td>
                    <b style={{ fontWeight: 500 }}>{supplier.name}</b>
                  </td>
                  <td className="sm">{supplier.purpose}</td>
                  <td className="sm">{supplier.data}</td>
                  <td className="sm muted mask">{supplier.where ?? "—"}</td>
                  <td>
                    {supplier.configured ? <Pill tone="g">Yes</Pill> : <Pill>Not configured</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="How long we keep data" flush>
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th style={{ textAlign: "right" }}>Kept for</th>
              </tr>
            </thead>
            <tbody>
              {data.retention.map((row) => (
                <tr key={row.data}>
                  <td>{row.data}</td>
                  <td className="muted" style={{ textAlign: "right" }}>
                    {row.keptFor}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Card title="Where customer data lives" flush>
        <table>
          <tbody>
            {data.locations.map((row) => (
              <tr key={row.data}>
                <td>{row.data}</td>
                <td className="muted mask" style={{ textAlign: "right" }}>
                  {row.where}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
