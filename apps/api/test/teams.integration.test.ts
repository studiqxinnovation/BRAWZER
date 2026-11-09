import {
  accountExportSchema,
  billingOverviewSchema,
  type TeamOverview,
  teamOverviewSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";

let h: Harness;

const TEAM_PLAN = {
  code: "team",
  name: "Team",
  stripePriceId: "price_team_month",
  limits: {
    profiles: 7,
    proxies: 9,
    driveBytes: 50 * 1024 * 1024,
    driveFiles: 50,
    driveFolders: 10,
    browsingMinutesPerMonth: null,
    liveSessions: 1,
    teamMembers: 4,
  },
};

const SOLO_PLAN = {
  ...TEAM_PLAN,
  code: "solo",
  name: "Solo",
  stripePriceId: "price_solo_month",
  limits: { ...TEAM_PLAN.limits, teamMembers: 1 },
};

beforeAll(async () => {
  h = await createHarness({
    ipPrefix: "100.81.0",
    env: { BILLING_PLANS: JSON.stringify([TEAM_PLAN, SOLO_PLAN]) },
  });
  await h.listen();
});

afterAll(async () => {
  await h.close();
});

async function person(tag: string) {
  const client = h.browser();
  const email = h.uniqueEmail(tag);
  await h.signUp(client, email);
  return { client, email };
}

async function team(client: TestBrowser): Promise<TeamOverview> {
  const response = await client.get("/team");
  expect(response.statusCode, response.body).toBe(200);
  return teamOverviewSchema.parse(response.json());
}

const ok = (response: { statusCode: number; body: string }) => {
  expect(response.statusCode, response.body).toBe(200);
  return teamOverviewSchema.parse(JSON.parse(response.body));
};

async function setPlan(email: string, code: string) {
  await h.database.pool.query("update users set plan_code = $1 where email = $2", [code, email]);
}

async function history(client: TestBrowser) {
  return (await client.get("/security/events")).json<{
    events: { type: string; details: { team?: string; role?: string } }[];
  }>().events;
}

describe("team accounts", () => {
  it("invites by address, joins from the Team page, and shares the owner's plan", async () => {
    const owner = await person("team-owner");
    expect(await team(owner.client)).toEqual({ team: null, invitations: [], seats: 3 });

    for (const name of ["", "  ", "Bad\nname", "x".repeat(61)]) {
      expect((await owner.client.post("/team", { name })).statusCode).toBe(400);
    }
    let view = ok(await owner.client.post("/team", { name: "Studio Q" }));
    expect(view.team).toMatchObject({
      name: "Studio Q",
      role: "owner",
      seats: 3,
      planName: "Free",
      members: [{ email: owner.email, role: "owner" }],
    });
    expect((await owner.client.post("/team", { name: "Another" })).statusCode).toBe(409);

    // Invitations take seats; the address is stored as accounts store it.
    const member = h.uniqueEmail("team-member");
    const admin = h.uniqueEmail("team-admin");
    view = ok(
      await owner.client.post("/team/invitations", { email: member.toUpperCase(), role: "member" }),
    );
    view = ok(await owner.client.post("/team/invitations", { email: admin, role: "admin" }));
    expect(view.team?.invitations.map((invitation) => [invitation.email, invitation.role])).toEqual(
      [
        [admin, "admin"],
        [member, "member"],
      ].sort(),
    );
    const full = await owner.client.post("/team/invitations", {
      email: h.uniqueEmail("team-extra"),
      role: "member",
    });
    expect(full.statusCode).toBe(409);
    expect(h.errorOf(full).message).toContain("allows 3 people");
    expect(await h.waitForEmail(member, "invited you to the team “Studio Q”")).toContain(
      "/app/team",
    );

    // The invited address sees it once it has a verified account, and joins from there.
    const memberClient = h.browser();
    await h.signUp(memberClient, member);
    const waiting = await team(memberClient);
    expect(waiting.team).toBeNull();
    expect(waiting.invitations).toMatchObject([
      { teamName: "Studio Q", invitedBy: owner.email, role: "member" },
    ]);
    const invitationId = waiting.invitations[0]?.id ?? "";
    // Nobody else can take it up.
    const stranger = await person("team-stranger");
    expect(
      (await stranger.client.post(`/team/invitations/${invitationId}/join`, {})).statusCode,
    ).toBe(404);
    view = ok(await memberClient.post(`/team/invitations/${invitationId}/join`, {}));
    expect(view.team?.role).toBe("member");
    expect(view.team?.invitations).toEqual([]);
    expect(view.team?.members.map((entry) => entry.role)).toEqual(["owner", "member"]);

    // The admin's invitation is declined; its seat is free again.
    const adminClient = h.browser();
    await h.signUp(adminClient, admin);
    const adminInvitation = (await team(adminClient)).invitations[0]?.id ?? "";
    expect(
      ok(await adminClient.post(`/team/invitations/${adminInvitation}/decline`, {})).invitations,
    ).toEqual([]);
    expect((await owner.client.get("/team")).json<TeamOverview>().team?.invitations).toEqual([]);

    // A member can't run the team.
    expect((await memberClient.patch("/team", { name: "Mine now" })).statusCode).toBe(403);
    expect(
      (await memberClient.post("/team/invitations", { email: h.uniqueEmail("x"), role: "member" }))
        .statusCode,
    ).toBe(403);

    // The owner's plan applies to every member, and a member can't buy their own.
    await setPlan(owner.email, "team");
    const billing = billingOverviewSchema.parse((await memberClient.get("/billing")).json());
    expect(billing.plan.code).toBe("team");
    expect(billing.plan.limits.profiles).toBe(7);
    expect(billing.team).toEqual({ name: "Studio Q", owner: owner.email });
    const checkout = await memberClient.post("/billing/checkout", { planCode: "team" });
    expect(checkout.statusCode).toBe(409);
    expect(h.errorOf(checkout).message).toContain("Your plan comes from your team");
    expect(ok(await owner.client.get("/team")).team?.seats).toBe(4);
    const ownerBilling = billingOverviewSchema.parse((await owner.client.get("/billing")).json());
    expect(ownerBilling.team).toBeNull();

    // The owner makes the member an admin; an admin invites, and is told about roles.
    view = ok(
      await owner.client.patch(`/team/members/${view.team?.members[1]?.userId ?? ""}`, {
        role: "admin",
      }),
    );
    expect(view.team?.members.map((entry) => entry.role)).toEqual(["owner", "admin"]);
    const third = await person("team-third");
    ok(await memberClient.post("/team/invitations", { email: third.email, role: "member" }));
    const thirdInvitation = (await team(third.client)).invitations[0]?.id ?? "";
    ok(await third.client.post(`/team/invitations/${thirdInvitation}/join`, {}));

    // Someone with a subscription of their own can't join: the owner's plan would replace it.
    const subscribed = await person("team-subscribed");
    await h.database.pool.query(
      `insert into subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan_code)
       select id, $2, $3, 'active', 'team' from users where email = $1`,
      [subscribed.email, `cus_${subscribed.email}`, `sub_${subscribed.email}`],
    );
    ok(await owner.client.post("/team/invitations", { email: subscribed.email, role: "member" }));
    const subscribedInvitation = (await team(subscribed.client)).invitations[0]?.id ?? "";
    const refused = await subscribed.client.post(
      `/team/invitations/${subscribedInvitation}/join`,
      {},
    );
    expect(refused.statusCode).toBe(409);
    expect(h.errorOf(refused).message).toContain("subscription of your own");

    // Removing and leaving; each person's history says so, without the other's device.
    const thirdId =
      ok(await owner.client.get("/team")).team?.members.find((entry) => entry.email === third.email)
        ?.userId ?? "";
    ok(await owner.client.delete(`/team/members/${thirdId}`));
    expect((await team(third.client)).team).toBeNull();
    const removed = (await history(third.client)).find(
      (event) => event.type === "team.member_removed",
    );
    expect(removed?.details.team).toBe("Studio Q");
    expect((await owner.client.post("/team/leave", {})).statusCode).toBe(403);

    // The data download says which team the account is in.
    const exported = accountExportSchema.parse((await memberClient.get("/account/export")).json());
    expect(exported.team).toMatchObject({ name: "Studio Q", role: "admin" });

    // The owner can't delete their account while others are in the team.
    const blocked = await owner.client.post("/account/delete", { email: owner.email });
    expect(blocked.statusCode).toBe(409);
    expect(h.errorOf(blocked).message).toContain("You own a team with other members");

    // Handing the team over: the new owner's plan applies, the old owner becomes an admin.
    const memberId =
      ok(await owner.client.get("/team")).team?.members.find((entry) => entry.email === member)
        ?.userId ?? "";
    view = ok(await owner.client.post("/team/transfer", { userId: memberId }));
    expect(view.team?.role).toBe("admin");
    expect(view.team?.seats).toBe(3);
    expect(view.team?.planName).toBe("Free");
    const ownerNow = billingOverviewSchema.parse((await owner.client.get("/billing")).json());
    expect(ownerNow.team).toEqual({ name: "Studio Q", owner: member });
    expect(ownerNow.plan.code).toBe("free");

    // The new owner deletes the team; the old owner is told in their history.
    view = ok(await memberClient.delete("/team"));
    expect(view.team).toBeNull();
    expect((await team(owner.client)).team).toBeNull();
    expect((await history(owner.client)).map((event) => event.type)).toEqual(
      expect.arrayContaining(["team.created", "team.ownership_transferred", "team.deleted"]),
    );
    const ownerAfter = billingOverviewSchema.parse((await owner.client.get("/billing")).json());
    expect(ownerAfter.plan.code).toBe("team");
  });

  it("deletes a team its owner leaves alone with their account, and refuses a team on a one-person plan", async () => {
    const solo = await person("team-solo");
    const teamId = ok(await solo.client.post("/team", { name: "Just me" })).team?.id ?? "";
    const deleted = await solo.client.post("/account/delete", { email: solo.email });
    expect(deleted.statusCode, deleted.body).toBe(204);
    const left = await h.database.pool.query<{ count: number }>(
      "select count(*)::int as count from teams where id = $1",
      [teamId],
    );
    expect(left.rows[0]?.count).toBe(0);

    const lone = await person("team-lone");
    await setPlan(lone.email, "solo");
    const refused = await lone.client.post("/team", { name: "Room for one" });
    expect(refused.statusCode).toBe(409);
    expect(h.errorOf(refused).message).toContain("Your plan doesn’t include a team");
  });
});
