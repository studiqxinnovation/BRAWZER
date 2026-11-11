"use client";

import {
  inviteTeamMemberRequestSchema,
  type Team,
  type TeamMember,
  type TeamOverview,
  type TeamRole,
  teamNameSchema,
} from "@brawzer/contracts";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@brawzer/ui/components/alert-dialog";
import { Button } from "@brawzer/ui/components/button";
import { Field, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Select } from "@brawzer/ui/components/select";
import { useToast } from "@brawzer/ui/components/toast";
import { type SubmitEvent, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { Card, Empty, Grid, InfoHead, Panel, Pill, Row } from "@/components/app-shell/page";
import { Reveal } from "@/components/app-shell/reveal";
import { LocalDate } from "@/components/local-date";
import type { ApiResult } from "@/lib/api/client";
import {
  createTeam,
  declineInvitation,
  deleteTeam,
  inviteToTeam,
  joinTeam,
  leaveTeam,
  removeFromTeam,
  renameTeam,
  setTeamRole,
  transferTeam,
  withdrawInvitation,
} from "@/lib/api/teams";
import { leaveSignedInArea } from "@/lib/session-channel";

const ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
] as const;

/** The prototype's avatar colours, by position in the list. */
const AVATAR_COLOURS = ["#3B82F6", "#A78BFA", "#34D399", "#FB923C", "#F472B6", "#22D3EE"];

type Confirming =
  | { kind: "remove"; member: TeamMember }
  | { kind: "transfer"; member: TeamMember }
  | { kind: "leave" }
  | { kind: "delete" };

/** The Team page (Phase 8, idea 19): every answer from the API is the whole page's state. */
export function TeamManager({ initial, me }: { initial: TeamOverview; me: string }) {
  const toast = useToast();
  const confirmed = useConfirmedRequest();
  const [overview, setOverview] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  /** Runs a change; true when it worked. Errors show as a toast unless `onError` takes them. */
  async function run(
    key: string,
    request: () => Promise<ApiResult<TeamOverview>>,
    success?: string,
    onError?: (message: string) => void,
  ): Promise<boolean> {
    setBusy(key);
    const result = await confirmed(request);
    setBusy(null);
    if (result.ok) {
      setOverview(result.data);
      if (success) toast.add({ type: "success", title: success });
      return true;
    }
    if (result.status === 401) {
      leaveSignedInArea("expired");
      return false;
    }
    if (onError) onError(result.error.message);
    else toast.add({ type: "error", title: "That didn’t work", description: result.error.message });
    return false;
  }

  if (!overview.team) {
    return <NoTeam overview={overview} busy={busy} run={run} />;
  }
  return <InTeam team={overview.team} me={me} busy={busy} run={run} />;
}

type Run = (
  key: string,
  request: () => Promise<ApiResult<TeamOverview>>,
  success?: string,
  onError?: (message: string) => void,
) => Promise<boolean>;

