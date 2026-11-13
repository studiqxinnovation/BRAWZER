import { expect, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { setRole } from "./database";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "copper-meadow-signal";

test.describe("security pages", () => {
  test.skip(({ isMobile }) => isMobile, "The console is a desk tool; one run covers it.");

  test("security staff block an address, log abuse and place a hold", async ({ page, baseURL }) => {
    const base = baseURL ?? "";
    const customerEmail = uniqueEmail("suspect");
    await createConfirmedAccount(page.request, base, customerEmail, PASSWORD);
    const handle = customerEmail.split("@")[0] ?? "";

    const securityEmail = uniqueEmail("security");
    await createConfirmedAccount(page.request, base, securityEmail, PASSWORD);
    await setRole(securityEmail, "security");
    await signIn(page.context(), base, securityEmail, PASSWORD);

    // Threats: the page, the tabs, a block with an expiry.
    await page.goto("/admin/security");
    await expect(page.getByRole("heading", { level: 1, name: "Threats & sign-ins" })).toBeVisible();
    await expect(page.getByLabel("Failed sign-ins, 24 h")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await page.getByRole("tab", { name: /Blocked addresses/ }).click();
    await page.getByRole("button", { name: "Block an address" }).click();
    const block = page.getByRole("dialog", { name: "Block an address" });
    const cidr = `198.51.100.${String(Math.floor(Math.random() * 200) + 1)}`;
    await block.getByLabel("Address or network").fill(cidr);
    await block.getByLabel("Why (saved to the audit log)").fill("Credential stuffing");
    await block.getByLabel("Hours until it lifts (blank = until removed)").fill("2");
    await block.getByRole("button", { name: "Block" }).click();
    await expect(block).toBeHidden();
    const row = page.getByRole("row").filter({ hasText: cidr });
    await expect(row).toContainText("Credential stuffing");
    await row.getByRole("button", { name: "Unblock" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Unblock" }).click();
    await expect(page.getByRole("row").filter({ hasText: cidr })).toHaveCount(0);

    // Abuse: log, then close as not abuse.
    await page.goto("/admin/abuse");
    await expect(page.getByRole("heading", { level: 1, name: "Abuse reports" })).toBeVisible();
    await page.getByRole("button", { name: "Log a report" }).click();
    const log = page.getByRole("dialog", { name: "Log an abuse report" });
    await log.getByLabel("Account email").fill(customerEmail);
    await log.getByLabel("Type").selectOption("spam");
    await log.getByLabel("Who told us").fill("Hosting provider");
    await log.getByLabel("What they said").fill("Connections to a mail relay.");
    await log.getByRole("button", { name: "Log" }).click();
    await expect(log).toBeHidden();
    const report = page.getByRole("row").filter({ hasText: handle }).first();
    await expect(report).toContainText("Spam");
    expect(await wcagViolations(page)).toEqual([]);
    await report.getByRole("button", { name: "Not abuse" }).click();
    const close = page.getByRole("dialog", { name: "Close as not abuse?" });
    await close
      .getByLabel("Reason (required, saved to the audit log)")
      .fill("Their own mail server, allowed by the policy");
    await close.getByRole("button", { name: "Close" }).click();
    await expect(close).toBeHidden();
    await expect(report).toContainText("Not abuse");

    // Legal: a hold placed and released.
    await page.goto("/admin/legal");
    await expect(
      page.getByRole("heading", { level: 1, name: "Legal requests & holds" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Place hold" }).click();
    const hold = page.getByRole("dialog", { name: "Place a legal hold" });
    await hold.getByLabel("Account email").fill(customerEmail);
    await hold.getByLabel("Why (saved to the audit log)").fill("Preservation request pending");
    await hold.getByRole("button", { name: "Place hold" }).click();
    await expect(hold).toBeHidden();
    const holdRow = page.getByRole("row").filter({ hasText: handle });
    await expect(holdRow).toContainText("Preservation request pending");
    expect(await wcagViolations(page)).toEqual([]);
    await holdRow.getByRole("button", { name: "Release" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Release" }).click();
    await expect(page.getByRole("row").filter({ hasText: handle })).toHaveCount(0);
  });

  test("care is refused the security pages", async ({ page, baseURL }) => {
    const base = baseURL ?? "";
    const careEmail = uniqueEmail("care");
    await createConfirmedAccount(page.request, base, careEmail, PASSWORD);
    await setRole(careEmail, "care");
    await signIn(page.context(), base, careEmail, PASSWORD);
    for (const path of ["/admin/security", "/admin/abuse", "/admin/legal"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
    }
  });
});
