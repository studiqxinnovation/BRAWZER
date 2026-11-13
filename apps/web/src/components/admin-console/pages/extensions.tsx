"use client";

import {
  can,
  type ExtensionStatus,
  extensionStatusNames,
  extensionStatuses,
  type ModeratedExtension,
  type ModeratedExtensionList,
} from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { fetchModeratedExtensions, setExtensionStatus } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { ago, Loading, Pill, ReasonDialog } from "../ui";
import { useAction } from "../use-action";

const TONE: Record<ExtensionStatus, "g" | "o" | "r"> = { allowed: "g", review: "o", blocked: "r" };

/** The extension catalogue: what each one is, who has it, and whether it stays allowed. */
export function ExtensionsPage() {
  const me = useStaff();
  const [data, setData] = useState<ModeratedExtensionList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<ModeratedExtension | null>(null);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void fetchModeratedExtensions().then((result) => {
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
  if (!data) return <Loading what="the catalogue" />;
  const may = can(me.role, "extModerate");
  const change = (extension: ModeratedExtension, status: ExtensionStatus) => {
    if (status === "blocked") {
      setBlocking(extension);
      return;
    }
    void action
      .run(
        () => setExtensionStatus(extension.slug, { status, reason: "" }),
        `${extension.name}: ${extensionStatusNames[status]}`,
      )
      .then((result) => {
        if (result) setData(result.data);
      });
  };
  return (
    <>
      <p className="muted" style={{ marginBottom: 16 }}>
        Extensions run inside customers’ cloud browsers, so a bad one can read what they do there.
        Brawzer’s catalogue is open-source extensions pinned by checksum. Blocking one removes it
        from every profile at once and emails the people who had it, with the reason.
      </p>
      <div className="card p0">
        <table>
          <thead>
            <tr>
              <th>Extension</th>
              <th>Versions</th>
              <th>Licence</th>
              <th>Profiles using it</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {data.extensions.map((extension) => (
              <tr key={extension.slug}>
                <td>
                  <b style={{ fontWeight: 500 }}>{extension.name}</b>
                  <div className="muted sm">{extension.summary}</div>
                  {extension.reason && (
                    <div className="sm" style={{ color: "var(--rfg)", marginTop: 2 }}>
                      {extension.reason}
                    </div>
                  )}
                </td>
                <td className="sm mask">
                  {extension.versions.bee ? `Bee ${extension.versions.bee}` : "—"}
                  <br />
                  {extension.versions.firefox ? `Firefox ${extension.versions.firefox}` : "—"}
                </td>
                <td className="sm">
                  <a href={extension.homepage} target="_blank" rel="noreferrer">
                    {extension.licence}
                  </a>
                </td>
                <td>{extension.installs}</td>
                <td>
                  <Pill tone={TONE[extension.status]}>
                    {extensionStatusNames[extension.status]}
                  </Pill>
                  {extension.changedBy && (
                    <div className="muted sm">
                      {extension.changedBy} · {ago(extension.changedAt)}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  <select
                    className="in"
                    aria-label={`Status of ${extension.name}`}
                    value={extension.status}
                    disabled={!may || action.busy}
                    onChange={(event) => {
                      change(extension, event.target.value as ExtensionStatus);
                    }}
                  >
                    {extensionStatuses.map((status) => (
                      <option key={status} value={status}>
                        {extensionStatusNames[status]}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {blocking && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setBlocking(null);
          }}
          title={`Block ${blocking.name} for everyone?`}
          text={`It’s removed from ${String(blocking.installs)} profile${blocking.installs === 1 ? "" : "s"} now and won’t load in their next session. The people who had it get an email with your reason.`}
          okText="Block"
          danger
          busy={action.busy}
          error={action.problem}
          onConfirm={(reason) => {
            const extension = blocking;
            void action
              .run(
                () => setExtensionStatus(extension.slug, { status: "blocked", reason }),
                `${extension.name} blocked`,
              )
              .then((result) => {
                if (result) {
                  setData(result.data);
                  setBlocking(null);
                }
              });
          }}
        />
      )}
    </>
  );
}
