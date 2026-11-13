import { expect, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { makeAdministrator, setRole } from "./database";
import { createConfirmedAccount, linkFromEmail, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "copper-meadow-signal";

test.describe("account recovery", () => {
  test.skip(({ isMobile }) => isMobile, "The console is a desk tool; one run covers it.");

  test("the owner confirms by email, one person checks, another releases", async ({
    page,
    browser,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const ownerEmail = uniqueEmail("owner");
    const setup = await browser.newContext({ baseURL });
    await createConfirmedAccount(setup.request, base, ownerEmail, PASSWORD);
    await setup.close();

    // Signed out, the owner asks for recovery and confirms from the email.
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Lost your passkey or authenticator?" }).click();
    await expect(page.getByRole("heading", { name: "Recover your account" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await page.getByRole("textbox", { name: "Email" }).fill(ownerEmail);
    await page.getByRole("button", { name: "Email me a confirmation link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const confirmLink = await linkFromEmail(
      page.request,
      ownerEmail,
      "Confirm your Brawzer account recovery",
      base,
    );
    await page.goto(confirmLink);
    await expect(page.getByRole("heading", { name: "Recovery confirmed" })).toBeVisible();
    await expect(page.getByText("48-hour wait")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // Care records a check and completes the review.
    const careEmail = uniqueEmail("care");
    const care = await browser.newContext({ baseURL });
    await createConfirmedAccount(care.request, base, careEmail, PASSWORD);
    await setRole(careEmail, "care");
    await signIn(care, base, careEmail, PASSWORD);
    const desk = await care.newPage();
    await desk.goto("/admin/recovery");
    await expect(desk.getByRole("heading", { level: 1, name: "Account recovery" })).toBeVisible();
    const handle = ownerEmail.split("@")[0] ?? "";
    const row = desk.getByRole("row").filter({ hasText: handle });
    await expect(row).toContainText("Waiting period");
    await expect(row.getByRole("button", { name: "Approve release" })).toBeDisabled();
    await row.getByRole("button", { name: "Checks", exact: true }).click();
    const check = desk.getByRole("dialog", { name: `Record a check for ${handle}` });
    await check.getByLabel("Check").selectOption("invoice");
    await check.getByLabel("Result").selectOption("yes");
    await check.getByLabel(/^Note/).fill("Named the October invoice.");
    await check.getByRole("button", { name: "Record" }).click();
    await expect(check).toBeHidden();
    await expect(row).toContainText("5 pts");
    await row.getByRole("button", { name: "Checks complete" }).click();
    await expect(row).toContainText(`Checks complete · ${careEmail}`);
    expect(await wcagViolations(desk)).toEqual([]);
    await care.close();

    // A founder releases early, with a reason, and the owner gets the password link.
    const founderEmail = uniqueEmail("founder");
    const founder = await browser.newContext({ baseURL });
    await createConfirmedAccount(founder.request, base, founderEmail, PASSWORD);
    await makeAdministrator(founderEmail);
    await signIn(founder, base, founderEmail, PASSWORD);
    const console = await founder.newPage();
    await console.goto("/admin/recovery");
    const founderRow = console.getByRole("row").filter({ hasText: handle });
    await founderRow.getByRole("button", { name: "Approve release" }).click();
    const release = console.getByRole("dialog", { name: /^Release / });
    await expect(release.getByText("THE 48-HOUR WAIT ISN’T OVER.")).toBeVisible();
    await release
      .getByLabel("Reason (required, saved to the audit log)")
      .fill("Customer on the phone, invoice confirmed");
    await release.getByRole("button", { name: "Approve release" }).click();
    await expect(release).toBeHidden();
    await expect(founderRow).toContainText("Released EARLY");
    const resetLink = await linkFromEmail(
      console.request,
      ownerEmail,
      "Your Brawzer account is released",
      base,
    );
    expect(resetLink).toContain("/reset-password");
    await founder.close();
  });

  test("the owner can cancel from the email, and the case says so", async ({
    page,
    browser,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const ownerEmail = uniqueEmail("owner");
    const setup = await browser.newContext({ baseURL });
    await createConfirmedAccount(setup.request, base, ownerEmail, PASSWORD);
    await setup.close();

    await page.goto("/recover");
    await page.getByRole("textbox", { name: "Email" }).fill(ownerEmail);
    await page.getByRole("button", { name: "Email me a confirmation link" }).click();
    await page.goto(
      await linkFromEmail(page.request, ownerEmail, "Confirm your Brawzer account recovery", base),
    );
    await expect(page.getByRole("heading", { name: "Recovery confirmed" })).toBeVisible();
    await page.goto(await linkFromEmail(page.request, ownerEmail, "48-hour wait", base));
    await expect(page.getByRole("heading", { name: "Recovery cancelled" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    const founderEmail = uniqueEmail("founder");
    const founder = await browser.newContext({ baseURL });
    await createConfirmedAccount(founder.request, base, founderEmail, PASSWORD);
    await makeAdministrator(founderEmail);
    await signIn(founder, base, founderEmail, PASSWORD);
    const console = await founder.newPage();
    await console.goto("/admin/recovery");
    const row = console.getByRole("row").filter({ hasText: ownerEmail.split("@")[0] ?? "" });
    await expect(row).toContainText("Denied");
    await expect(row).toContainText("Cancelled by owner: possible takeover");
    await founder.close();
  });
});
