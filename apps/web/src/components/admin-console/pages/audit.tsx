"use client";

import {
  type StaffActionList,
  type StaffRole,
  staffRoleNames,
  staffRoles,
} from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { fetchAuditLog } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { Avatar, fdt, Loading } from "../ui";

/** Every staff action, newest first, filtered by person, role and text. Rows are never edited. */
export function AuditPage() {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<StaffRole | "">("");
  const [result, setResult] = useState<{ key: string; data: StaffActionList } | null>(null);
  const [more, setMore] = useState<StaffActionList["actions"]>([]);
  const [error, setError] = useState<string | null>(null);
  const key = `${role}:${query.trim().toLowerCase()}`;
  const current = result?.key === key ? result.data : null;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void fetchAuditLog({ q: query.trim() || undefined, role: role || undefined }).then(
          (response) => {
            if (cancelled) return;
            if (!response.ok) {
              if (response.status === 401) leaveSignedInArea("expired");
              setError(response.error.message);
              return;
            }
            setMore([]);
            setResult({ key, data: response.data });
          },
        );
      },
      query ? 200 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, role, key]);

  const actions = current ? [...current.actions, ...more] : [];
  const nextCursor = more.length ? more.at(-1)?.id : current?.nextCursor;

  const loadMore = async () => {
    if (!current || !nextCursor) return;
    const response = await fetchAuditLog({
      q: query.trim() || undefined,
      role: role || undefined,
      before: nextCursor,
    });
    if (response.ok) setMore((kept) => [...kept, ...response.data.actions]);
  };

  const exportCsv = () => {
    const rows = [
      ["when", "who", "role", "action", "target", "detail", "ip"],
      ...actions.map((a) => [
        a.at,
        a.actorEmail ?? "",
        a.actorRole,
        a.action,
        a.target,
        a.detail,
        a.ipAddress ?? "",
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `brawzer-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <p className="muted" style={{ marginBottom: 16 }}>
        Every staff action, including pages refused by permissions. Entries can’t be edited or
        deleted.
      </p>
      <div className="card p0">
        <div
          className="row"
          style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}
        >
          <input
            className="in"
            aria-label="Filter the audit log"
            placeholder="Filter by person, action, account ID"
            style={{ width: 300 }}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <select
            className="in"
            aria-label="Role"
            value={role}
            onChange={(event) => {
              setRole(event.target.value as StaffRole | "");
            }}
          >
            <option value="">All roles</option>
            {staffRoles.map((entry) => (
              <option key={entry} value={entry}>
                {staffRoleNames[entry]}
              </option>
            ))}
          </select>
          <span className="muted sm" style={{ marginLeft: "auto" }}>
            {current ? `${String(actions.length)} entries${nextCursor ? "+" : ""}` : ""}
          </span>
          <button
            type="button"
            className="btn sm"
            onClick={exportCsv}
            disabled={actions.length === 0}
          >
            Export CSV
          </button>
        </div>
        {error ? (
          <div className="warnbox" style={{ margin: 16 }}>
            {error}
          </div>
        ) : !current ? (
          <Loading what="the audit log" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Target</th>
                <th>Details</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {actions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    Nothing logged yet
                  </td>
                </tr>
              ) : (
                actions.map((action) => (
                  <tr key={action.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {fdt(action.at)}
                    </td>
                    <td>
                      <div className="row">
                        <Avatar name={action.actorEmail ?? action.actorRole} size={24} />
                        <div>
                          {action.actorEmail ?? "(account gone)"}
                          <div className="muted sm">
                            {(staffRoleNames as Record<string, string | undefined>)[
                              action.actorRole
                            ] ?? action.actorRole}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{action.action}</td>
                    <td className="mask">{action.target}</td>
                    <td className="muted sm">{action.detail}</td>
                    <td className="mask muted">{action.ipAddress ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
        {nextCursor && (
          <div style={{ padding: 12, textAlign: "center" }}>
            <button type="button" className="btn sm" onClick={() => void loadMore()}>
              Show older
            </button>
          </div>
        )}
      </div>
    </>
  );
}
