import { expect, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "violet-harbor-lantern";

test.describe("extensions", () => {
  test("installs catalogue extensions into a profile and shows which engine runs what", async ({
    page,
    baseURL,
  }) => {
    const email = uniqueEmail("extensions");
    await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
    await signIn(page.context(), baseURL ?? "", email, PASSWORD);
    await page.goto("/app/extensions");
    await expect(page.getByRole("heading", { name: "Extensions" })).toBeVisible();
    const catalogue = page.getByRole("list", { name: "Extension catalogue" });
    await expect(catalogue.getByRole("listitem")).toHaveCount(3);
    expect(await wcagViolations(page)).toEqual([]);

    // The default profile is Bee Browser: uBlock Origin itself is Firefox-only.
    const ublock = catalogue.getByRole("switch", { name: /^uBlock Origin in / });
    await expect(ublock).toBeDisabled();
    await expect(catalogue.getByText("Not available on Bee Browser")).toBeVisible();
    const dark = catalogue.getByRole("switch", { name: /^Dark Reader in / });
    await expect(dark).not.toBeChecked();
    await dark.click();
    await expect(page.getByText("Installs into “Personal” from its next session")).toBeVisible();
    await expect(dark).toBeChecked();

    // The profile list counts it.
    await page.goto("/app/profiles");
    await expect(page.getByText("1 extension")).toBeVisible();
  });
});
