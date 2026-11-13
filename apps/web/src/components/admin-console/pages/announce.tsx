"use client";

import {
  type AnnouncementKind,
  announcementKindNames,
  announcementKinds,
  audienceName,
  can,
  type StaffAnnouncement,
  type StaffAnnouncementList,
} from "@brawzer/contracts";
import { useEffect, useState } from "react";
import {
  deleteAnnouncement,
  editAnnouncement,
  fetchAnnouncements as fetchStaffAnnouncements,
  publishAnnouncement,
  toggleAnnouncement,
} from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { fdate, FormDialog, Loading, Pill, ReasonDialog } from "../ui";
import { useAction } from "../use-action";

const KIND_TONE: Record<AnnouncementKind, "r" | "b" | "g" | "o"> = {
  incident: "r",
  news: "b",
  tip: "g",
  maintenance: "o",
};

/** Banners shown inside Brawzer: tell people before they contact support, announce what's new. */
export function AnnouncePage() {
  const me = useStaff();
  const [data, setData] = useState<StaffAnnouncementList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffAnnouncement | "new" | null>(null);
  const [deleting, setDeleting] = useState<StaffAnnouncement | null>(null);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void fetchStaffAnnouncements().then((result) => {
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
  if (!data) return <Loading what="announcements" />;
  const may = can(me.role, "announce");
  const audiences = [
    { value: "everyone", label: "Everyone" },
    { value: "teams", label: "Organisations only" },
    ...data.plans.map((plan) => ({ value: `plan:${plan.code}`, label: `Plan: ${plan.name}` })),
  ];
  const current = editing === "new" || editing === null ? null : editing;
  return (
    <>
      <p className="muted" style={{ marginBottom: 16 }}>
        Banners shown inside Brawzer. Tell people about problems before they contact support, and
        announce new features. Views and clicks are counted per account, not estimated.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        {may && (
          <button
            type="button"
            className="btn pri sm"
            style={{ marginLeft: "auto" }}
            onClick={() => {
              setEditing("new");
            }}
          >
            New announcement
          </button>
        )}
      </div>
      <div className="stack">
        {data.announcements.length === 0 && <div className="card empty">No announcements yet</div>}
        {data.announcements.map((entry) => (
          <div key={entry.id} className="card announce">
            <Pill tone={KIND_TONE[entry.kind]}>{announcementKindNames[entry.kind]}</Pill>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{entry.title}</b>
              <div className="muted sm" style={{ margin: "3px 0 8px" }}>
                {entry.body}
              </div>
              <div className="row sm muted" style={{ gap: 14, flexWrap: "wrap" }}>
                <span>Shown to: {audienceName(entry.audience)}</span>
                <span>
                  {fdate(entry.startsAt)}
                  {entry.endsAt ? ` → ${fdate(entry.endsAt)}` : " → until turned off"}
                </span>
                <span>
                  {entry.views.toLocaleString()} {entry.views === 1 ? "view" : "views"} ·{" "}
                  {entry.views ? Math.round((entry.clicks / entry.views) * 100) : 0}% clicked
                </span>
                {entry.incidentId && <span>From an incident</span>}
                {entry.createdBy && <span>by {entry.createdBy}</span>}
              </div>
            </div>
            {may && (
              <>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    setEditing(entry);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn sm"
                  aria-label={`Delete “${entry.title}”`}
                  onClick={() => {
                    setDeleting(entry);
                  }}
                >
                  Delete
                </button>
              </>
            )}
            <button
              type="button"
              role="switch"
              className="tgl"
              aria-checked={entry.on}
              aria-label={`${entry.on ? "Showing" : "Hidden"}: ${entry.title}`}
              disabled={!may || action.busy}
              onClick={() => {
                void action
                  .run(
                    () => toggleAnnouncement(entry.id, !entry.on),
                    entry.on ? "Hidden" : "Showing",
                  )
                  .then((result) => {
                    if (result) setData(result.data);
                  });
              }}
            />
          </div>
        ))}
      </div>

      {editing && (
        <FormDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
              action.setProblem(null);
            }
          }}
          title={current ? "Edit announcement" : "New announcement"}
          fields={[
            { key: "title", label: "Title", required: true, value: current?.title ?? "" },
            {
              key: "body",
              label: "Message",
              area: true,
              required: true,
              value: current?.body ?? "",
            },
            {
              key: "kind",
              label: "Type",
              options: announcementKinds.map((kind) => ({
                value: kind,
                label: announcementKindNames[kind],
              })),
              value: current?.kind ?? "news",
            },
            {
              key: "audience",
              label: "Show to",
              options: audiences,
              value: current?.audience ?? "everyone",
            },
            {
              key: "link",
              label: "Link (a page on Brawzer, optional)",
              placeholder: "/app/shield",
              value: current?.link ?? "",
            },
            {
              key: "endsAt",
              label: "Until (optional)",
              type: "date",
              value: current?.endsAt ? current.endsAt.slice(0, 10) : "",
            },
          ]}
          okText={current ? "Save" : "Publish"}
          busy={action.busy}
          error={action.problem}
          onSubmit={(values) => {
            const body = {
              title: values.title ?? "",
              body: values.body ?? "",
              kind: (values.kind ?? "news") as AnnouncementKind,
              audience: values.audience ?? "everyone",
              link: values.link?.trim() ? values.link.trim() : null,
              endsAt: values.endsAt ? new Date(`${values.endsAt}T23:59:59`).toISOString() : null,
            };
            void action
              .run(
                () => (current ? editAnnouncement(current.id, body) : publishAnnouncement(body)),
                current ? "Announcement changed" : "Published",
              )
              .then((result) => {
                if (result) {
                  setData(result.data);
                  setEditing(null);
                }
              });
          }}
        />
      )}
      {deleting && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          title={`Delete “${deleting.title}”?`}
          text="It disappears from everyone's screen now. Its views and clicks go with it."
          okText="Delete"
          danger
          reason={false}
          busy={action.busy}
          error={action.problem}
          onConfirm={() => {
            void action
              .run(() => deleteAnnouncement(deleting.id), "Announcement deleted")
              .then((result) => {
                if (result) {
                  setData(result.data);
                  setDeleting(null);
                }
              });
          }}
        />
      )}
    </>
  );
}
