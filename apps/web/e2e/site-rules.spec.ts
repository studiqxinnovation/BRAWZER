import { expect, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "violet-harbor-lantern";

test.describe("site rules", () => {
  test("block and allow sites, then remove the rules", async ({ page, baseURL }) => {
    const email = uniqueEmail("site-rules");
    await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
    await signIn(page.context(), baseURL ?? "", email, PASSWORD);
    await page.goto("/app/site-rules");
    await expect(page.getByRole("heading", { name: "Site rules" })).toBeVisible();
    await expect(page.getByText("No blocked sites.")).toBeVisible();
    await expect(page.getByText("Every site may open.", { exact: true })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // A host as typed becomes a rule for the host and everything under it.
    await page.getByRole("textbox", { name: "Block a site" }).fill("WWW.Tracker.example");
    await page.getByRole("button", { name: "Block", exact: true }).click();
    const blocked = page.getByRole("list", { name: "Blocked sites" });
    await expect(blocked).toContainText("tracker.example");

    // Mistakes are explained, not stored.
    await page.getByRole("textbox", { name: "Allow a site" }).fill("https://work.example/path");
    await page.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(page.getByText("Enter only the host name")).toBeVisible();
    await page.getByRole("textbox", { name: "Allow a site" }).fill("work.example");
    await page.getByRole("button", { name: "Allow", exact: true }).click();
    const allowed = page.getByRole("list", { name: "Allowed sites" });
    await expect(allowed).toContainText("work.example");
    expect(await wcagViolations(page)).toEqual([]);

    // Removing brings the lists back to their open state.
    await blocked
      .getByRole("button", { name: "Remove tracker.example from blocked sites" })
      .click();
    await expect(page.getByText("No blocked sites.")).toBeVisible();
    await allowed.getByRole("button", { name: "Remove work.example from allowed sites" }).click();
    await expect(page.getByText("Every site may open.", { exact: true })).toBeVisible();
  });
});
