"use client";

import type { OrganisationSummary } from "@brawzer/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchOrganisations } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { ago, Avatar, fdate, HBar, Kpi, Loading, within } from "../ui";

/** Every team: members, plan, renewal, as the prototype's Organisations page has it. */
export function OrganisationsPage() {
  const router = useRouter();
  const [organisations, setOrganisations] = useState<OrganisationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchOrganisations().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) leaveSignedInArea("expired");
        setError(result.error.message);
        return;
      }
      setOrganisations(result.data.organisations);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="warnbox">{error}</div>;
  if (!organisations) return <Loading what="organisations" />;
  const soon = organisations.filter((org) => within(org.renewsAt, 60 * 86_400_000)).length;
  return (
    <>
      <div className="g4 grid" style={{ marginBottom: 16 }}>
        <Kpi
          label="Organisations"
          value={String(organisations.length)}
          note="teams on this installation"
        />
        <Kpi
          label="Seats in use"
          value={String(organisations.reduce((sum, org) => sum + org.members, 0))}
          note={`of ${String(organisations.reduce((sum, org) => sum + org.memberLimit, 0))} their plans allow`}
        />
        <Kpi
          label="Invitations open"
          value={String(organisations.reduce((sum, org) => sum + org.invitations, 0))}
          note="waiting to be accepted"
        />
        <Kpi label="Renewing in 60 days" value={String(soon)} note="from their subscriptions" />
      </div>
      <div className="card p0">
        <table>
          <thead>
            <tr>
              <th>Organisation</th>
              <th>Plan</th>
              <th>Members</th>
              <th>Proxies</th>
              <th>Last active</th>
              <th>Renews</th>
              <th>Since</th>
            </tr>
          </thead>
          <tbody>
            {organisations.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  No organisations yet
                </td>
              </tr>
            ) : (
              organisations.map((org) => (
                <tr
                  key={org.id}
                  className="click"
                  onClick={() => {
                    router.push(`/admin/orgs/${org.id}` as never);
                  }}
                >
                  <td>
                    <div className="row">
                      <Avatar name={org.name} size={30} />
                      <div>
                        <a href={`/admin/orgs/${org.id}`} style={{ color: "inherit" }}>
                          {org.name}
                        </a>
                        <div className="muted sm">owner {org.ownerEmail}</div>
                      </div>
                    </div>
                  </td>
                  <td>{org.planName}</td>
                  <td>
                    <div className="sm">
                      {org.members} / {org.memberLimit}
                    </div>
                    <div style={{ width: 80 }}>
                      <HBar
                        value={(org.members / Math.max(1, org.memberLimit)) * 100}
                        colour="var(--blue)"
                      />
                    </div>
                  </td>
                  <td>{org.proxies}</td>
                  <td className="muted">{ago(org.lastActiveAt)}</td>
                  <td className="muted">{org.renewsAt ? fdate(org.renewsAt) : "—"}</td>
                  <td className="muted">{fdate(org.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
