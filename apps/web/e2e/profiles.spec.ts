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
    .locator(".ad-li-title > .truncate")
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

    // Create, in the "New profile" card, with a name that's already taken first.
    const card = page.getByRole("region", { name: "New profile" });
    await expect(card.getByRole("combobox", { name: "Browser" })).toHaveText(/Bee Browser/);
    await card.getByRole("textbox", { name: "Name" }).fill("personal");
    await card.getByRole("button", { name: "Create profile" }).click();
    await expect(card.getByText("You already have a profile with that name.")).toBeVisible();
    await card.getByRole("textbox", { name: "Name" }).fill("Work");
    await card.getByRole("combobox", { name: "Browser" }).click();
    await page.getByRole("option", { name: "Google Chrome" }).click();
    expect(await wcagViolations(page)).toEqual([]);
    await card.getByRole("button", { name: "Create profile" }).click();
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
    // Whether browsing data survives between sessions is the profile's choice.
    const keep = edit.getByRole("switch", { name: "Keep browsing data between sessions" });
    await expect(keep).toBeChecked();
    await keep.click();
    await edit.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => names(page)).toEqual(["Office", "Personal"]);
    await expect(page.getByText("Starts every session clean")).toBeVisible();

    // A profile's own password manager and browser account: off until asked for,
    // and only for a profile that keeps its data.
    await page.getByRole("button", { name: "Edit Personal" }).click();
    const personal = page.getByRole("dialog", { name: "Edit “Personal”" });
    const account = personal.getByRole("switch", { name: "Browser account and saved passwords" });
    await expect(account).not.toBeChecked();
    await account.click();
    await personal.getByRole("button", { name: "Save" }).click();
    await expect(personal).toBeHidden();
    await expect(page.getByText("Browser account and saved passwords on")).toBeVisible();
    await page.getByRole("button", { name: "Edit Office" }).click();
    const office = page.getByRole("dialog", { name: "Edit “Office”" });
    await expect(
      office.getByRole("switch", { name: "Browser account and saved passwords" }),
    ).toBeDisabled();
    await office.getByRole("button", { name: "Cancel" }).click();

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
