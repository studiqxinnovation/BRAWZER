# ADR 0019: Team accounts

- **Status:** Accepted
- **Date:** 2026-11-08
- **Builds on:** [ADR 0008](0008-secrets-and-step-up.md), [ADR 0011](0011-drive-encryption-and-scanning.md), [ADR 0015](0015-plans-and-billing.md)

## Context

Plans, billing and administration were built for one person (Phase 6 left
"team accounts, seats" out on purpose), and the pricing content names
"team accounts and administration" as something plans differ in. People
who work together want one plan paid by one person, a shared list of
proxies, and a place for shared files, without giving up what is their own:
profiles hold sign-ins and cookies, and stay personal.

## Decision

### One team per person, three roles

A team has members with a role: exactly one **owner**, any number of
**admins** and **members** (`team_members`, a person in at most one team,
one owner per team enforced by a partial unique index). The owner runs the
team and pays for it; admins invite, remove members and manage the team's
proxies; members use what the team shares. Only the owner changes roles,
removes admins, hands the team to another member (who then pays) or deletes
it; handing over and deleting need a recent sign-in.

### Invitations to an address, taken up from the account

An owner or admin invites an email address with a role. The invitation is a
row, not a token: the email only points to the Team page, and the verified
account with that address sees the invitation there and joins or declines.
Nothing in the email does anything by itself, so a forwarded or leaked
email gives nobody a seat. Invitations last 7 days, count against the
team's size while they wait, and are deleted by the retention job when they
expire. Starting a team, or joining one, deletes invitations to that
address from other teams.

### The owner's plan, for everyone

`BillingService.limitsFor`, which every module asks, answers with the team
owner's plan for a member. A plan's new `teamMembers` limit is how many
people its teams may have, owner included; 1 means no team. The built-in
free plan allows 3 (and a configured plan that doesn't say gets the same),
so a team works on an installation with no paid plans; operators set their
own sizes in `BILLING_PLANS`. A member can't start a checkout (their plan
comes from the team), and someone who pays for a subscription of their own
can't join until it ends, so nobody pays twice. A team over its size after
a plan change keeps its members; only new invitations are refused.

Each member's usage still counts on its own (profiles, Drive, browsing
minutes per account), as seats on a plan do.

### What a team shares

- **Proxies.** A proxy row may belong to a team instead of a person. The
  owner and admins add, change, test and remove them; every member can
  choose them for their own profiles but, as with their own proxies, never
  sees the credentials. Team proxies count against the owner's plan's proxy
  limit, separately from anyone's own. Their credentials are sealed to the
  team (`proxy-credentials:team:<team>:<proxy>`), so they stay usable when
  whoever added them leaves, and a proxy's name is unique per owner, person
  or team.
- **A Drive space.** Drive rows may belong to a team. Every member lists,
  previews, downloads, uploads to and organises the team's space; deleting
  is for the person who added a file, the owner and admins. The team space
  has the owner's plan's Drive limits, separately from anyone's own Drive.
  A team file's key is bound to the team (`drive-file:team:<team>:<object>`),
  not to whoever uploaded it, so it stays readable when that person leaves.

### Leaving keeps what was shared

When someone leaves or is removed, files they added to the team's Drive
stay with the team (credited to the owner), their profiles stop using the
team's proxies (set back to no proxy), and a cloud browser session of
theirs that browses through one ends (the end reason `team_left`). Deleting a team deletes its
proxies and its Drive space (objects included) and nothing anyone owns. An
owner can't delete their account while others are in the team; a team they
own alone goes with the account.

### Recorded

Starting, joining, leaving, removal, role changes, hand-over, deletion and
invitations are in the security history of the person they concern; a
history never shows the device or address of someone else who acted. The
data download names the team and the person's role.

## Consequences

- One person, one team: someone in two organisations uses two accounts.
- Profiles, sessions, site rules and extensions stay personal; a shared
  profile would share sign-ins, which this design avoids.
- Seats are counted, not billed per seat: the owner's plan sets the size.
