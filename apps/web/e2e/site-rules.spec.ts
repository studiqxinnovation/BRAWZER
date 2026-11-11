import { expect, type Page, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "violet-harbor-lantern";

/** Adds a rule as the prototype's form has it: the website, the rule, Add rule. */
async function addRule(page: Page, host: string, rule: "Block" | "Always allow") {
  await page.getByRole("textbox", { name: "Website" }).fill(host);
  await page.getByRole("combobox", { name: "Rule" }).click();
  await page.getByRole("option", { name: rule, exact: true }).click();
  await page.getByRole("button", { name: "Add rule" }).click();
}

test.describe("site rules", () => {
  test("block and allow sites, then remove the rules", async ({ page, baseURL }) => {
    const email = uniqueEmail("site-rules");
    await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
    await signIn(page.context(), baseURL ?? "", email, PASSWORD);
    await page.goto("/app/site-rules");
    await expect(page.getByRole("heading", { name: "Site rules" })).toBeVisible();
    await expect(page.getByText("No rules yet")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // A host as typed becomes a rule for the host and everything under it.
    await addRule(page, "WWW.Tracker.example", "Block");
    const rules = page.getByRole("table", { name: "Site rules" });
    await expect(rules).toContainText("tracker.example");
    await expect(rules).toContainText("Blocked");

    // Mistakes are explained, not stored.
    await addRule(page, "https://work.example/path", "Always allow");
    await expect(page.getByText("Enter only the host name")).toBeVisible();
    await addRule(page, "work.example", "Always allow");
    await expect(rules).toContainText("work.example");
    await expect(page.getByText(/rules · only allowed sites open/)).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // Removing brings the list back to its open state.
    await page.getByRole("button", { name: "Remove tracker.example from blocked sites" }).click();
    await expect(rules).not.toContainText("tracker.example");
    await page.getByRole("button", { name: "Remove work.example from allowed sites" }).click();
    await expect(page.getByText("No rules yet")).toBeVisible();
  });
});
