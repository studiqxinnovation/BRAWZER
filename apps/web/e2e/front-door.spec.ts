import { expect, test } from "@playwright/test";

/**
 * The sign-in screen covers the layout's header, and the sign-up card has its
 * own mark: on both, the mark is the way back to the home page.
 */
test.describe("the way back home", () => {
  for (const path of ["/sign-in", "/create-account"] as const) {
    test(`the mark on ${path} leads to the home page`, async ({ page }) => {
      await page.goto(path);
      // The last such link is the one inside the page itself (the header's is first).
      await page.getByRole("link", { name: "Brawzer home" }).last().click();
      await expect(page).toHaveURL(/^https?:\/\/[^/]+\/?$/);
      await expect(page.locator("h1")).toHaveText("Browse anywhere. Leave nothing behind.");
    });
  }
});
