"use client";

import type { UpgradeSignalList } from "@brawzer/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchUpgradeSignals } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { ago, Avatar, fmtMinutes, fsize, HBar, Loading, percent } from "../ui";

/** Free accounts by what they do: hours used, Drive filling up, recent activity. No invented score. */
export function TrialsPage() {
  const [data, setData] = useState<UpgradeSignalList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchUpgradeSignals().then((result) => {
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
  if (!data) return <Loading what="accounts" />;
  return (
    <>
      <p className="muted" style={{ marginBottom: 16 }}>
        Free accounts that used Brawzer most in the last 30 days, with how full their Drive is and
        when they were last here. These are the facts, not a score; an offer is a conversation, so
        open the account and write from Help if there is one to make.
      </p>
      <div className="card p0">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Browsing, 30 days</th>
              <th>Drive</th>
              <th>Live now</th>
              <th>Last active</th>
              <th>Since</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">
                  No free account used a cloud browser in the last 30 days
                </td>
              </tr>
            ) : (
              data.accounts.map((entry) => (
                <tr key={entry.customer.id}>
                  <td>
                    <div className="row">
                      <Avatar name={entry.customer.handle} size={28} />
                      <div>
                        <Link href={`/admin/customers/${entry.customer.id}` as never}>
                          {entry.customer.handle}
                        </Link>
                        <div className="muted sm mask">{entry.customer.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>{fmtMinutes(entry.browsingMinutes30d)}</td>
                  <td>
                    <div className="row sm">
                      <div style={{ width: 80 }}>
                        <HBar value={percent(entry.driveBytes, entry.driveLimitBytes)} />
                      </div>
                      {fsize(entry.driveBytes)}
                    </div>
                  </td>
                  <td>{entry.liveSessionsNow || "—"}</td>
                  <td className="muted">{ago(entry.lastActiveAt)}</td>
                  <td className="muted">{ago(entry.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
