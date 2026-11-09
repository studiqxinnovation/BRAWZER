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
import { Badge } from "@brawzer/ui/components/badge";
import { Button } from "@brawzer/ui/components/button";
import { EmptyState } from "@brawzer/ui/components/empty-state";
import { Field, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Select } from "@brawzer/ui/components/select";
import { useToast } from "@brawzer/ui/components/toast";
import { Mail, UserPlus, Users } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { Panel, SectionHeading } from "@/components/app-shell/page";
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
  { value: "member", label: "Member: uses the team’s plan, proxies and Drive" },
  { value: "admin", label: "Admin: also invites, removes members and manages proxies" },
] as const;

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
    <div className="flex flex-col gap-10">
      {overview.invitations.length > 0 && (
        <section aria-labelledby="team-invitations" className="flex flex-col gap-4">
          <SectionHeading id="team-invitations">Invitations for you</SectionHeading>
          <Panel>
            <ul aria-label="Invitations for you" className="divide-y divide-line">
              {overview.invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-callout font-medium text-ink">{invitation.teamName}</p>
                    <p className="text-footnote text-ink-secondary">
                      {invitation.invitedBy ? `From ${invitation.invitedBy}, as ` : "As "}
                      {invitation.role === "admin" ? "an admin" : "a member"} · until{" "}
                      <LocalDate iso={invitation.expiresAt} />
                    </p>
                  </div>
                  <div className="flex gap-2">
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
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <p className="text-footnote text-ink-secondary">
            Joining puts you on the team owner’s plan. A subscription of your own has to end first.
          </p>
        </section>
      )}

      <section aria-labelledby="team-start" className="flex flex-col gap-4">
        <SectionHeading id="team-start">Start a team</SectionHeading>
        {canStart ? (
          <Panel className="flex flex-col gap-4 p-5">
            <p className="text-callout text-ink-secondary">
              You’ll own it: everyone you invite uses your plan, which allows{" "}
              {String(overview.seats)} people, you included.
            </p>
            <form
              method="post"
              noValidate
              onSubmit={(event) => void submit(event)}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <Field className="flex-1">
                <FieldLabel htmlFor="team-name">Team name</FieldLabel>
                <Input
                  id="team-name"
                  name="name"
                  autoComplete="organization"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              </Field>
              <Button type="submit" variant="primary" loading={busy === "create"}>
                <Users aria-hidden="true" />
                Start team
              </Button>
            </form>
            {error && (
              <FormMessage tone="danger" title="The team wasn’t started">
                {error}
              </FormMessage>
            )}
          </Panel>
        ) : (
          <EmptyState
            icon={<Users />}
            title="Your plan doesn’t include a team"
            description="A plan with team members, chosen on the Account page, lets you start one."
          />
        )}
      </section>
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
    <div className="flex flex-col gap-10">
      <TeamName team={team} busy={busy} run={run} />

      <section aria-labelledby="team-members" className="flex flex-col gap-4">
        <SectionHeading id="team-members">People</SectionHeading>
        <p className="text-footnote text-ink-secondary">
          {String(team.members.length)} of {String(team.seats)} on the {team.planName} plan
          {team.invitations.length > 0 ? `, and ${String(team.invitations.length)} invited` : ""}.
        </p>
        <Panel>
          <ul aria-label="Team members" className="divide-y divide-line">
            {team.members.map((member) => {
              const self = member.email === me;
              const canRemove =
                !self &&
                member.role !== "owner" &&
                (team.role === "owner" || (team.role === "admin" && member.role === "member"));
              return (
                <li
                  key={member.userId}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-callout font-medium text-ink">
                      <span className="truncate">{member.email}</span>
                      {self && <span className="text-footnote text-ink-secondary">(you)</span>}
                      <Badge tone={member.role === "owner" ? "accent" : "neutral"}>
                        {ROLE_LABELS[member.role]}
                      </Badge>
                    </p>
                    <p className="text-footnote text-ink-secondary">
                      Joined <LocalDate iso={member.joinedAt} />
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
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
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setConfirming({ kind: "remove", member });
                        }}
                      >
                        Remove<span className="sr-only"> {member.email}</span>
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </section>

      {manages && <Invitations team={team} full={taken >= team.seats} busy={busy} run={run} />}

      <section aria-labelledby="team-leave" className="flex flex-col gap-4">
        <SectionHeading id="team-leave">
          {team.role === "owner" ? "Delete the team" : "Leave the team"}
        </SectionHeading>
        <Panel className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
          <p className="flex-1 text-callout text-ink-secondary">
            {team.role === "owner"
              ? "Its shared proxies and Drive space are deleted, and everyone goes back to their own plan. To leave instead, hand the team to someone first."
              : "You go back to your own plan. What you put in the team’s Drive stays with the team."}
          </p>
          <Button
            variant="danger"
            onClick={() => {
              setConfirming(team.role === "owner" ? { kind: "delete" } : { kind: "leave" });
            }}
          >
            {team.role === "owner" ? "Delete team" : "Leave team"}
          </Button>
        </Panel>
      </section>

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

function TeamName({ team, busy, run }: { team: Team; busy: string | null; run: Run }) {
  const [name, setName] = useState(team.name);
  const [error, setError] = useState<string | null>(null);
  const manages = team.role === "owner" || team.role === "admin";

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
    <Panel className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Users aria-hidden="true" className="size-5 text-ink-secondary" />
        <h2 className="text-title-3 text-ink">{team.name}</h2>
        <Badge tone="neutral">You: {ROLE_LABELS[team.role]}</Badge>
      </div>
      <p className="text-callout text-ink-secondary">
        Everyone here uses the {team.planName} plan, started <LocalDate iso={team.createdAt} />.
      </p>
      {manages && (
        <form
          method="post"
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <Field className="flex-1">
            <FieldLabel htmlFor="team-rename">Team name</FieldLabel>
            <Input
              id="team-rename"
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
            loading={busy === "rename"}
            disabled={name.trim() === team.name}
          >
            Rename
          </Button>
        </form>
      )}
      {error && (
        <FormMessage tone="danger" title="The name wasn’t changed">
          {error}
        </FormMessage>
      )}
    </Panel>
  );
}

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
    <section aria-labelledby="team-invite" className="flex flex-col gap-4">
      <SectionHeading id="team-invite">Invite someone</SectionHeading>
      <Panel className="flex flex-col gap-4 p-5">
        <p className="text-callout text-ink-secondary">
          They get an email, and join from their own Team page once they’re signed in with that
          address. An invitation lasts 7 days and holds a place in the team.
        </p>
        <form
          method="post"
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field className="flex-1">
              <FieldLabel htmlFor="team-invite-email">Email address</FieldLabel>
              <Input
                id="team-invite-email"
                name="email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            </Field>
            <Select
              className="sm:w-80"
              label="Role"
              options={ROLE_OPTIONS}
              value={role}
              onValueChange={setRole}
            />
          </div>
          <div>
            <Button type="submit" variant="primary" loading={busy === "invite"} disabled={full}>
              <UserPlus aria-hidden="true" />
              Send invitation
            </Button>
          </div>
        </form>
        {full && (
          <p className="text-footnote text-ink-secondary">
            The team is full: its plan allows {String(team.seats)} people, invitations included.
          </p>
        )}
        {error && (
          <FormMessage tone="danger" title="The invitation wasn’t sent">
            {error}
          </FormMessage>
        )}
      </Panel>
      {team.invitations.length > 0 && (
        <Panel>
          <ul aria-label="Waiting invitations" className="divide-y divide-line">
            {team.invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-callout text-ink">
                    <Mail aria-hidden="true" className="size-4 text-ink-secondary" />
                    <span className="truncate">{invitation.email}</span>
                    <Badge tone="neutral">{ROLE_LABELS[invitation.role]}</Badge>
                  </p>
                  <p className="text-footnote text-ink-secondary">
                    Until <LocalDate iso={invitation.expiresAt} />
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy === `withdraw-${invitation.id}`}
                  onClick={() =>
                    void run(
                      `withdraw-${invitation.id}`,
                      () => withdrawInvitation(invitation.id),
                      "Invitation withdrawn",
                    )
                  }
                >
                  Withdraw<span className="sr-only"> the invitation to {invitation.email}</span>
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </section>
  );
}