function Avatar({ text, index, muted }: { text: string; index: number; muted?: boolean }) {
  return (
    <span
      className="ad-pav"
      aria-hidden="true"
      style={{
        background: muted
          ? "var(--color-ink-tertiary)"
          : AVATAR_COLOURS[index % AVATAR_COLOURS.length],
      }}
    >
      {text.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The prototype's Seats card: how many of the plan's places are taken. */
function SeatsCard({ taken, seats, plan }: { taken: number; seats: number; plan: string }) {
  const share = seats > 0 ? Math.min(100, Math.round((taken / seats) * 100)) : 0;
  return (
    <Card label="Seats">
      <p className="ad-stat-big">
        {String(taken)} of {String(seats)}
      </p>
      <div className="ad-prog" role="presentation">
        <div className="ad-prog-fill" style={{ width: `${String(share)}%` }} />
      </div>
      <p className="ad-stat-small">
        {plan} includes {String(seats)} {seats === 1 ? "seat" : "seats"}
      </p>
    </Card>
  );
}

function NoTeam({
  overview,
  busy,
  run,
}: {
  overview: TeamOverview;
  busy: string | null;
  run: Run;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canStart = overview.seats >= 2;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = teamNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Name the team.");
      return;
    }
    setError(null);
    await run("create", () => createTeam(parsed.data), "Team started", setError);
  }

  return (
    <div className="flex flex-col">
      <Grid cols={3} className="mb-[14px]">
        <SeatsCard taken={1} seats={Math.max(1, overview.seats)} plan="Your plan" />
        <Card label="Start a team" className="ad-span-2">
          {canStart ? (
            <form method="post" noValidate onSubmit={(event) => void submit(event)}>
              <div className="ad-form-row">
                <Field className="ad-grow">
                  <FieldLabel className="sr-only">Team name</FieldLabel>
                  <Input
                    name="name"
                    autoComplete="organization"
                    placeholder="Team name"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                  />
                </Field>
                <Button type="submit" variant="primary" loading={busy === "create"}>
                  Start team
                </Button>
              </div>
              <p className="ad-stat-small">
                You’ll own it: everyone you invite uses your plan, which allows{" "}
                {String(overview.seats)} people, you included.
              </p>
              {error && (
                <FormMessage tone="danger" title="The team wasn’t started" className="mt-3">
                  {error}
                </FormMessage>
              )}
            </form>
          ) : (
            <p className="ad-stat-small">
              Your plan doesn’t include a team. A plan with team members, chosen on the Account
              page, lets you start one.
            </p>
          )}
        </Card>
      </Grid>

      <Panel>
        <InfoHead title="Invitations for you">
          <span className="ad-info-count">
            {overview.invitations.length === 1
              ? "1 invitation"
              : `${String(overview.invitations.length)} invitations`}
          </span>
        </InfoHead>
        {overview.invitations.length > 0 ? (
          <ul aria-label="Invitations for you">
            {overview.invitations.map((invitation, index) => (
              <li key={invitation.id}>
                <Row
                  icon={<Avatar text={invitation.teamName} index={index} />}
                  title={invitation.teamName}
                  sub={
                    <>
                      {invitation.invitedBy ? `From ${invitation.invitedBy}, as ` : "As "}
                      {invitation.role === "admin" ? "an admin" : "a member"} · until{" "}
                      <LocalDate iso={invitation.expiresAt} /> · joining puts you on the team
                      owner’s plan
                    </>
                  }
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === `decline-${invitation.id}`}
                    onClick={() =>
                      void run(
                        `decline-${invitation.id}`,
                        () => declineInvitation(invitation.id),
                        "Invitation declined",
                      )
                    }
                  >
                    Decline<span className="sr-only"> {invitation.teamName}</span>
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy === `join-${invitation.id}`}
                    onClick={() =>
                      void run(
                        `join-${invitation.id}`,
                        () => joinTeam(invitation.id),
                        `You’re in ${invitation.teamName}`,
                      )
                    }
                  >
                    Join<span className="sr-only"> {invitation.teamName}</span>
                  </Button>
                </Row>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No invitations. Someone who runs a team can invite this email address.</Empty>
        )}
      </Panel>
    </div>
  );
}

function InTeam({
  team,
  me,
  busy,
  run,
}: {
  team: Team;
  me: string;
  busy: string | null;
  run: Run;
}) {
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const manages = team.role === "owner" || team.role === "admin";
  const taken = team.members.length + team.invitations.length;

  async function confirm() {
    if (!confirming) return;
    const done =
      confirming.kind === "remove"
        ? await run(
            "confirm",
            () => removeFromTeam(confirming.member.userId),
            `${confirming.member.email} is no longer in the team`,
          )
        : confirming.kind === "transfer"
          ? await run(
              "confirm",
              () => transferTeam(confirming.member.userId),
              `${confirming.member.email} owns the team now`,
            )
          : confirming.kind === "leave"
            ? await run("confirm", () => leaveTeam(), `You left ${team.name}`)
            : await run("confirm", () => deleteTeam(), `${team.name} was deleted`);
    if (done) setConfirming(null);
  }

  return (
    <div className="flex flex-col">
      <Grid cols={3} className="mb-[14px]">
        <SeatsCard taken={taken} seats={team.seats} plan={`${team.planName} plan`} />
        {manages ? (
          <Invitations team={team} full={taken >= team.seats} busy={busy} run={run} />
        ) : (
          <Card label="Your place" className="ad-span-2">
            <p className="ad-stat-big">{ROLE_LABELS[team.role]}</p>
            <p className="ad-stat-small">
              From your team: everyone here uses the {team.planName} plan, and{" "}
              {team.members.find((member) => member.role === "owner")?.email ?? "its owner"} pays
              for it. Admins invite people; ask one to invite someone.
            </p>
          </Card>
        )}
      </Grid>

      <Panel className="mb-[14px]">
        <InfoHead title={team.name}>
          <span className="ad-info-count">
            {String(team.members.length)} of {String(team.seats)} members · started{" "}
            <LocalDate iso={team.createdAt} />
          </span>
        </InfoHead>
        {manages && <TeamName team={team} busy={busy} run={run} />}
        <ul aria-label="Team members">
          {team.members.map((member, index) => {
            const self = member.email === me;
            const canRemove =
              !self &&
              member.role !== "owner" &&
              (team.role === "owner" || (team.role === "admin" && member.role === "member"));
            return (
              <li key={member.userId}>
                <Row
                  icon={<Avatar text={member.email} index={index} />}
                  title={
                    <>
                      <span className="truncate">{member.email}</span>
                      {self && <Pill tone="grey">You</Pill>}
                      <Pill tone={member.role === "owner" ? "blue" : "grey"}>
                        {ROLE_LABELS[member.role]}
                      </Pill>
                    </>
                  }
                  sub={
                    <>
                      Joined <LocalDate iso={member.joinedAt} />
                    </>
                  }
                >
                  {team.role === "owner" && !self && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy === `role-${member.userId}`}
                        onClick={() =>
                          void run(
                            `role-${member.userId}`,
                            () =>
                              setTeamRole(
                                member.userId,
                                member.role === "admin" ? "member" : "admin",
                              ),
                            member.role === "admin"
                              ? `${member.email} is a member now`
                              : `${member.email} is an admin now`,
                          )
                        }
                      >
                        {member.role === "admin" ? "Make member" : "Make admin"}
                        <span className="sr-only"> {member.email}</span>
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setConfirming({ kind: "transfer", member });
                        }}
                      >
                        Hand over<span className="sr-only"> the team to {member.email}</span>
                      </Button>
                    </>
                  )}
                  {canRemove && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setConfirming({ kind: "remove", member });
                      }}
                    >
                      Remove<span className="sr-only"> {member.email}</span>
                    </Button>
                  )}
                </Row>
              </li>
            );
          })}
        </ul>
        {manages && team.invitations.length > 0 && (
          <ul aria-label="Waiting invitations">
            {team.invitations.map((invitation, index) => (
              <li key={invitation.id}>
                <Row
                  icon={<Avatar text={invitation.email} index={index} muted />}
                  title={
                    <>
                      <span className="truncate">{invitation.email}</span>
                      <Pill tone="orange">Invite sent</Pill>
                      <Pill tone="grey">{ROLE_LABELS[invitation.role]}</Pill>
                    </>
                  }
                  sub={
                    <>
                      Until <LocalDate iso={invitation.expiresAt} />
                    </>
                  }
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === `withdraw-${invitation.id}`}
                    onClick={() =>
                      void run(
                        `withdraw-${invitation.id}`,
                        () => withdrawInvitation(invitation.id),
                        `The invitation to ${invitation.email} was withdrawn`,
                      )
                    }
                  >
                    Cancel<span className="sr-only"> the invitation to {invitation.email}</span>
                  </Button>
                </Row>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="ad-danger">
        <InfoHead title={team.role === "owner" ? "Delete the team" : "Leave the team"} />
        <Row
          title={team.role === "owner" ? "Delete team" : "Leave team"}
          sub={
            team.role === "owner"
              ? "Its shared proxies and Drive space are deleted, and everyone goes back to their own plan. To leave instead, hand the team to someone first."
              : "You go back to your own plan. What you put in the team’s Drive stays with the team."
          }
        >
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setConfirming(team.role === "owner" ? { kind: "delete" } : { kind: "leave" });
            }}
          >
            {team.role === "owner" ? "Delete team" : "Leave team"}
          </Button>
        </Row>
      </Panel>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {confirming?.kind === "remove"
              ? `Remove ${confirming.member.email}?`
              : confirming?.kind === "transfer"
                ? `Hand ${team.name} to ${confirming.member.email}?`
                : confirming?.kind === "leave"
                  ? `Leave ${team.name}?`
                  : `Delete ${team.name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirming?.kind === "remove"
              ? "They go back to their own plan and lose the team’s proxies and Drive. What they put in the team’s Drive stays with the team."
              : confirming?.kind === "transfer"
                ? "Their plan then applies to everyone, and they pay for it. You become an admin."
                : confirming?.kind === "leave"
                  ? "You go back to your own plan and lose the team’s proxies and Drive."
                  : "The team’s proxies and everything in its Drive are deleted. This can’t be undone."}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
            <Button
              variant={confirming?.kind === "transfer" ? "primary" : "danger"}
              loading={busy === "confirm"}
              onClick={() => void confirm()}
            >
              {confirming?.kind === "remove"
                ? "Remove"
                : confirming?.kind === "transfer"
                  ? "Hand over"
                  : confirming?.kind === "leave"
                    ? "Leave team"
                    : "Delete team"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Renaming, behind "Rename" at the top of the members card. */
function TeamName({ team, busy, run }: { team: Team; busy: string | null; run: Run }) {
  const [name, setName] = useState(team.name);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = teamNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Name the team.");
      return;
    }
    setError(null);
    await run("rename", () => renameTeam(parsed.data), "Team renamed", setError);
  }

  return (
    <Reveal title="Team name" sub={`You: ${ROLE_LABELS[team.role]}`} label="Rename">
      <form method="post" noValidate onSubmit={(event) => void submit(event)}>
        <div className="ad-form-row">
          <Field className="ad-grow">
            <FieldLabel className="sr-only">Team name</FieldLabel>
            <Input
              name="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            loading={busy === "rename"}
            disabled={name.trim() === team.name}
          >
            Rename
          </Button>
        </div>
        {error && (
          <FormMessage tone="danger" title="The name wasn’t changed" className="mt-3">
            {error}
          </FormMessage>
        )}
      </form>
    </Reveal>
  );
}

/** The prototype's "Invite someone" card: an email, a role, Send invitation. */
function Invitations({
  team,
  full,
  busy,
  run,
}: {
  team: Team;
  full: boolean;
  busy: string | null;
  run: Run;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = inviteTeamMemberRequestSchema.safeParse({ email, role });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter an email address.");
      return;
    }
    setError(null);
    const done = await run(
      "invite",
      () => inviteToTeam(parsed.data),
      `Invitation sent to ${parsed.data.email}`,
      setError,
    );
    if (done) setEmail("");
  }

  return (
    <Card label="Invite someone" className="ad-span-2">
      <form method="post" noValidate onSubmit={(event) => void submit(event)}>
        <div className="ad-form-row">
          <Field className="ad-grow">
            <FieldLabel className="sr-only">Email address</FieldLabel>
            <Input
              name="email"
              type="email"
              autoComplete="off"
              placeholder="name@company.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </Field>
          <Select
            label="Role"
            hideLabel
            options={ROLE_OPTIONS}
            value={role}
            onValueChange={setRole}
          />
          <Button type="submit" variant="primary" loading={busy === "invite"} disabled={full}>
            Send invitation
          </Button>
        </div>
        <p className="ad-stat-small">
          {full
            ? `The team is full: its plan allows ${String(team.seats)} people, invitations included.`
            : "They get an email and join from their own Team page. An invitation lasts 7 days and holds a place. Admins also invite and remove members and manage proxies."}
        </p>
        {error && (
          <FormMessage tone="danger" title="The invitation wasn’t sent" className="mt-3">
            {error}
          </FormMessage>
        )}
      </form>
    </Card>
  );
}
