import { expect, type Locator, type Page, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "violet-harbor-lantern";

async function interactive(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-session-keeper", /.+/);
}

/** Clicks a colour's visible swatch, as a person would. */
async function pickColour(scope: Locator, name: string) {
  // `has` is matched inside each label, so it must be a page-level locator.
  await scope
    .locator("label")
    .filter({ has: scope.page().getByRole("radio", { name, exact: true }) })
    .click();
  await expect(scope.getByRole("radio", { name })).toBeChecked();
}

const names = (page: Page) =>
  page
    .getByRole("list", { name: "Your profiles" })
    .getByRole("listitem")
    .locator("p.truncate")
    .allTextContents();

test.describe("profiles", () => {
  test("create, reorder, edit and delete profiles", async ({ page, baseURL }) => {
    const email = uniqueEmail("profiles");
    await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
    await signIn(page.context(), baseURL ?? "", email, PASSWORD);

    await page.goto("/app/profiles");
    await interactive(page);
    await expect.poll(() => names(page)).toEqual(["Personal"]);
    await expect(page.getByText("1 of 10 profiles")).toBeVisible();
    await expect(page.getByText("the last one can’t be deleted")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Personal" })).toHaveCount(0);

    // Create, with a name that's already taken first.
    await page.getByRole("button", { name: "New profile" }).click();
    const dialog = page.getByRole("dialog", { name: "New profile" });
    await expect(dialog.getByRole("radio", { name: "Firefox" })).toBeDisabled();
    await expect(dialog.getByRole("radio", { name: "Chromium" })).toBeChecked();
    await dialog.getByRole("textbox", { name: "Name" }).fill("personal");
    await dialog.getByRole("button", { name: "Create profile" }).click();
    await expect(dialog.getByText("You already have a profile with that name.")).toBeVisible();
    await dialog.getByRole("textbox", { name: "Name" }).fill("Work");
    // Teal is suggested because Personal already uses indigo.
    await expect(dialog.getByRole("radio", { name: "Teal" })).toBeChecked();
    await pickColour(dialog, "Green");
    expect(await wcagViolations(page)).toEqual([]);
    await dialog.getByRole("button", { name: "Create profile" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => names(page)).toEqual(["Personal", "Work"]);

    // Reorder.
    await page.getByRole("button", { name: "Move Work up" }).click();
    await expect.poll(() => names(page)).toEqual(["Work", "Personal"]);
    await expect(page.getByRole("button", { name: "Move Work up" })).toBeDisabled();

    // Edit.
    await page.getByRole("button", { name: "Edit Work" }).click();
    const edit = page.getByRole("dialog", { name: "Edit “Work”" });
    await edit.getByRole("textbox", { name: "Name" }).fill("Office");
    await pickColour(edit, "Rose");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => names(page)).toEqual(["Office", "Personal"]);

    // Delete, after confirming.
    await page.getByRole("button", { name: "Delete Office" }).click();
    await page
      .getByRole("alertdialog", { name: "Delete “Office”?" })
      .getByRole("button", { name: "Delete profile" })
      .click();
    await expect.poll(() => names(page)).toEqual(["Personal"]);

    // The order and changes are stored, not just shown.
    await page.reload();
    await expect.poll(() => names(page)).toEqual(["Personal"]);
  });
});
