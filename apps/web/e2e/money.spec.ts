import { expect, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { makeAdministrator, setRole } from "./database";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "copper-meadow-signal";

test.describe("money pages", () => {
  test.skip(({ isMobile }) => isMobile, "The console is a desk tool; one run covers it.");

  test("a founder reads subscriptions, finance, approvals and upgrade signals; Stripe pages say when Stripe is off", async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const founderEmail = uniqueEmail("founder");
    await createConfirmedAccount(page.request, base, founderEmail, PASSWORD);
    await makeAdministrator(founderEmail);
    await signIn(page.context(), base, founderEmail, PASSWORD);

    await page.goto("/admin/subs");
    await expect(page.getByRole("heading", { level: 1, name: "Subscriptions" })).toBeVisible();
    await expect(page.getByLabel("Paying subscriptions")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Failed payments/ })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // This installation has no Stripe key: the Stripe-backed pages say so instead of pretending.
    await page.goto("/admin/invoices");
    await expect(page.getByRole("heading", { level: 1, name: "Invoices & refunds" })).toBeVisible();
    await expect(page.getByText("Stripe isn’t configured on this installation")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await page.goto("/admin/coupons");
    await expect(page.getByText("Stripe isn’t configured on this installation")).toBeVisible();

    await page.goto("/admin/finance");
    await expect(page.getByRole("heading", { level: 1, name: "Finance reports" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Monthly revenue movements" })).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(13);
    await expect(page.getByRole("button", { name: "Download CSV" })).toBeEnabled();
    expect(await wcagViolations(page)).toEqual([]);

    await page.goto("/admin/approvals");
    await expect(page.getByRole("heading", { level: 1, name: "Approvals" })).toBeVisible();
    await expect(page.getByText(/four eyes/)).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    await page.goto("/admin/trials");
    await expect(
      page.getByRole("heading", { level: 1, name: "Accounts likely to upgrade" }),
    ).toBeVisible();
    await expect(page.getByText("These are the facts, not a score")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
  });

  test("billing staff see the money pages but not approvals or upgrade signals", async ({
    page,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const billingEmail = uniqueEmail("billing");
    await createConfirmedAccount(page.request, base, billingEmail, PASSWORD);
    await setRole(billingEmail, "billing");
    await signIn(page.context(), base, billingEmail, PASSWORD);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/settings$/);
    const nav = page.getByRole("navigation", { name: "Console" });
    await expect(nav.getByRole("link", { name: "Subscriptions" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Approvals" })).toHaveCount(0);
    await page.goto("/admin/approvals");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
    await page.goto("/admin/trials");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
    await page.goto("/admin/subs");
    await expect(page.getByLabel("Paying subscriptions")).toBeVisible();
  });
});
