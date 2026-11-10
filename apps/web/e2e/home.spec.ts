import { expect, type Page, test } from "@playwright/test";
import { horizontalOverflow, wcagViolations } from "./accessibility";
import { createConfirmedAccount, GREETING, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "violet-harbor-lantern";

async function signedIn(page: Page, baseURL: string | undefined, tag: string): Promise<string> {
  const email = uniqueEmail(tag);
  await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
  await signIn(page.context(), baseURL ?? "", email, PASSWORD);
  await page.goto("/app");
  await expect(page.locator("html")).toHaveAttribute("data-session-keeper", /.+/);
  return email;
}

test.describe("home", () => {
  test("a dashboard of the account: its numbers, browsers, Shield, network and month", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await signedIn(page, baseURL, "home");
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();
    await expect(page.getByText("Cloud is running · only pixels reach this device")).toBeVisible();
    await expect(page.getByRole("note", { name: "Shared-computer mode" })).toContainText(
      "after 30 minutes without activity",
    );

    // The numbers, each from the account itself.
    await expect(page.getByRole("region", { name: "Sessions today" })).toContainText("None yet");
    await expect(page.getByRole("region", { name: "Profiles" })).toContainText(
      "Of 10 on your plan",
    );
    await expect(page.getByRole("region", { name: "Devices signed in" })).toContainText(
      "Only this device",
    );
    await expect(page.getByRole("region", { name: "Drive storage" })).toContainText("free of");

    // Every browser offered, each ready to open.
    const dock = page.getByRole("list", { name: "Your browsers" });
    for (const name of ["Bee Browser", "Chrome", "Firefox", "Chromium"]) {
      await expect(dock.getByRole("button", { name: `Open ${name}`, exact: true })).toBeVisible();
    }

    // Shield: a new account has a passkey and two-factor to set up, counted in the sidebar too.
    const shield = page.getByRole("region", { name: "Shield" });
    await expect(shield).toContainText("2 to do");
    if (!isMobile) {
      await expect(
        page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Shield/ }),
      ).toHaveAccessibleName("Shield 2 to look at");
    }
    // The blocker installs uBlock Origin into the profile for its next session.
    const blocker = shield.getByRole("switch", { name: "Ad and tracker blocker in “Personal”" });
    await expect(blocker).not.toBeChecked();
    await blocker.click();
    await expect(
      page.getByText("uBlock Origin installs into “Personal” from its next session"),
    ).toBeVisible();
    await expect(blocker).toBeChecked();
    const profiles = (await (await page.request.get("/api/v1/profiles")).json()) as {
      profiles: { extensions: string[] }[];
    };
    expect(profiles.profiles[0]?.extensions).toContain("ubo-lite");

    const network = page.getByRole("region", { name: "Network" });
    await expect(network).toContainText("Direct");
    await expect(network).toContainText("Shared computer");
    await expect(page.getByRole("region", { name: "This month" })).toContainText(
      "No browsing yet this month.",
    );

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await wcagViolations(page), colorScheme).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: "light" });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // The bell: what happened lately, from the security history.
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await expect(page.getByText("Recent activity")).toBeVisible();
    await expect(page.getByRole("link", { name: "See all activity in Shield" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Search: any page, by typing.
    await page.getByRole("button", { name: "Search Brawzer" }).click();
    const search = page.getByRole("combobox", { name: "Go to a page, or open a browser" });
    await search.fill("site");
    await expect(page.getByRole("option", { name: /Site rules/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await wcagViolations(page)).toEqual([]);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/site-rules$/);

    if (!isMobile) {
      // And from anywhere in the app, with the keyboard.
      await page.keyboard.press("ControlOrMeta+k");
      await search.fill("dri");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/app\/drive$/);
    }
  });

  test("opens a browser from Home, and goes back to it", async ({ page, baseURL, isMobile }) => {
    test.skip(isMobile, "Starts a real browser; one run covers it.");
    test.setTimeout(120_000);
    await signedIn(page, baseURL, "home-open");
    const dock = page.getByRole("list", { name: "Your browsers" });
    await dock.getByRole("button", { name: "Open Bee Browser", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/browser\?session=/, { timeout: 60_000 });
    const viewport = page.getByTestId("browser-viewport");
    await expect
      .poll(() => viewport.getAttribute("data-frames"), { timeout: 60_000 })
      .not.toBe("0");
    const sessionUrl = page.url();

    // Home now counts it and offers the way back to it.
    await page.goto("/app");
    await expect(page.getByRole("region", { name: "Sessions today" })).toContainText("1 open now");
    await expect(page.getByRole("region", { name: "Sessions today" })).toContainText("1");
    await dock.getByRole("button", { name: "Go back to Bee Browser" }).click();
    await expect(page).toHaveURL(sessionUrl);

    await expect
      .poll(() => viewport.getAttribute("data-frames"), { timeout: 60_000 })
      .not.toBe("0");
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "End session" }).click();
    await page
      .getByRole("alertdialog", { name: "End this browser session?" })
      .getByRole("button", { name: "End session" })
      .click();
    await expect(page.getByText("You ended this browser session.")).toBeVisible({
      timeout: 30_000,
    });
  });
});
