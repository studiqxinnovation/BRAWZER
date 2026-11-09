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

    // The owner adds a team proxy; the member sees it and can't change it.
    await page.goto("/app/proxy");
    await page.getByRole("button", { name: "Add team proxy" }).click();
    const add = page.getByRole("dialog", { name: "Add a team proxy" });
    await add.getByRole("textbox", { name: "Name", exact: true }).fill("Team exit");
    await add.getByRole("textbox", { name: "Host", exact: true }).fill("proxy.example.com");
    await add.getByRole("textbox", { name: "Port", exact: true }).fill("1080");
    await add.getByRole("button", { name: "Add proxy" }).click();
    await expect(add).toBeHidden();
    await expect(page.getByRole("list", { name: "Team proxies" })).toContainText("Team exit");
    await memberPage.goto("/app/proxy");
    const shared = memberPage.getByRole("list", { name: "Team proxies" });
    await expect(shared).toContainText("Team exit");
    await expect(shared.getByRole("button", { name: "Edit Team exit" })).toHaveCount(0);
    await expect(memberPage.getByText("Shared by your team")).toBeVisible();
    expect(await wcagViolations(memberPage)).toEqual([]);

    // The team's Drive: the owner adds a file, the member opens it and can't delete it.
    await page.goto("/app/drive");
    await page.getByRole("link", { name: `${teamName}’s Drive` }).click();
    await expect(page.getByText("Nothing in the team’s Drive yet")).toBeVisible();
    await page
      .getByTestId("drive-file-input")
      .setInputFiles({
        name: "team-plan.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Q4\n"),
      });
    const ownerFiles = page.getByRole("list", { name: "Files and folders" });
    await expect(ownerFiles).toContainText("team-plan.txt", { timeout: 15_000 });
    await memberPage.goto("/app/drive?space=team");
    const memberFiles = memberPage.getByRole("list", { name: "Files and folders" });
    await expect(memberFiles).toContainText("team-plan.txt");
    expect(await wcagViolations(memberPage)).toEqual([]);
    await memberFiles.getByRole("button", { name: "Actions for team-plan.txt" }).click();
    await expect(memberPage.getByRole("menuitem", { name: "Preview" })).toBeVisible();
    await expect(memberPage.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
    await memberPage.keyboard.press("Escape");
    // Their own Drive doesn't hold it.
    await memberPage.getByRole("link", { name: "My Drive" }).click();
    await expect(memberPage.getByText("Nothing in Drive yet")).toBeVisible();

    // The owner sees them, makes them an admin, then removes them.
    await page.goto("/app/team");
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
