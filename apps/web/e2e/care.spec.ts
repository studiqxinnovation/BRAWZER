import { expect, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { makeAdministrator } from "./database";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "copper-meadow-signal";

test.describe("announcements, incidents and status", () => {
  test.skip(({ isMobile }) => isMobile, "The console is a desk tool; one run covers it.");

  test("a declared incident reaches the status page and every desktop, until it is resolved", async ({
    page,
    browser,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const title = `Slow starts for cloud browsers ${uniqueEmail("i").slice(6, 14)}`;

    const founderEmail = uniqueEmail("founder");
    await createConfirmedAccount(page.request, base, founderEmail, PASSWORD);
    await makeAdministrator(founderEmail);
    await signIn(page.context(), base, founderEmail, PASSWORD);

    await page.goto("/admin/incidents");
    await expect(page.getByRole("heading", { level: 1, name: "Incidents & status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Status page, right now" })).toBeVisible();
    await page.getByRole("button", { name: "Declare incident" }).click();
    const declare = page.getByRole("dialog", { name: "Declare an incident" });
    await declare.getByLabel("What’s happening?").fill(title);
    await declare.getByLabel("Severity").selectOption("sev2");
    await declare.getByLabel("Part affected").selectOption("cloud_browsers");
    await declare.getByLabel("First update").fill("New sessions take up to a minute to start.");
    await declare.getByRole("button", { name: "Declare" }).click();
    await expect(declare).toBeHidden();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // A customer sees the banner on their desktop and can dismiss it.
    const customerEmail = uniqueEmail("customer");
    const customer = await browser.newContext({ baseURL });
    await createConfirmedAccount(customer.request, base, customerEmail, PASSWORD);
    await signIn(customer, base, customerEmail, PASSWORD);
    const desk = await customer.newPage();
    await desk.goto("/app/shield");
    const banners = desk.getByRole("region", { name: "Announcements from Brawzer" });
    const banner = banners.getByRole("status").filter({ hasText: title });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link", { name: "Learn more" })).toHaveAttribute(
      "href",
      "/status",
    );
    await banner.getByRole("button", { name: `Dismiss “${title}”` }).click();
    await expect(banners.getByText(title)).toHaveCount(0);
    await desk.reload();
    await expect(desk.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(desk.getByText(title)).toHaveCount(0);

    // The public status page, signed out.
    const visitor = await browser.newContext({ baseURL });
    const status = await visitor.newPage();
    await status.goto("/status");
    await expect(
      status.getByRole("heading", { level: 1, name: "An incident is open" }),
    ).toBeVisible();
    await expect(status.getByRole("heading", { name: title })).toBeVisible();
    await expect(status.getByText("Cloud browsers").first()).toBeVisible();
    expect(await wcagViolations(status)).toEqual([]);

    // Resolving clears it.
    // (Other incidents from earlier runs may be open too: everything is scoped to this card.)
    const card = page.locator(".card").filter({ has: page.getByRole("heading", { name: title }) });
    await card.getByLabel(`Update on ${title}`).fill("Capacity added; starts are back to normal.");
    await card.getByLabel("New status").selectOption("resolved");
    await card.getByRole("button", { name: "Post" }).click();
    await expect(card.getByText("Resolved · Capacity added")).toBeVisible();
    await expect(card.getByLabel("New status")).toHaveCount(0);
    await status.reload();
    const entry = status
      .locator("li")
      .filter({ has: status.getByRole("heading", { name: title }) });
    await expect(entry.getByText("Resolved", { exact: false }).first()).toBeVisible();
    await expect(entry.getByText("Capacity added; starts are back to normal.")).toBeVisible();
    await visitor.close();
    await customer.close();
  });

  test("an announcement is published to everyone and turned off again", async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const title = `Try Exam Mode ${uniqueEmail("a").slice(6, 14)}`;
    const founderEmail = uniqueEmail("founder");
    await createConfirmedAccount(page.request, base, founderEmail, PASSWORD);
    await makeAdministrator(founderEmail);
    await signIn(page.context(), base, founderEmail, PASSWORD);

    await page.goto("/admin/announce");
    await expect(
      page.getByRole("heading", { level: 1, name: "In-app announcements" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New announcement" }).click();
    const dialog = page.getByRole("dialog", { name: "New announcement" });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Message").fill("Block distractions for a set time.");
    await dialog.getByLabel("Type").selectOption("tip");
    await dialog.getByLabel("Show to").selectOption("everyone");
    await dialog.getByRole("button", { name: "Publish" }).click();
    await expect(dialog).toBeHidden();
    const toggle = page.getByRole("switch", { name: `Showing: ${title}` });
    await expect(toggle).toBeChecked();
    await expect(page.getByText("0 views · 0% clicked").first()).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    await toggle.click();
    await expect(page.getByRole("switch", { name: `Hidden: ${title}` })).not.toBeChecked();
    await page.getByRole("button", { name: `Delete “${title}”` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(title)).toHaveCount(0);
  });
});
