import { expect, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { makeAdministrator, setRole } from "./database";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "copper-meadow-signal";

test.describe("compliance pages", () => {
  test.skip(({ isMobile }) => isMobile, "The console is a desk tool; one run covers it.");

  test("a founder logs a privacy request, ticks a control, adds a goal and previews the weekly email", async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const customerEmail = uniqueEmail("subject");
    await createConfirmedAccount(page.request, base, customerEmail, PASSWORD);
    const handle = customerEmail.split("@")[0] ?? "";
    const founderEmail = uniqueEmail("founder");
    await createConfirmedAccount(page.request, base, founderEmail, PASSWORD);
    await makeAdministrator(founderEmail);
    await signIn(page.context(), base, founderEmail, PASSWORD);

    await page.goto("/admin/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy requests" })).toBeVisible();
    await page.getByRole("button", { name: "Log request" }).click();
    const log = page.getByRole("dialog", { name: "Log a privacy request" });
    await log.getByLabel("Account email").fill(customerEmail);
    await log.getByLabel("What they asked for").selectOption("copy");
    await log.getByRole("button", { name: "Log" }).click();
    await expect(log).toBeHidden();
    const row = page.getByRole("row").filter({ hasText: handle });
    await expect(row).toContainText("Copy of their data");
    await expect(row).toContainText("days left");
    expect(await wcagViolations(page)).toEqual([]);
    await row.getByRole("button", { name: "Mark done" }).click();
    const done = page.getByRole("dialog", { name: "Mark the request complete?" });
    await done
      .getByLabel("Reason (required, saved to the audit log)")
      .fill("Export sent from their account page");
    await done.getByRole("button", { name: "Complete" }).click();
    await expect(done).toBeHidden();
    await expect(row).toContainText("Completed");

    await page.goto("/admin/compliance");
    await expect(page.getByRole("heading", { level: 1, name: "Compliance" })).toBeVisible();
    const control = page.getByRole("checkbox", {
      name: /Every member of staff signs in with a passkey/,
    });
    await expect(control).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    await page.goto("/admin/datamap");
    await expect(
      page.getByRole("heading", { level: 1, name: "Data map & suppliers" }),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "Object store" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Drive Trash" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    await page.goto("/admin/goals");
    await expect(page.getByRole("heading", { level: 1, name: "Goals" })).toBeVisible();
    await page.getByRole("button", { name: "Add goal" }).click();
    const goal = page.getByRole("dialog", { name: "New goal" });
    const name = `Paying accounts ${uniqueEmail("g").slice(6, 14)}`;
    await goal.getByLabel("Goal").fill(name);
    await goal.getByLabel("Current value").fill("12");
    await goal.getByLabel("Target").fill("50");
    await goal.getByLabel("Quarter ends").fill("2026-12-31");
    await goal.getByRole("button", { name: "Add" }).click();
    await expect(goal).toBeHidden();
    const card = page.locator(".card").filter({ has: page.getByRole("heading", { name }) });
    await expect(card).toContainText("of 50");
    expect(await wcagViolations(page)).toEqual([]);
    await card.getByRole("button", { name: `Remove “${name}”` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("heading", { name })).toHaveCount(0);

    await page.goto("/admin/weekly");
    await expect(page.getByRole("heading", { level: 1, name: "Weekly email" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Preview of Monday’s email" })).toBeVisible();
    await expect(page.getByText("Accounts", { exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Send weekly" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
  });

  test("sales sees goals but none of the compliance pages", async ({ page, baseURL }) => {
    const base = baseURL ?? "";
    const salesEmail = uniqueEmail("sales");
    await createConfirmedAccount(page.request, base, salesEmail, PASSWORD);
    await setRole(salesEmail, "sales");
    await signIn(page.context(), base, salesEmail, PASSWORD);
    await page.goto("/admin/goals");
    await expect(page.getByRole("heading", { level: 1, name: "Goals" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add goal" })).toHaveCount(0);
    for (const path of ["/admin/privacy", "/admin/compliance", "/admin/datamap", "/admin/weekly"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
    }
  });
});
