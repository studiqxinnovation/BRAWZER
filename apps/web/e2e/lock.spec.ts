import { expect, type Page, test } from "@playwright/test";
import { horizontalOverflow, wcagViolations } from "./accessibility";
import { createConfirmedAccount, GREETING, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "violet-harbor-lantern";

async function signedIn(page: Page, baseURL: string | undefined, tag: string): Promise<string> {
  await page.addInitScript(() => {
    // A returning visitor in Mac style: nothing slides in during the audits.
    sessionStorage.setItem("brawzer:notices-seen", String(Date.now() + 60_000));
    if (!sessionStorage.getItem("brawzer:desktop-style")) {
      sessionStorage.setItem("brawzer:desktop-style", "mac");
    }
  });
  const email = uniqueEmail(tag);
  await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
  await signIn(page.context(), baseURL ?? "", email, PASSWORD);
  await page.goto("/app");
  await expect(page.locator("html")).toHaveAttribute("data-session-keeper", /.+/);
  await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();
  return email;
}

const lockScreen = (page: Page) => page.getByRole("dialog", { name: "Brawzer is locked" });

async function eventTypes(page: Page): Promise<string[]> {
  const page1 = (await (await page.request.get("/api/v1/security/events")).json()) as {
    events: { type: string }[];
  };
  return page1.events.map((event) => event.type);
}

test.describe("lock screen", () => {
  test("locks from the menu bar, holds on a reload, and unlocks with the password", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "Phones lock from another device's page; see the next test.");
    const email = await signedIn(page, baseURL, "lock");

    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Lock screen" }).click();
    const lock = lockScreen(page);
    await expect(lock).toBeVisible();
    await expect(lock).toContainText(email);
    await expect(lock).toContainText("Your cloud browsers wait while it’s locked");
    await expect(lock.getByLabel("Password", { exact: true })).toBeFocused();
    // The server holds the lock: the API answers nothing else.
    const refused = await page.request.get("/api/v1/profiles");
    expect(refused.status()).toBe(423);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await wcagViolations(page), colorScheme).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: "light" });

    // A reload shows the lock screen alone: nothing of the app is sent.
    await page.reload();
    await expect(lockScreen(page)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Dock" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toHaveCount(0);

    await lockScreen(page).getByLabel("Password", { exact: true }).fill("not-my-password");
    await lockScreen(page).getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(lockScreen(page)).toContainText("That isn’t your password.");

    await lockScreen(page).getByLabel("Password", { exact: true }).fill(PASSWORD);
    await lockScreen(page).getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(lockScreen(page)).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();
    expect((await page.request.get("/api/v1/profiles")).status()).toBe(200);
    expect((await eventTypes(page)).slice(0, 2)).toEqual(["session.unlocked", "session.locked"]);

    // Locked in place, unlocking keeps the page as it was.
    // Unlocking loads the page again; its menus work once it's interactive.
    await expect(page.locator("html")).toHaveAttribute("data-session-keeper", /.+/);
    await page.getByRole("button", { name: "Browse", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Drive/ }).click();
    await expect(page.locator(".dt-chrome .dt-title")).toHaveText(/^Drive/);
    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Lock screen" }).click();
    await lockScreen(page).getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.keyboard.press("Enter");
    await expect(lockScreen(page)).toBeHidden();
    await expect(page.locator(".dt-chrome .dt-title")).toHaveText(/^Drive/);
    await expect(page).toHaveURL(/\/app\/drive$/);
  });

  test("every tab of the sign-in locks together, and signing out works while locked", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await signedIn(page, baseURL, "lock-tabs");
    const other = await page.context().newPage();
    await other.goto("/app/account");
    await expect(other.getByRole("heading", { level: 1 })).toBeVisible();

    const locked = await page.request.post("/api/v1/auth/session/lock", {
      headers: { origin: baseURL ?? "" },
    });
    expect(locked.status()).toBe(204);
    // The next thing either page asks of the server shows the lock, in both.
    await page.reload();
    await expect(lockScreen(page)).toBeVisible();
    await expect(lockScreen(other)).toBeVisible({ timeout: 15_000 });
    if (isMobile) {
      expect(await horizontalOverflow(page)).toBe(0);
      expect(await wcagViolations(page)).toEqual([]);
    }

    await lockScreen(page)
      .getByRole("button", { name: "Forgot your password? Wipe and sign out" })
      .click();
    await expect(page).toHaveURL(/\/sign-in\?signed_out=1/);
    await expect(other).toHaveURL(/\/sign-in/, { timeout: 15_000 });
  });

  test("locking stops a browser window's stream, and unlocking brings it back", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "Starts a real browser on the desktop.");
    test.setTimeout(120_000);
    await signedIn(page, baseURL, "lock-window");
    const dock = page.getByRole("navigation", { name: "Dock" });
    await dock.getByRole("button", { name: "Bee Browser", exact: true }).click();
    const window = page.getByRole("region", { name: "Bee Browser window" });
    const viewport = window.frameLocator("iframe").getByTestId("browser-viewport");
    await expect
      .poll(() => viewport.getAttribute("data-frames"), { timeout: 60_000 })
      .not.toBe("0");

    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Lock screen" }).click();
    await expect(lockScreen(page)).toBeVisible();
    await expect(window.locator("iframe")).toHaveCount(0);

    await lockScreen(page).getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.keyboard.press("Enter");
    await expect(lockScreen(page)).toBeHidden();
    await expect
      .poll(() => viewport.getAttribute("data-frames"), { timeout: 60_000 })
      .not.toBe("0");
    await window.getByRole("button", { name: "Close Bee Browser" }).click();
    await expect(page.getByText("Bee Browser closed")).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("faces and switching user", () => {
  test("a picture chosen in Settings shows on the lock screen, and Switch user signs out for the next person", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "Phones keep the plain layout.");
    const email = await signedIn(page, baseURL, "faces");
    // Settings → About: choose a picture; it goes to Drive and shows at once.
    await page.getByRole("menuitem").first().click();
    await page.getByRole("menuitem", { name: "Settings…" }).click();
    const settings = page.getByRole("region", { name: "Settings window" });
    await settings.getByRole("button", { name: "About Brawzer" }).click();
    await expect(settings).toContainText(email);
    const chooser = page.waitForEvent("filechooser");
    await settings.getByRole("button", { name: "Choose a picture…" }).click();
    await (
      await chooser
    ).setFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    await expect(page.getByText("That’s you now")).toBeVisible({ timeout: 15_000 });
    await expect(settings.getByTestId("face")).toHaveAttribute(
      "src",
      /\/api\/v1\/drive\/files\/[0-9a-f-]{36}\/preview/,
    );

    // The lock screen shows the picture, and offers to switch user.
    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Lock screen" }).click();
    const lock = lockScreen(page);
    await expect(lock).toBeVisible();
    await expect(lock.getByTestId("face")).toBeVisible();
    await lock.getByRole("button", { name: "Switch user" }).click();
    await expect(page).toHaveURL(/\/sign-in\?signed_out=switch/, { timeout: 30_000 });
    await expect(page.getByRole("status")).toContainText("Ready for someone else");
  });
});
