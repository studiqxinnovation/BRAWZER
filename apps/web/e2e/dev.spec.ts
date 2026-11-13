import { expect, test } from "@playwright/test";
import { horizontalOverflow, wcagViolations } from "./accessibility";

test.describe("development console (/dev)", () => {
  test("reports the live local stack", async ({ page }) => {
    await page.goto("/dev");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Development console");

    const status = page.getByRole("region", { name: "Local system status" });
    await expect(status.getByText("Running")).toHaveCount(2); // web app and API
    await expect(status.getByText(/^\d+(\.\d+)? ms$/)).toHaveCount(4); // PostgreSQL, Redis, object store, scanner
  });

  test("meets WCAG 2.2 AA in light and dark", async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/dev");
      await page
        .getByText(/^\d+(\.\d+)? ms$/)
        .first()
        .waitFor();
      expect(await wcagViolations(page), colorScheme).toEqual([]);
    }
  });

  test("keeps the theme choice for this tab only, with no cookies or local storage", async ({
    page,
  }) => {
    await page.goto("/dev");
    await page.getByRole("button", { name: "Dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const traces = await page.evaluate(() => ({
      localStorage: localStorage.length,
      cookies: document.cookie,
    }));
    expect(traces).toEqual({ localStorage: 0, cookies: "" });
  });

  test("fits the screen without horizontal scrolling", async ({ page }) => {
    await page.goto("/dev");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("platform", () => {
  test("sends security headers", async ({ request }) => {
    const headers = (await request.get("/")).headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("returns a real 404 for unknown pages", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This page doesn’t exist." })).toBeVisible();
  });
});
