"use client";

import {
  can,
  type StaffList,
  type StaffPermission,
  staffPermissions,
  type StaffRole,
  staffRoleNames,
  staffRoles,
} from "@brawzer/contracts";
import { useToast } from "@brawzer/ui/components/toast";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { inviteStaff, fetchStaff, removeStaff, setStaffRole } from "@/lib/api/console";
import { leaveSignedInArea } from "@/lib/session-channel";
import { useStaff } from "../shell";
import { ago, Avatar, Card, FormDialog, Loading, Pill, ReasonDialog } from "../ui";

const MATRIX: [string, StaffPermission][] = [
  ["See personal details (with reason)", "reveal"],
  ["Refunds", "refund"],
  ["Change plans", "planChange"],
  ["End sessions", "sessionEnd"],
  ["Restore Drive files", "driveRestore"],
  ["Reset passkeys and two-factor", "twofaReset"],
  ["Approve account recovery", "recoveryApprove"],
  ["Suspend accounts", "suspend"],
  ["Organisation policies", "orgPolicy"],
  ["Scale servers", "scale"],
  ["Moderate extensions", "extModerate"],
  ["Handle privacy requests", "dsar"],
  ["Change prices", "priceEdit"],
  ["Manage staff", "staff"],
];

const ROLE_OPTIONS = staffRoles
  .filter((role): role is Exclude<StaffRole, "admin"> => role !== "admin")
  .map((role) => ({ value: role, label: staffRoleNames[role] }));

/** The team: who has a role, their second factor and last sign-in; invite, change, remove. */
export function TeamPage() {
  const me = useStaff();
  const toast = useToast();
  const confirmed = useConfirmedRequest();
  const [data, setData] = useState<StaffList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<StaffList["staff"][number] | null>(null);
  const [removing, setRemoving] = useState<StaffList["staff"][number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchStaff().then((result) => {
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

  const apply = async (
    run: () => ReturnType<typeof inviteStaff>,
    done: string,
    close: () => void,
  ) => {
    setBusy(true);
    setProblem(null);
    const result = await confirmed(run);
    setBusy(false);
    if (result.ok) {
      setData(result.data);
      close();
      toast.add({ type: "success", title: done });
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else if (result.error.code !== "reauthentication_required") {
      setProblem(result.error.message);
    }
  };

  if (error) return <div className="warnbox">{error}</div>;
  if (!data) return <Loading what="the team" />;
  const mayManage = can(me.role, "staff");
  return (
    <>
      <div className="g12 grid">
        <Card
          title="Staff"
          right={
            mayManage ? (
              <button
                type="button"
                className="btn sm pri"
                onClick={() => {
                  setInviting(true);
                }}
              >
                Invite
              </button>
            ) : undefined
          }
        >
          {data.staff.map((member) => (
            <div key={member.id} className="list-i">
              <Avatar name={member.email} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflowWrap: "anywhere" }}>{member.email}</div>
                <div className="muted sm">
                  {staffRoleNames[member.role]} · {ago(member.lastSignInAt)}
                </div>
              </div>
              {member.secondFactor === "none" ? (
                <Pill tone="r">No 2FA</Pill>
              ) : (
                <Pill tone="g">{member.secondFactor === "passkey" ? "Passkey" : "2FA"}</Pill>
              )}
              {mayManage && member.role !== "admin" && (
                <>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setEditing(member);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn sm dng"
                    onClick={() => {
                      setRemoving(member);
                    }}
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          ))}
        </Card>
        <Card title="What each role can do" flush>
          <div style={{ overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th />
                  {staffRoles.map((role) => (
                    <th key={role} style={{ textAlign: "center", fontSize: 11 }}>
                      {staffRoleNames[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX.map(([label, permission]) => (
                  <tr key={permission}>
                    <td className="sm">{label}</td>
                    {staffRoles.map((role) => {
                      const allowed = (staffPermissions[permission] as readonly string[]).includes(
                        role,
                      );
                      return (
                        <td
                          key={role}
                          style={{
                            textAlign: "center",
                            color: allowed ? "var(--green)" : "var(--line)",
                          }}
                        >
                          {allowed ? (
                            <Check aria-label="Yes" width={15} height={15} />
                          ) : (
                            <span aria-label="No">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted sm" style={{ padding: "10px 20px 16px" }}>
            Refund and credit limits come with Billing (11.3). The founder is set by the
            installation’s ADMIN_EMAILS.
          </div>
        </Card>
      </div>
      <div className="g2 grid" style={{ marginTop: 16 }}>
        <Card title="Admin console security">
          <div className="list-i sm">
            <span style={{ flex: 1 }}>Staff need a passkey or an authenticator app</span>
            <Pill tone={data.secondFactorRequired ? "g" : "o"}>
              {data.secondFactorRequired ? "Required" : "Optional here (required in production)"}
            </Pill>
          </div>
          <div className="list-i sm">
            <span style={{ flex: 1 }}>Changes need a recent sign-in (confirm it’s you)</span>
            <Pill tone="g">On</Pill>
          </div>
          <div className="list-i sm">
            <span style={{ flex: 1 }}>Personal details hidden until revealed with a reason</span>
            <Pill tone="g">On</Pill>
          </div>
          <div className="list-i sm">
            <span style={{ flex: 1 }}>Every action goes to the audit log</span>
            <Pill tone="g">On</Pill>
          </div>
        </Card>
        <Card title="Elevated access">
          <div className="infobox" style={{ margin: 0 }}>
            Time-limited access to production servers and the database isn’t handled here. The
            runbook covers it; nothing in the console grants it.
          </div>
        </Card>
      </div>

      <FormDialog
        open={inviting}
        onOpenChange={(open) => {
          setInviting(open);
          if (!open) setProblem(null);
        }}
        title="Invite a staff member"
        intro="They must have a Brawzer account already. In production they also need a passkey or an authenticator app before the console opens for them."
        fields={[
          { key: "email", label: "Work email", type: "email", required: true },
          { key: "role", label: "Role", options: ROLE_OPTIONS },
        ]}
        okText="Give the role"
        busy={busy}
        error={problem}
        onSubmit={(values) => {
          void apply(
            () =>
              inviteStaff({
                email: values.email ?? "",
                role: (values.role ?? "care") as Exclude<StaffRole, "admin">,
              }),
            `${values.email ?? ""} is on the team`,
            () => {
              setInviting(false);
            },
          );
        }}
      />
      {editing && (
        <FormDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
              setProblem(null);
            }
          }}
          title={editing.email}
          fields={[{ key: "role", label: "Role", options: ROLE_OPTIONS, value: editing.role }]}
          okText="Save"
          busy={busy}
          error={problem}
          onSubmit={(values) => {
            const person = editing;
            void apply(
              () =>
                setStaffRole(
                  person.id,
                  (values.role ?? person.role) as Exclude<StaffRole, "admin">,
                ),
              "Role changed",
              () => {
                setEditing(null);
              },
            );
          }}
        />
      )}
      {removing && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
          title={`Remove ${removing.email}?`}
          text="Access ends now: their account becomes a customer’s. Their sessions aren’t signed out."
          okText="Remove"
          danger
          busy={busy}
          error={problem}
          onConfirm={(reason) => {
            const person = removing;
            void apply(
              () => removeStaff(person.id, reason),
              `${person.email} removed from the team`,
              () => {
                setRemoving(null);
                setEditing(null);
              },
            );
          }}
        />
      )}
    </>
  );
}
