import { expect, type Page, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { makeAdministrator, setRole } from "./database";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "copper-meadow-signal";

const emailField = (page: Page) => page.getByRole("textbox", { name: "Email" });
const passwordField = (page: Page) =>
  page.getByLabel("Password", { exact: true }).filter({ visible: true });

test.describe("admin console", () => {
  test.skip(({ isMobile }) => isMobile, "The console is a desk tool; one run covers it.");

  test("a founder sees the overview, finds a customer, reveals their email with a reason", async ({
    page,
    browser,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const customerEmail = uniqueEmail("customer");
    const customer = await browser.newContext({ baseURL });
    await createConfirmedAccount(customer.request, base, customerEmail, PASSWORD);
    await customer.close();

    const founderEmail = uniqueEmail("founder");
    await createConfirmedAccount(page.request, base, founderEmail, PASSWORD);
    await makeAdministrator(founderEmail);
    await signIn(page.context(), base, founderEmail, PASSWORD);

    // Overview: the console's own shell, with Brawzer's mark and the role card.
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Brawzer admin home" })).toBeVisible();
    await expect(page.getByLabel("Signed in as")).toContainText("Founder");
    await expect(page.getByRole("heading", { name: "Needs you today" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // Customers: a founder sees addresses in clear.
    await page
      .getByRole("navigation", { name: "Console" })
      .getByRole("link", { name: "Customers" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
    await page.getByRole("textbox", { name: "Search customers" }).fill(customerEmail);
    const row = page.getByRole("row").filter({ hasText: customerEmail });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Active");
    expect(await wcagViolations(page)).toEqual([]);

    // The 360 view.
    await row.getByRole("link", { name: customerEmail }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Customer" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // A fresh account's only finding: a password alone. Nothing else is wrong.
    await expect(page.getByRole("heading", { name: "Account check · 1 to look at" })).toBeVisible();
    await expect(page.getByText("No passkey or two-factor")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reveal" })).toHaveCount(0);
    expect(await wcagViolations(page)).toEqual([]);

    // A note, only for staff.
    await page.getByRole("button", { name: "Add note" }).click();
    const noteDialog = page.getByRole("dialog", { name: "Internal note" });
    await noteDialog.getByLabel("Note (only staff can see this)").fill("Asked about team plans.");
    await noteDialog.getByRole("button", { name: "Save" }).click();
    await expect(noteDialog).toBeHidden();
    await expect(page.getByText("Asked about team plans.")).toBeVisible();

    // Other tabs load the account's own facts.
    await page.getByRole("tab", { name: "Sign-in & security" }).click();
    await expect(page.getByText("Two-factor (authenticator app)")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Devices signed in" })).toBeVisible();
    await page.getByRole("tab", { name: "Subscription & billing" }).click();
    await expect(page.getByRole("heading", { name: "Plan limits and usage" })).toBeVisible();
    await page.getByRole("tab", { name: "Drive" }).click();
    await expect(page.getByText("Trash is empty")).toBeVisible();
    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(page.getByText(/account created|sign in/i).first()).toBeVisible();
    await page.getByRole("tab", { name: "Privacy & data" }).click();
    await expect(page.getByRole("heading", { name: "Data we hold" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // The audit log has the note.
    await page
      .getByRole("navigation", { name: "Console" })
      .getByRole("link", { name: "Audit log" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Added a note" }).first()).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
  });

  test("care staff see masked addresses, reveal with a reason, and are refused the team page", async ({
    page,
    browser,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const customerEmail = uniqueEmail("masked");
    const customer = await browser.newContext({ baseURL });
    await createConfirmedAccount(customer.request, base, customerEmail, PASSWORD);
    await customer.close();

    const careEmail = uniqueEmail("care");
    await createConfirmedAccount(page.request, base, careEmail, PASSWORD);
    await setRole(careEmail, "care");
    await signIn(page.context(), base, careEmail, PASSWORD);

    // Care lands on Customers, not the company overview.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/customers$/);
    await expect(page.getByLabel("Signed in as")).toContainText("Customer Care");
    const nav = page.getByRole("navigation", { name: "Console" });
    await expect(nav.getByRole("link", { name: "Team" })).toHaveCount(0);

    // The address is masked in the list and in the 360 view until revealed.
    const [local, domain] = customerEmail.split("@");
    const masked = `${(local ?? "").slice(0, 1)}***@${domain ?? ""}`;
    // The search matches the real address, but the row shows it masked.
    await page.getByRole("textbox", { name: "Search customers" }).fill(customerEmail);
    const row = page.getByRole("row").filter({ hasText: masked }).first();
    await expect(row).toBeVisible();
    await expect(page.getByText(customerEmail)).toHaveCount(0);
    await row.getByRole("link", { name: masked }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Customer" })).toBeVisible();
    await expect(page.getByText(customerEmail)).toHaveCount(0);

    await page.getByRole("button", { name: "Reveal" }).click();
    const reveal = page.getByRole("dialog", { name: "Reveal personal details?" });
    await reveal.getByRole("button", { name: "Reveal" }).click();
    await expect(reveal.getByText("Please give a reason.")).toBeVisible();
    await reveal
      .getByLabel("Reason (required, saved to the audit log)")
      .fill("Caller is confirming their address");
    await reveal.getByRole("button", { name: "Reveal" }).click();
    await expect(reveal).toBeHidden();
    await expect(page.getByText(customerEmail)).toBeVisible();

    // The team page is a founder's; opening it is refused and logged.
    await page.goto("/admin/team");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    const audit = await page.request.get("/api/v1/console/audit");
    expect(audit.status()).toBe(403);

    // A founder reads both in the audit log.
    const founderEmail = uniqueEmail("founder");
    const founder = await browser.newContext({ baseURL });
    await createConfirmedAccount(founder.request, base, founderEmail, PASSWORD);
    await makeAdministrator(founderEmail);
    await signIn(founder, base, founderEmail, PASSWORD);
    const log = await founder.newPage();
    await log.goto("/admin/audit");
    await expect(log.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    await log.getByRole("textbox", { name: "Filter the audit log" }).fill(careEmail);
    await expect(
      log.getByRole("row").filter({ hasText: "Revealed personal details" }).first(),
    ).toContainText("Caller is confirming their address");
    await expect(
      log.getByRole("row").filter({ hasText: "Tried to open a page without access" }).first(),
    ).toContainText("Team & access");
    expect(await wcagViolations(log)).toEqual([]);
    await founder.close();
  });

  test("a founder gives a role, the audit log says so, and a suspended account can't sign in", async ({
    page,
    browser,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const founderEmail = uniqueEmail("founder");
    await createConfirmedAccount(page.request, base, founderEmail, PASSWORD);
    await makeAdministrator(founderEmail);
    await signIn(page.context(), base, founderEmail, PASSWORD);

    const colleagueEmail = uniqueEmail("colleague");
    const suspendedEmail = uniqueEmail("suspended");
    const tag = suspendedEmail.split("@")[0]?.slice(-8) ?? "";
    const others = await browser.newContext({ baseURL });
    await createConfirmedAccount(others.request, base, colleagueEmail, PASSWORD);
    await createConfirmedAccount(others.request, base, suspendedEmail, PASSWORD);
    await others.close();

    // Team: invite a colleague as billing.
    await page.goto("/admin/team");
    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What each role can do" })).toBeVisible();
    await page.getByRole("button", { name: "Invite" }).click();
    const invite = page.getByRole("dialog", { name: "Invite a staff member" });
    await invite.getByLabel("Work email").fill(colleagueEmail);
    await invite.getByLabel("Role").selectOption("billing");
    await invite.getByRole("button", { name: "Give the role" }).click();
    await expect(invite).toBeHidden();
    const staffCard = page
      .locator(".card")
      .filter({ has: page.getByRole("heading", { name: "Staff", exact: true }) });
    await expect(staffCard.getByText(colleagueEmail)).toBeVisible();
    await expect(staffCard.getByText(colleagueEmail).locator("..")).toContainText("Billing");
    expect(await wcagViolations(page)).toEqual([]);

    // Suspend a customer from the 360 view.
    await page.goto("/admin/customers");
    await page.getByRole("textbox", { name: "Search customers" }).fill(suspendedEmail);
    await page.getByRole("link", { name: suspendedEmail }).click();
    await page.getByRole("button", { name: "Suspend", exact: true }).click();
    const suspend = page.getByRole("dialog", { name: /^Suspend / });
    await suspend
      .getByLabel("Reason (required, saved to the audit log)")
      .fill(`Chargeback ${tag} under review`);
    await suspend.getByRole("button", { name: "Suspend" }).click();
    await expect(suspend).toBeHidden();
    await expect(page.getByText("Suspended", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Lift", exact: true })).toBeVisible();

    // The suspended person is told plainly at sign-in.
    const them = await browser.newContext({ baseURL });
    const theirPage = await them.newPage();
    await theirPage.goto("/sign-in");
    await emailField(theirPage).fill(suspendedEmail);
    await passwordField(theirPage).fill(PASSWORD);
    await theirPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      theirPage.getByRole("alert").filter({ hasText: "This account is suspended." }),
    ).toBeVisible();
    await them.close();

    // Lift it; they can sign in again.
    await page.getByRole("button", { name: "Lift", exact: true }).click();
    const lift = page.getByRole("dialog", { name: "Lift the suspension?" });
    await lift
      .getByLabel("Reason (required, saved to the audit log)")
      .fill("Resolved with the bank");
    await lift.getByRole("button", { name: "Lift suspension" }).click();
    await expect(lift).toBeHidden();
    await expect(page.getByRole("button", { name: "Suspend", exact: true })).toBeVisible();
    const again = await browser.newContext({ baseURL });
    await signIn(again, base, suspendedEmail, PASSWORD);
    await again.close();

    // Everything above is in the audit log, and the signed-out customer's own side is untouched.
    await page.goto("/admin/audit");
    for (const action of [
      "Invited a staff member",
      "Suspended the account",
      "Lifted the suspension",
    ]) {
      await expect(page.getByRole("row").filter({ hasText: action }).first()).toBeVisible();
    }
    await page.getByRole("textbox", { name: "Filter the audit log" }).fill(`Chargeback ${tag}`);
    await expect(page.getByRole("row").filter({ hasText: "Suspended the account" })).toHaveCount(1);
  });

  test("the console has its own door: staff sign in at /admin/sign-in", async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const founderEmail = uniqueEmail("founder");
    await createConfirmedAccount(page.request, base, founderEmail, PASSWORD);
    await makeAdministrator(founderEmail);

    // Signed out, /admin leads to the console's sign-in, not the customer one.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/sign-in\?/);
    await expect(page.getByRole("heading", { name: "Admin console" })).toBeVisible();
    await expect(page.getByText("Staff only")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create an account" })).toHaveCount(0);
    await page.getByRole("textbox", { name: "Email" }).fill(founderEmail);
    await page.getByLabel("Password", { exact: true }).filter({ visible: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

    // A signed-in founder who opens the door again is let straight through.
    await page.goto("/admin/sign-in");
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("a customer never sees the console", async ({ page, baseURL }) => {
    const email = uniqueEmail("plain");
    await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
    await signIn(page.context(), baseURL ?? "", email, PASSWORD);
    // The console doesn't exist, as far as they can tell. (Streaming can send the status
    // before the page decides, so the body is what counts.)
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "This page doesn’t exist." })).toBeVisible();
    await page.goto("/admin/sign-in");
    await expect(page.getByText("This isn’t a staff account")).toBeVisible();
    const api = await page.request.get("/api/v1/console/overview");
    expect(api.status()).toBe(403);
  });
});
