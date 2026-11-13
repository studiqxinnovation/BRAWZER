"use client";

import type { Organisation } from "@brawzer/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchOrganisation } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { ago, Avatar, Card, fdate, Kpi, Loading, Pill, StatusPill, within } from "../ui";

/** One team: members with their roles and sign-in state, open invitations, the owner's plan. */
export function OrganisationPage({ id }: { id: string }) {
  const [org, setOrg] = useState<Organisation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchOrganisation(id).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) leaveSignedInArea("expired");
        setError(result.error.message);
        return;
      }
      setOrg(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <div className="warnbox">{error}</div>;
  if (!org) return <Loading what="the organisation" />;
  const renewsSoon = within(org.renewsAt, 60 * 86_400_000);
  const signals = [
    org.members >= org.memberLimit && ["Every seat is taken. A bigger plan is the next step.", "g"],
    org.memberList.some((member) => !member.secondFactor) && [
      `${String(org.memberList.filter((member) => !member.secondFactor).length)} members have no passkey or two-factor.`,
      "o",
    ],
    renewsSoon && ["Renewal coming up " + ago(org.renewsAt), "o"],
    org.invitations > 0 && [
      `${String(org.invitations)} invitation${org.invitations === 1 ? "" : "s"} waiting to be accepted.`,
      "b",
    ],
  ].filter((entry): entry is [string, "g" | "o" | "b"] => Array.isArray(entry));
  return (
    <>
      <div className="crumb">
        <Link href="/admin/orgs">Organisations</Link> › {org.name}
      </div>
      <div className="phead">
        <Avatar name={org.name} size={56} />
        <div>
          <h2>{org.name}</h2>
          <div className="muted sm" style={{ marginTop: 4 }}>
            owner {org.ownerEmail} · customer since {fdate(org.createdAt)}
          </div>
        </div>
      </div>
      <div className="g4 grid">
        <Kpi
          label="Members"
          value={`${String(org.members)} / ${String(org.memberLimit)}`}
          note={`${String(Math.round((org.members / Math.max(1, org.memberLimit)) * 100))}% of the plan’s seats`}
        />
        <Kpi label="Plan" value={org.planName} note="the owner’s plan covers every member" />
        <Kpi
          label="Renews"
          value={org.renewsAt ? fdate(org.renewsAt) : "—"}
          note={org.renewsAt ? ago(org.renewsAt) : "No subscription"}
          tone={renewsSoon ? "dn" : null}
        />
        <Kpi label="Last active" value={ago(org.lastActiveAt)} note="any member" />
      </div>
      <div className="g2 grid" style={{ marginTop: 16 }}>
        <Card title="Signals">
          {signals.length === 0 ? (
            <div className="muted sm">Nothing to flag</div>
          ) : (
            signals.map(([text, tone]) => (
              <div key={text} className="list-i sm">
                <Pill tone={tone}>{""}</Pill>
                {text}
              </div>
            ))
          )}
        </Card>
        <Card title="Policies">
          <div className="infobox" style={{ margin: 0 }}>
            Brawzer has no organisation policies yet (extensions, regions, downloads, clipboard).
            Members get the same browser as everyone. This is planned, not built.
          </div>
        </Card>
      </div>
      <h3 style={{ margin: "22px 0 12px", fontSize: 16 }}>Members</h3>
      <div className="card p0">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Status</th>
              <th>Passkey or 2FA</th>
              <th>Joined</th>
              <th>Last active</th>
            </tr>
          </thead>
          <tbody>
            {org.memberList.map((member) => (
              <tr key={member.id}>
                <td>
                  <div className="row">
                    <Avatar name={member.email || member.id} size={28} />
                    <Link
                      href={`/admin/customers/${member.id}` as never}
                      style={{ color: "inherit" }}
                    >
                      {member.email || member.id.slice(0, 8)}
                    </Link>
                  </div>
                </td>
                <td>
                  {member.role === "owner" ? "Owner" : member.role === "admin" ? "Admin" : "Member"}
                </td>
                <td>
                  <StatusPill status={member.status} />
                </td>
                <td>
                  {member.secondFactor ? <Pill tone="g">On</Pill> : <Pill tone="o">Off</Pill>}
                </td>
                <td className="muted">{fdate(member.joinedAt)}</td>
                <td className="muted">{ago(member.lastActiveAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {org.invitationList.length > 0 && (
        <>
          <h3 style={{ margin: "22px 0 12px", fontSize: 16 }}>Invitations</h3>
          <div className="card p0">
            <table>
              <thead>
                <tr>
                  <th>Invited</th>
                  <th>Sent</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {org.invitationList.map((invitation) => (
                  <tr key={invitation.id}>
                    <td>{invitation.email}</td>
                    <td className="muted">{fdate(invitation.createdAt)}</td>
                    <td className="muted">{ago(invitation.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="muted sm" style={{ marginTop: 10 }}>
        Members are invited by the organisation’s own admins from their Team page.
      </div>
    </>
  );
}
