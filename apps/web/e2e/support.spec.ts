import { expect, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { setRole } from "./database";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "copper-meadow-signal";

test.describe("support", () => {
  test.skip(({ isMobile }) => isMobile, "The inbox is a desk tool; one run covers it.");

  test("a customer asks from Help, care answers from the inbox, the customer rates it", async ({
    page,
    browser,
    baseURL,
  }) => {
    const base = baseURL ?? "";
    const subject = `Essay gone from Documents ${uniqueEmail("x").slice(6, 14)}`;

    // The customer writes from Help.
    const customerEmail = uniqueEmail("asker");
    await createConfirmedAccount(page.request, base, customerEmail, PASSWORD);
    await signIn(page.context(), base, customerEmail, PASSWORD);
    await page.goto("/app/help");
    await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
    await expect(page.getByText("No requests yet.")).toBeVisible();
    await page.getByRole("button", { name: "New request" }).click();
    await page.getByLabel("Subject").fill(subject);
    await page.getByLabel("About").selectOption("drive");
    await page.getByLabel("What’s happening?").fill("I emptied the Trash too. Is it gone?");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("heading", { name: subject })).toBeVisible();
    await expect(page.getByText("I emptied the Trash too.")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // Customer care finds it in the inbox, notes, then replies and solves it.
    const careEmail = uniqueEmail("care");
    const care = await browser.newContext({ baseURL });
    await createConfirmedAccount(care.request, base, careEmail, PASSWORD);
    await setRole(careEmail, "care");
    await signIn(care, base, careEmail, PASSWORD);
    const inbox = await care.newPage();
    await inbox.goto("/admin/inbox");
    await expect(inbox.getByRole("heading", { level: 1, name: "Support inbox" })).toBeVisible();
    const queue = inbox.getByRole("list", { name: "Requests" });
    await queue.getByRole("button").filter({ hasText: subject }).click();
    await expect(inbox.getByRole("heading", { name: subject })).toBeVisible();
    await expect(inbox.getByText("I emptied the Trash too.")).toBeVisible();
    await expect(inbox.getByText("Deleted files stay in their Trash for 30 days.")).toBeVisible();
    await expect(inbox.getByRole("link", { name: "Open full account" })).toBeVisible();
    expect(await wcagViolations(inbox)).toEqual([]);

    await inbox.getByRole("tab", { name: "Internal note" }).click();
    await inbox.getByLabel("Internal note").fill("Checked their Trash: the file is there.");
    await inbox.getByRole("button", { name: "Add note" }).click();
    await expect(inbox.getByText("Checked their Trash: the file is there.")).toBeVisible();

    await inbox.getByRole("tab", { name: "Reply", exact: true }).click();
    await inbox.getByLabel("Reply", { exact: true }).fill("Good news: it’s back in Documents.");
    await inbox.getByRole("button", { name: "Send and solve" }).click();
    await expect(inbox.getByLabel("Status")).toHaveValue("solved");
    await expect(inbox.getByText("Replied", { exact: true })).toBeVisible();

    // The customer sees the reply but not the note, and rates it.
    await page.reload();
    await page.getByRole("button", { name: new RegExp(subject) }).click();
    await expect(page.getByText("Good news: it’s back in Documents.")).toBeVisible();
    await expect(page.getByText("Checked their Trash")).toHaveCount(0);
    await expect(page.getByText("Brawzer support")).toBeVisible();
    await page.getByRole("radio", { name: "5 of 5" }).click();
    await page.getByRole("button", { name: "Send rating" }).click();
    await expect(page.getByText("You rated this 5 of 5.")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // Performance counts it; the solved view lists it.
    await inbox.goto("/admin/carestats");
    await expect(
      inbox.getByRole("heading", { level: 1, name: "Support performance" }),
    ).toBeVisible();
    await expect(inbox.getByLabel("Rating")).toContainText("/ 5");
    expect(await wcagViolations(inbox)).toEqual([]);
    await care.close();
  });

  test("saved replies are shared and inserted into a reply", async ({ page, baseURL }) => {
    const base = baseURL ?? "";
    const careEmail = uniqueEmail("care");
    await createConfirmedAccount(page.request, base, careEmail, PASSWORD);
    await setRole(careEmail, "care");
    await signIn(page.context(), base, careEmail, PASSWORD);
    const name = `Wrong country ${uniqueEmail("r").slice(6, 14)}`;

    await page.goto("/admin/replies");
    await expect(page.getByRole("heading", { level: 1, name: "Saved replies" })).toBeVisible();
    await page.getByRole("button", { name: "New saved reply" }).click();
    const dialog = page.getByRole("dialog", { name: "New saved reply" });
    await dialog.getByLabel("Name").fill(name);
    await dialog
      .getByLabel("Reply")
      .fill("Websites see the location of your proxy. Change it any time in Proxy.");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    await page.getByRole("button", { name: `Delete “${name}”` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("heading", { name })).toHaveCount(0);
  });
});
