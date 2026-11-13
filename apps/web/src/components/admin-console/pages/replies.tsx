"use client";

import { can, type SavedReply } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import {
  addSavedReply,
  deleteSavedReply,
  editSavedReply,
  fetchSavedReplies,
} from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { ago, Card, FormDialog, Loading, ReasonDialog } from "../ui";
import { useAction } from "../use-action";

/** Saved replies: the team's shared wording, inserted from the inbox. */
export function RepliesPage() {
  const me = useStaff();
  const [replies, setReplies] = useState<SavedReply[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedReply | "new" | null>(null);
  const [deleting, setDeleting] = useState<SavedReply | null>(null);
  const action = useAction();

  useEffect(() => {
    let cancelled = false;
    void fetchSavedReplies().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) leaveSignedInArea("expired");
        setError(result.error.message);
        return;
      }
      setReplies(result.data.replies);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="warnbox">{error}</div>;
  if (!replies) return <Loading what="saved replies" />;
  const mayEdit = can(me.role, "replies");
  return (
    <>
      <p className="muted" style={{ marginBottom: 16 }}>
        Replies the whole team reuses. Insert one from the inbox and change it before sending.
        Brawzer has no help centre yet, so these are the team’s shared answers.
      </p>
      <div className="g2 grid">
        {replies.map((reply) => (
          <Card
            key={reply.id}
            title={reply.name}
            right={
              mayEdit ? (
                <>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setEditing(reply);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn sm dng"
                    aria-label={`Delete “${reply.name}”`}
                    onClick={() => {
                      setDeleting(reply);
                    }}
                  >
                    Delete
                  </button>
                </>
              ) : undefined
            }
          >
            <div className="sm" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {reply.body}
            </div>
            <div className="muted sm" style={{ marginTop: 10 }}>
              Changed {ago(reply.updatedAt)}
              {reply.updatedBy ? ` by ${reply.updatedBy}` : ""}
            </div>
          </Card>
        ))}
        {mayEdit && (
          <div
            className="card"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 120,
            }}
          >
            <button
              type="button"
              className="btn pri"
              onClick={() => {
                setEditing("new");
              }}
            >
              New saved reply
            </button>
          </div>
        )}
        {replies.length === 0 && !mayEdit && <div className="muted sm">No saved replies yet.</div>}
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
          title={editing === "new" ? "New saved reply" : "Edit saved reply"}
          fields={[
            {
              key: "name",
              label: "Name",
              required: true,
              value: editing === "new" ? "" : editing.name,
            },
            {
              key: "body",
              label: "Reply",
              area: true,
              required: true,
              value: editing === "new" ? "" : editing.body,
            },
          ]}
          okText="Save"
          busy={action.busy}
          error={action.problem}
          onSubmit={(values) => {
            const body = { name: values.name ?? "", body: values.body ?? "" };
            void action
              .run(
                () => (editing === "new" ? addSavedReply(body) : editSavedReply(editing.id, body)),
                "Saved reply saved",
              )
              .then((result) => {
                if (result) {
                  setReplies(result.data.replies);
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
          title={`Delete “${deleting.name}”?`}
          text="The team won’t see it in the inbox any more. Replies already sent keep their text."
          okText="Delete"
          danger
          reason={false}
          busy={action.busy}
          error={action.problem}
          onConfirm={() => {
            void action
              .run(() => deleteSavedReply(deleting.id), "Saved reply deleted")
              .then((result) => {
                if (result) {
                  setReplies(result.data.replies);
                  setDeleting(null);
                }
              });
          }}
        />
      )}
    </>
  );
}
