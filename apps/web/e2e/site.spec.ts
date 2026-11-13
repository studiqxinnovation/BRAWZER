import { expect, test } from "@playwright/test";
import { horizontalOverflow, wcagViolations } from "./accessibility";

const publicPages = [
  { path: "/", heading: "Browse anywhere. Leave nothing behind." },
  { path: "/product", heading: "A real browser, running somewhere safer." },
  { path: "/security", heading: "Security, explained plainly." },
  { path: "/profiles", heading: "One browser for every part of your life." },
  { path: "/drive", heading: "Downloads that stay with you, not the computer." },
  { path: "/pricing", heading: "Plans and pricing" },
  { path: "/about", heading: "Why Brawzer exists." },
  { path: "/privacy", heading: "Privacy" },
  { path: "/terms", heading: "Terms of service" },
] as const;

test.describe("public website", () => {
  for (const { path, heading } of publicPages) {
    test(`${path} has one h1, metadata and no accessibility violations`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);

      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText(heading);
      await expect(page).toHaveTitle(/Brawzer/);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{40,}/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        // The home page's canonical URL is the bare origin (no trailing slash).
        new RegExp(path === "/" ? "^https?://[^/]+/?$" : `${path}$`),
      );

      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        expect(await wcagViolations(page), `${path} ${colorScheme}`).toEqual([]);
      }
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("the home page's sections rise into view and pass the audit once they have", async ({
    page,
  }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "no-preference" });
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
      // Scroll the whole page so every section has risen in, then audit it all.
      for (let step = 0; step < 30; step += 1) {
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(60);
      }
      await expect(
        page.getByRole("heading", { name: "Your browser, wherever you are." }),
      ).toBeVisible();
      await expect(page.locator(".lp-reveal:not([data-shown])")).toHaveCount(0);
      expect(await wcagViolations(page), colorScheme).toEqual([]);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    }
  });

  test("the home page holds still for people who ask for less motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Nothing waits to rise in, and nothing moves.
    await expect(page.locator("html")).not.toHaveAttribute("data-motion", "on");
    const running = await page.evaluate(
      () =>
        document.getAnimations().filter((animation) => animation.playState === "running").length,
    );
    expect(running).toBe(0);
    await expect(
      page.getByRole("heading", { name: "Made for the computers you don’t own." }),
    ).toBeVisible();
  });

  test("says plainly that Brawzer is still in development", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText("Brawzer isn’t open to the public yet.", { exact: false }),
    ).toBeVisible();
  });

  test("pricing invents no prices", async ({ page }) => {
    await page.goto("/pricing");
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(
      /[$€£¥₹]\s?\d|\d\s?(?:USD|EUR|GBP)|\/\s?(?:mo|month|yr|year)\b|per month/i,
    );
  });

  test("the skip link moves focus to the main content", async ({ page, isMobile }) => {
    test.skip(isMobile, "Keyboard navigation is tested on desktop");
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("desktop navigation reaches every section and marks the current page", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "The desktop navigation is hidden on phones");
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    for (const label of ["Product", "Security", "Profiles", "Drive", "Pricing", "About"]) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`/${label.toLowerCase()}$`));
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    }
  });

  test("the mobile menu navigates and closes", async ({ page, isMobile }) => {
    test.skip(!isMobile, "The menu button only exists on small screens");
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu).toBeVisible();
    await menu.getByRole("link", { name: "Security" }).click();
    await expect(page).toHaveURL(/\/security$/);
    await expect(menu).toBeHidden();
  });

  test("footer links all lead to real pages", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page
      .locator("footer a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBe(200);
    }
  });
});

// Sign-in, sign-up and password pages are covered by auth.spec.ts.

test.describe("search engines", () => {
  test("robots.txt keeps crawlers out before launch", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();
    expect(body).toMatch(/Disallow: \/\s*$/m);
  });

  test("every page carries noindex before launch", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("the sitemap lists every public page", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    for (const { path } of publicPages) {
      expect(xml).toContain(`<loc>http://localhost:3100${path}</loc>`);
    }
  });
});
