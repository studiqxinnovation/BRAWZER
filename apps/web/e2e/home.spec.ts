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
    // A returning visitor: nothing new arrives on its own, so the audits see a still page.
    await page.addInitScript(() => {
      sessionStorage.setItem("brawzer:notices-seen", String(Date.now() + 60_000));
    });
    await signedIn(page, baseURL, "home");
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();
    await expect(page.getByText("Cloud is running · only pixels reach this device")).toBeVisible();
    await expect(page.getByRole("note", { name: "Shared-computer mode" })).toContainText(
      "after 30 minutes without activity",
    );

    // The numbers, each from the account itself.
    await expect(page.getByRole("region", { name: "Sessions today" })).toContainText("None yet");
    await expect(page.getByRole("region", { name: "Active profiles" })).toContainText(
      "“Personal” is the default · of 10",
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
      // On the desktop, the title bar's Protect menu counts them, as the prototype does.
      await expect(page.getByRole("button", { name: "Protect 2" })).toBeVisible();
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
    await expect(page.getByRole("region", { name: "Usage" })).toContainText(
      "No browsing yet this month.",
    );

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await wcagViolations(page), colorScheme).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: "light" });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // The bell: what happened lately, sliding in as notices; each can be dismissed.
    const notices = page.getByRole("region", { name: "Recent notices" });
    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toHaveAccessibleName("Notifications");
    await bell.click();
    await expect(bell).toHaveAttribute("aria-expanded", "true");
    await expect(notices.getByText("Shield · Security").first()).toBeVisible();
    const cards = notices.getByRole("listitem");
    await expect(cards.last()).toHaveCSS("opacity", "1");
    expect(await wcagViolations(page)).toEqual([]);
    const before = await cards.count();
    await notices
      .getByRole("button", { name: /^Dismiss / })
      .first()
      .click();
    await expect(cards).toHaveCount(before - 1);
    // The classic page's notices end with a way to Shield; the desktop's slide in as the prototype's, bare.
    await expect(notices.getByRole("link", { name: "See all activity in Shield" })).toHaveCount(
      isMobile ? 1 : 0,
    );
    await page.keyboard.press("Escape");
    await expect(bell).toHaveAttribute("aria-expanded", "false");

    // Search: any page, by typing.
    await page.getByRole("button", { name: "Search Brawzer" }).click();
    const search = page.getByRole("combobox", { name: "Launch a browser or search" });
    // The browsers come first, each ready to launch.
    await expect(page.getByRole("option").first()).toHaveAccessibleName(/^Bee Browser\s*Launch$/);
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

  test("opens a browser from Home in a window of its own, and goes back to it", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "Starts a real browser; one run covers it.");
    test.setTimeout(120_000);
    await signedIn(page, baseURL, "home-open");
    const dock = page.getByRole("list", { name: "Your browsers" });
    await dock.getByRole("button", { name: "Open Bee Browser", exact: true }).click();
    // On the desktop it opens in a window that streams it, and Home stays where it is.
    const window = page.getByRole("region", { name: "Bee Browser window" });
    await expect(window).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/app$/);
    const viewport = window.frameLocator("iframe").getByTestId("browser-viewport");
    await expect
      .poll(() => viewport.getAttribute("data-frames"), { timeout: 60_000 })
      .not.toBe("0");

    // Home now counts it and offers the way back to it.
    await window.getByRole("button", { name: "Minimise Bee Browser" }).click();
    await expect(window).toBeHidden();
    await page.reload();
    await expect(page.getByRole("region", { name: "Sessions today" })).toContainText("1 open now");
    await dock.getByRole("button", { name: "Go back to Bee Browser" }).click();
    await expect(window).toBeVisible();
    await expect
      .poll(() => viewport.getAttribute("data-frames"), { timeout: 60_000 })
      .not.toBe("0");

    // Closing its window ends the session.
    await window.getByRole("button", { name: "Close Bee Browser" }).click();
    await expect(window).toBeHidden();
    await expect(page.getByText("Bee Browser closed")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () =>
          (
            (await (await page.request.get("/api/v1/browser")).json()) as {
              sessions: unknown[];
            }
          ).sessions.length,
      )
      .toBe(0);
  });
});

test("new notices arrive on their own, counted on the bell", async ({ page, baseURL }) => {
  await signedIn(page, baseURL, "home-notices");
  const bell = page.getByRole("button", { name: /^Notifications/ });
  await expect(bell).toHaveAccessibleName(/^Notifications, \d new$/);
  await expect(bell).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("region", { name: "Recent notices" })).toContainText(
    "Shield · Security",
  );
  // They step back after a few seconds, and count as seen next time.
  await expect(bell).toHaveAttribute("aria-expanded", "false", { timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
});
