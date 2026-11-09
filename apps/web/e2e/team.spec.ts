import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { createConfirmedAccount, emailText, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "amber-orchard-compass";

test.describe("team", () => {
  test("starts a team, invites by email, and the invited person joins from their Team page", async ({
    page,
    browser,
    baseURL,
  }) => {
    const ownerEmail = uniqueEmail("team-owner");
    await createConfirmedAccount(page.request, baseURL ?? "", ownerEmail, PASSWORD);
    await signIn(page.context(), baseURL ?? "", ownerEmail, PASSWORD);
    await page.goto("/app/team");
    await expect(page.getByRole("heading", { name: "Start a team" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    const teamName = `Studio ${randomUUID().slice(0, 6)}`;
    await page.getByRole("textbox", { name: "Team name" }).fill(teamName);
    await page.getByRole("button", { name: "Start team" }).click();
    await expect(page.getByRole("heading", { name: teamName, exact: true })).toBeVisible();
    const members = page.getByRole("list", { name: "Team members" });
    await expect(members).toContainText(ownerEmail);
    await expect(members).toContainText("Owner");

    // An invitation by email, waiting until the person joins.
    const memberEmail = uniqueEmail("team-member");
    await page.getByRole("textbox", { name: "Email address" }).fill(memberEmail);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(`Invitation sent to ${memberEmail}`)).toBeVisible();
    await expect(page.getByRole("list", { name: "Waiting invitations" })).toContainText(
      memberEmail,
    );
    expect(await wcagViolations(page)).toEqual([]);
    expect(
      await emailText(page.request, memberEmail, `invited you to the team “${teamName}”`),
    ).toContain("/app/team");

    // The invited address creates an account and joins from its own Team page.
    const member = await browser.newContext({ baseURL });
    await createConfirmedAccount(member.request, baseURL ?? "", memberEmail, PASSWORD);
    await signIn(member, baseURL ?? "", memberEmail, PASSWORD);
    const memberPage = await member.newPage();
    await memberPage.goto("/app/team");
    const invitations = memberPage.getByRole("list", { name: "Invitations for you" });
    await expect(invitations).toContainText(teamName);
    await expect(invitations).toContainText(`From ${ownerEmail}`);
    expect(await wcagViolations(memberPage)).toEqual([]);
    await invitations.getByRole("button", { name: `Join ${teamName}` }).click();
    await expect(memberPage.getByText(`You’re in ${teamName}`)).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: teamName, exact: true })).toBeVisible();
    // A member doesn't invite or rename.
    await expect(memberPage.getByRole("heading", { name: "Invite someone" })).toHaveCount(0);
    await expect(memberPage.getByRole("button", { name: "Leave team" })).toBeVisible();
    // Their plan comes from the team.
    await memberPage.goto("/app/account");
    await expect(memberPage.getByText("From your team")).toBeVisible();
    await expect(memberPage.getByText(`${ownerEmail} pays for it`)).toBeVisible();

    // The owner sees them, makes them an admin, then removes them.
    await page.reload();
    await expect(members).toContainText(memberEmail);
    await page.getByRole("button", { name: `Make admin ${memberEmail}` }).click();
    await expect(page.getByText(`${memberEmail} is an admin now`)).toBeVisible();
    await page.getByRole("button", { name: `Remove ${memberEmail}` }).click();
    const confirmRemove = page.getByRole("alertdialog", { name: `Remove ${memberEmail}?` });
    await confirmRemove.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText(`${memberEmail} is no longer in the team`)).toBeVisible();
    await expect(members).not.toContainText(memberEmail);

    await memberPage.goto("/app/team");
    await expect(memberPage.getByRole("heading", { name: "Start a team" })).toBeVisible();
    await member.close();

    // Deleting the team takes the owner back to the start.
    await page.getByRole("button", { name: "Delete team" }).click();
    const confirmDelete = page.getByRole("alertdialog", { name: `Delete ${teamName}?` });
    await confirmDelete.getByRole("button", { name: "Delete team" }).click();
    await expect(page.getByText(`${teamName} was deleted`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Start a team" })).toBeVisible();
  });
});
