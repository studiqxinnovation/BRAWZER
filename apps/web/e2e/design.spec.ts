import { expect, test } from "@playwright/test";
import { horizontalOverflow, wcagViolations } from "./accessibility";

test.describe("design system page", () => {
  test("shows every section", async ({ page }) => {
    await page.goto("/design");
    for (const name of ["Logo", "Colour", "Typography", "Layout", "Motion", "Components"]) {
      await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
    }
  });

  test("switches theme and accent for the whole page", async ({ page }) => {
    await page.goto("/design");
    const html = page.locator("html");

    await page.getByRole("button", { name: "Dark theme" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Copper" }).click();
    await expect(html).toHaveAttribute("data-accent", "copper");
    await page.getByRole("button", { name: "System theme" }).click();
    await expect(html).not.toHaveAttribute("data-theme");
  });

  test("every measured colour meets its WCAG target in every theme and accent", async ({
    page,
  }) => {
    await page.goto("/design");
    const colour = page.locator("#colour");

    for (const theme of ["Light theme", "Dark theme"]) {
      await page.getByRole("button", { name: theme }).click();
      for (const accent of ["Cobalt", "Copper", "Glacier"]) {
        await page.getByRole("button", { name: accent }).click();
        await expect(colour.getByText(/:1 pass$/).first()).toBeVisible();
        const failing = await colour.getByText(/:1 fail$/).allTextContents();
        expect(failing, `${theme}, ${accent}`).toEqual([]);
      }
    }
  });

  test("meets WCAG 2.2 AA in light and dark", async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/design");
      await page
        .locator("#colour")
        .getByText(/:1 pass$/)
        .first()
        .waitFor();
      expect(await wcagViolations(page), colorScheme).toEqual([]);
    }
  });

  test("dialog closes with Escape and returns focus to its trigger", async ({ page }) => {
    await page.goto("/design");
    const trigger = page.getByRole("button", { name: "End all sessions…" });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "End all sessions?" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("a required field explains itself when left empty", async ({ page }) => {
    await page.goto("/design");
    const field = page.getByLabel("Profile name");
    await field.fill("Research");
    await field.fill("");
    await field.blur();
    await expect(page.getByText("Give the profile a name.")).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
  });

  test("menu actions run and report back", async ({ page }) => {
    await page.goto("/design");
    await page.getByRole("button", { name: "Profile actions" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await expect(page.getByText("Component preview: no action was taken.")).toBeVisible();
  });

  test("fits small screens without horizontal scrolling", async ({ page }) => {
    await page.goto("/design");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
