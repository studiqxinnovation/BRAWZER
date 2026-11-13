"use client";

import type { Network } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { fetchNetwork } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { Card, fdt, Kpi, Loading, Pill } from "../ui";

/** Proxy & Shield: the proxies customers saved and how their tests went; site rules in force. */
export function NetworkPage() {
  const [data, setData] = useState<Network | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchNetwork().then((result) => {
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
  if (!data) return <Loading what="the network" />;
  const { proxies, siteRules } = data;
  return (
    <>
      <div className="g4 grid" style={{ marginBottom: 16 }}>
        <Kpi
          label="Saved proxies"
          value={String(proxies.total)}
          note="customers’ own, credentials sealed"
        />
        <Kpi
          label="Failing their test"
          value={String(proxies.failing)}
          note={`${String(proxies.working)} working · ${String(proxies.untested)} untested`}
          tone={proxies.failing > 0 ? "dn" : null}
        />
        <Kpi label="Live sessions through a proxy" value={String(proxies.liveThroughProxy)} />
        <Kpi
          label="Site rules"
          value={String(siteRules.allow + siteRules.block)}
          note={`${String(siteRules.block)} block · ${String(siteRules.allow)} allow · ${String(siteRules.accounts)} accounts`}
        />
      </div>
      <div className="g2 grid">
        <Card title="Proxies by protocol">
          {proxies.byProtocol.length === 0 ? (
            <div className="muted sm">No proxies saved yet</div>
          ) : (
            proxies.byProtocol.map((entry) => (
              <div key={entry.protocol} className="list-i sm">
                <span style={{ flex: 1 }}>{entry.protocol}</span>
                <b>{entry.count}</b>
              </div>
            ))
          )}
          <div className="muted sm" style={{ marginTop: 10 }}>
            Brawzer has no address pool of its own: customers bring their proxies, and websites see
            those addresses. Exit reputation and rotation are the proxy provider’s.
          </div>
        </Card>
        <Card title="Latest failed tests" flush>
          <table>
            <thead>
              <tr>
                <th>Protocol</th>
                <th>Tested</th>
                <th>Reached</th>
                <th>Signed in</th>
                <th>Problem</th>
              </tr>
            </thead>
            <tbody>
              {proxies.recentFailures.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    No failed tests
                  </td>
                </tr>
              ) : (
                proxies.recentFailures.map((failure, index) => (
                  <tr key={index}>
                    <td>{failure.protocol}</td>
                    <td className="muted">{fdt(failure.testedAt)}</td>
                    <td>
                      {failure.reachable ? <Pill tone="g">Yes</Pill> : <Pill tone="r">No</Pill>}
                    </td>
                    <td>
                      {failure.authenticated === null ? (
                        <span className="muted">—</span>
                      ) : failure.authenticated ? (
                        <Pill tone="g">Yes</Pill>
                      ) : (
                        <Pill tone="r">No</Pill>
                      )}
                    </td>
                    <td className="sm">{failure.reason ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>
      <div className="g2 grid" style={{ marginTop: 16 }}>
        <Card title="Shield">
          <div className="sm" style={{ lineHeight: 1.6 }}>
            Shield is each account’s security page: sign-in methods, devices, security history and
            site rules. Ad and tracker blocking happens with the extensions a customer installs
            (uBlock Origin from the catalogue), not with lists Brawzer keeps. Nothing is reported as
            broken by Shield because Shield doesn’t watch pages.
          </div>
        </Card>
        <Card title="Egress">
          <div className="sm" style={{ lineHeight: 1.6 }}>
            Every session’s traffic leaves through its own egress container (
            <span className="mask">{data.egressImage}</span>), which enforces the network policy and
            the account’s proxy. Bandwidth isn’t metered per session yet.
          </div>
        </Card>
      </div>
    </>
  );
}
