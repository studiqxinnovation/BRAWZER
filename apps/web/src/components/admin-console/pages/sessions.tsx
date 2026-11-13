"use client";

import { can, type LiveSession, type LiveSessionList } from "@brawzer/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { endLiveSession, fetchLiveSessions } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { ago, Loading, minutesSince, fmtMinutes, Pill, ReasonDialog } from "../ui";
import { useAction } from "../use-action";

/** Every live cloud browser: machine facts only. Staff never see what people browse. */
export function LiveSessionsPage() {
  const me = useStaff();
  const [data, setData] = useState<LiveSessionList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState("");
  const [ending, setEnding] = useState<LiveSession | null>(null);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchLiveSessions().then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          if (result.status === 401) leaveSignedInArea("expired");
          setError(result.error.message);
          return;
        }
        setData(result.data);
      });
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (error) return <div className="warnbox">{error}</div>;
  if (!data) return <Loading what="live sessions" />;
  const shown = data.sessions.filter((session) => !host || session.host === host);
  const may = can(me.role, "sessionEnd");
  return (
    <>
      <p className="muted" style={{ marginBottom: 12 }}>
        Machine facts only. Staff can never see what people browse. Refreshes every 30 seconds.
      </p>
      <div className="card p0">
        <div
          className="row"
          style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}
        >
          <select
            className="in"
            aria-label="Host"
            value={host}
            onChange={(event) => {
              setHost(event.target.value);
            }}
          >
            <option value="">All hosts</option>
            {data.hosts.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <span className="muted sm" style={{ marginLeft: "auto" }}>
            {shown.length} {shown.length === 1 ? "session" : "sessions"}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Session</th>
              <th>Customer</th>
              <th>Browser</th>
              <th>Host</th>
              <th>Running</th>
              <th>Last viewed</th>
              <th>Watching</th>
              <th>Through proxy</th>
              <th style={{ textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty">
                  No sessions running
                </td>
              </tr>
            ) : (
              shown.map((session) => (
                <tr key={session.id}>
                  <td className="mask">{session.id.slice(0, 8)}</td>
                  <td>
                    <Link href={`/admin/customers/${session.customer.id}` as never}>
                      {session.customer.handle}
                    </Link>
                    {session.profileName && <div className="muted sm">{session.profileName}</div>}
                  </td>
                  <td>
                    {session.engineName}
                    {session.extensions > 0 && (
                      <div className="muted sm">
                        {session.extensions} {session.extensions === 1 ? "extension" : "extensions"}
                      </div>
                    )}
                  </td>
                  <td className="mask">{session.host}</td>
                  <td className="muted">
                    {session.startedAt ? (
                      fmtMinutes(minutesSince(session.startedAt))
                    ) : (
                      <Pill tone="b">starting</Pill>
                    )}
                  </td>
                  <td className="muted">{ago(session.lastViewedAt)}</td>
                  <td>{session.viewers}</td>
                  <td>
                    {session.throughProxy ? (
                      <Pill tone="b">Yes</Pill>
                    ) : (
                      <span className="muted">No</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="btn sm dng"
                      disabled={!may}
                      title={may ? undefined : "Your role can’t end sessions"}
                      onClick={() => {
                        setEnding(session);
                      }}
                    >
                      End
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {ending && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setEnding(null);
          }}
          title="End this session?"
          text={`The browser closes for ${ending.customer.handle} and the container goes. Their profile’s data is saved. Their security history says staff ended it.`}
          okText="End session"
          danger
          busy={action.busy}
          error={action.problem}
          onConfirm={(reason) => {
            const session = ending;
            void action
              .run(() => endLiveSession(session.id, reason), "Session ended")
              .then((result) => {
                if (result) {
                  setData(result.data);
                  setEnding(null);
                }
              });
          }}
        />
      )}
    </>
  );
}
