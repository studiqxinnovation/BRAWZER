import { expect, type Page, test } from "@playwright/test";
import { horizontalOverflow, wcagViolations } from "./accessibility";
import { createConfirmedAccount, GREETING, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "violet-harbor-lantern";

async function signedIn(page: Page, baseURL: string | undefined, tag: string) {
  await page.addInitScript(() => {
    // A returning visitor: nothing new arrives on its own, so the audits see a still page.
    sessionStorage.setItem("brawzer:notices-seen", String(Date.now() + 60_000));
    // Mac style to begin with, whatever system runs the tests (the default follows it).
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
}

const viewMenu = async (page: Page, item: string) => {
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
};

test.describe("desktop", () => {
  test("the app as a desktop: its window, the dock, wallpapers, both styles and the classic layout", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "Phones keep the plain layout; see the next test.");
    await signedIn(page, baseURL, "desktop");
    const html = page.locator("html");

    // The dashboard is a window of its own, with its title, controls and status.
    const dashboard = page.getByRole("button", { name: "Close Brawzer" });
    await expect(dashboard).toBeVisible();
    await expect(page.getByText("Brawzer — Home")).toBeVisible();
    await expect(page.getByLabel("Status")).toContainText("Cloud connected");
    await expect(page.getByLabel("Status")).toContainText("0 of 3 browsers open");
    const dock = page.getByRole("navigation", { name: "Dock" });
    await expect(dock.getByRole("button", { name: "Brawzer, open" })).toBeVisible();
    for (const name of ["Bee Browser", "Chrome", "Firefox", "Chromium"]) {
      await expect(dock.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("navigation", { name: "Taskbar" })).toBeHidden();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await wcagViolations(page), colorScheme).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: "light" });

    // Its title follows the page, and back goes back.
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Drive" })
      .click();
    await expect(page.getByText("Brawzer — Drive")).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByText("Brawzer — Home")).toBeVisible();

    // Closing it leaves the desktop; the dock brings it back.
    await dashboard.click();
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeHidden();
    await dock.getByRole("button", { name: "Brawzer", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();

    // Dragged by its title bar it moves; Zoom fills the desktop, and again goes back.
    const window = page.locator(".dt-dash");
    const filled = await window.boundingBox();
    const title = await page.getByText("Brawzer — Home").boundingBox();
    if (filled && title) {
      await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
      await page.mouse.down();
      await page.mouse.move(title.x + title.width / 2 + 120, title.y + 90, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => Math.round((await window.boundingBox())?.x ?? 0)).toBe(126);
      await page.getByRole("button", { name: "Zoom Brawzer" }).click();
      await expect.poll(async () => (await window.boundingBox())?.x).toBe(filled.x);
      await page.getByRole("button", { name: "Zoom Brawzer" }).click();
      await expect.poll(async () => Math.round((await window.boundingBox())?.x ?? 0)).toBe(126);
    }

    // A wallpaper, kept for this tab.
    await viewMenu(page, "Change wallpaper…");
    const wallpapers = page.getByRole("dialog", { name: "Wallpaper" });
    await expect(wallpapers.getByRole("radio", { name: "Brawzer" })).toBeChecked();
    expect(await wcagViolations(page)).toEqual([]);
    await wallpapers.getByRole("radio", { name: "Ocean" }).click();
    await expect(wallpapers.getByRole("radio", { name: "Ocean" })).toBeChecked();
    await expect(html).toHaveAttribute("data-wallpaper", "ocean");
    await wallpapers.getByRole("button", { name: "Done" }).click();
    await page.reload();
    await expect(html).toHaveAttribute("data-wallpaper", "ocean");

    // Windows style: a taskbar with Start, search and the tray instead of the dock.
    await viewMenu(page, "Windows");
    await expect(html).toHaveAttribute("data-desktop-style", "windows");
    const taskbar = page.getByRole("navigation", { name: "Taskbar" });
    await expect(taskbar).toBeVisible();
    await expect(dock).toBeHidden();
    await expect(page.getByRole("menubar", { name: "Brawzer menu bar" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Maximise Brawzer" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await taskbar.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("combobox", { name: "Launch a browser or search" })).toBeFocused();
    await page.keyboard.press("Escape");
    await taskbar.getByRole("button", { name: "Start" }).click();
    const start = page.getByRole("dialog", { name: "Start" });
    await expect(start.getByRole("button", { name: "Bee Browser" })).toBeVisible();
    await expect(start.getByRole("button", { name: "Lock" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await start.getByRole("button", { name: "Mac style" }).click();
    await expect(html).toHaveAttribute("data-desktop-style", "mac");
    await expect(dock).toBeVisible();

    // The classic layout: the app as a page again, without the desktop.
    await viewMenu(page, "Use the classic layout");
    await expect(html).toHaveAttribute("data-desktop", "off");
    await expect(dock).toBeHidden();
    await expect(page.getByRole("button", { name: "Close Brawzer" })).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await viewMenu(page, "Use the desktop");
    await expect(dock).toBeVisible();
  });

  test("apps open in windows from Launchpad, the dock and quick launch, beside Control Centre and the switcher", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "The apps are the desktop's.");
    await signedIn(page, baseURL, "desktop-apps");
    const dock = page.getByRole("navigation", { name: "Dock" });

    // Launchpad lists the browsers and the apps, found by typing.
    await dock.getByRole("button", { name: "Launchpad" }).click();
    const launchpad = page.getByRole("dialog", { name: "Launchpad" });
    await expect(launchpad.getByRole("button", { name: "Bee Browser" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await launchpad.getByRole("searchbox").fill("calc");
    await expect(launchpad.getByRole("button", { name: "Bee Browser" })).toHaveCount(0);
    await launchpad.getByRole("button", { name: "Calculator" }).click();
    await expect(launchpad).toBeHidden();

    // The calculator, by keyboard and by pointer.
    const calculator = page.getByRole("region", { name: "Calculator window" });
    await expect(calculator).toBeVisible();
    await calculator.getByRole("button", { name: "7" }).click();
    await page.keyboard.type("*6-2=");
    await expect(calculator.getByRole("status", { name: "Result" })).toHaveText("40");
    await calculator.getByRole("button", { name: "Divide" }).click();
    await calculator.getByRole("button", { name: "0", exact: true }).click();
    await calculator.getByRole("button", { name: "Equals" }).click();
    await expect(calculator.getByRole("status", { name: "Result" })).toHaveText("Error");
    await expect(dock.getByRole("button", { name: "Calculator, open" })).toBeVisible();

    // Settings from quick launch; it changes the desktop's style.
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox", { name: "Launch a browser or search" }).fill("settings");
    await page.keyboard.press("Enter");
    const settings = page.getByRole("region", { name: "Settings window" });
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "Desktop" }).click();
    await expect(settings.getByRole("radio", { name: "Mac: menu bar and dock" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(await wcagViolations(page)).toEqual([]);

    // The switcher goes back to the calculator.
    await page.keyboard.down("Alt");
    await page.keyboard.press("Backquote");
    await expect(page.getByRole("listbox", { name: "Windows" })).toBeVisible();
    await expect(page.getByRole("option", { selected: true })).toHaveText("Calculator");
    await page.keyboard.up("Alt");
    await expect(page.getByRole("listbox", { name: "Windows" })).toBeHidden();
    await expect(calculator).toHaveAttribute("data-focused", "true");

    // Control Centre's switches are real: dark mode.
    await page.getByRole("button", { name: "Control Centre" }).click();
    const control = page.getByRole("dialog", { name: "Control Centre" });
    await expect(control).toContainText("Cloud · Direct");
    await control.getByRole("button", { name: "Dark mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await wcagViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");

    // Closing an app's window closes just it; not kept in the Dock, it leaves the Dock too.
    await calculator.getByRole("button", { name: "Close Calculator" }).click();
    await expect(calculator).toBeHidden();
    await expect(dock.getByRole("button", { name: /^Calculator/ })).toHaveCount(0);
  });

  test("first visit: the style is chosen once; the desktop's menus, its files, Leave no trace and Wipe", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "The desktop needs a wide screen.");
    await page.addInitScript(() => {
      sessionStorage.setItem("brawzer:notices-seen", String(Date.now() + 60_000));
    });
    const email = uniqueEmail("desktop-first");
    await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD, {
      chooseDesktop: false,
    });
    await signIn(page.context(), baseURL ?? "", email, PASSWORD);
    await page.goto("/app");
    const html = page.locator("html");

    // "Choose your desktop", once: the choice is kept with the account.
    const picker = page.getByRole("dialog", { name: "Choose your desktop" });
    await expect(picker).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await picker.getByRole("button", { name: /^Mac style/ }).click();
    await expect(picker).toBeHidden();
    await expect(html).toHaveAttribute("data-desktop-style", "mac");
    await expect
      .poll(async () => {
        const records = (await (await page.request.get("/api/v1/apps/desktop/records")).json()) as {
          records: { key: string; data: { style?: string } }[];
        };
        return records.records.find((record) => record.key === "state")?.data.style;
      })
      .toBe("mac");
    await page.evaluate(() => {
      sessionStorage.removeItem("brawzer:desktop-style");
    });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();
    await expect(picker).toBeHidden();

    // The Dock's Brawzer icon sends the dashboard back, and brings it out again.
    const dock = page.getByRole("navigation", { name: "Dock" });
    await dock.getByRole("button", { name: "Brawzer, open" }).click();
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeHidden();
    const desktop = page.getByRole("list", { name: "Desktop" });
    await expect(desktop.getByRole("button", { name: "Brawzer Drive" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // Right-click the desktop: New → Text file makes one in Drive's "Desktop" folder and opens it.
    await page.mouse.click(500, 400, { button: "right" });
    const menu = page.getByRole("menu", { name: "Menu" });
    await expect(menu.getByRole("menuitem", { name: "Change wallpaper…" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await menu.getByRole("menuitem", { name: "New" }).click();
    await page
      .getByRole("menu", { name: "New" })
      .getByRole("menuitem", { name: "Text file" })
      .click();
    const notepad = page.getByRole("region", { name: "Notepad window" });
    await expect(notepad).toBeVisible();
    await expect(desktop.getByRole("button", { name: "Untitled.txt" })).toBeVisible();

    // A title bar's menu: Snap → Left half.
    await notepad.locator(".dt-bar").click({ button: "right", position: { x: 200, y: 18 } });
    await page.getByRole("menuitem", { name: "Snap" }).click();
    await page
      .getByRole("menu", { name: "Snap" })
      .getByRole("menuitem", { name: "Left half" })
      .click();
    await expect
      .poll(async () => Math.round((await notepad.boundingBox())?.x ?? -1))
      .toBeLessThanOrEqual(10);

    // Ctrl+M (⌘M on a Mac) tucks the window in front into the Dock.
    await notepad.locator(".dt-bar").click({ position: { x: 200, y: 18 } });
    await page.keyboard.press("ControlOrMeta+m");
    await expect(notepad).toBeHidden();
    await dock.getByRole("button", { name: "Notepad, minimised" }).click();
    await expect(notepad).toBeVisible();

    // Leave no trace: every window closes and the clipboard is cleared.
    await page.getByRole("button", { name: "Control Centre" }).click();
    await page
      .getByRole("dialog", { name: "Control Centre" })
      .getByRole("button", { name: /^Leave no trace/ })
      .click();
    const trace = page.getByRole("alertdialog", { name: "Leave no trace?" });
    await trace.getByRole("button", { name: "Leave no trace" }).click();
    const done = page.getByRole("alertdialog", { name: "No trace left" });
    await expect(done).toContainText("1 window closed");
    await done.getByRole("button", { name: "Done" }).click();
    await expect(notepad).toBeHidden();

    // File → Wipe this computer: signed out, and nothing left in this tab.
    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Wipe this computer…" }).click();
    await page
      .getByRole("alertdialog", { name: "Wipe this computer?" })
      .getByRole("button", { name: "Wipe now" })
      .click();
    await expect(page).toHaveURL(/\/sign-in\?signed_out=wiped$/);
    await expect(page.getByText("This computer is clean")).toBeVisible();
    // Nothing of the desktop is left in the tab (only the key this test sets on every page).
    expect(
      await page.evaluate(() =>
        Object.keys(sessionStorage).filter((key) => key !== "brawzer:notices-seen"),
      ),
    ).toEqual([]);
    expect((await page.request.get("/api/v1/auth/session")).status()).toBe(401);
  });

  test("the style follows the device's own system until one is chosen", async ({ page }) => {
    for (const [platform, style] of [
      ["MacIntel", "mac"],
      ["Win32", "windows"],
      ["Linux x86_64", "windows"],
    ] as const) {
      const fresh = await page.context().newPage();
      await fresh.addInitScript((value) => {
        Object.defineProperty(Navigator.prototype, "platform", { get: () => value });
      }, platform);
      await fresh.goto("/sign-in");
      await expect(fresh.locator("html"), platform).toHaveAttribute("data-desktop-style", style);
      await fresh.close();
    }
  });

  test("phones keep the plain layout", async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, "The desktop needs a wide screen.");
    await signedIn(page, baseURL, "desktop-phone");
    await expect(page.getByRole("navigation", { name: "Dock" })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Taskbar" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Close Brawzer" })).toBeHidden();
    expect(await horizontalOverflow(page)).toBe(0);
    expect(await wcagViolations(page)).toEqual([]);
  });

  test("a web app opens its site in a cloud browser window, and Screenshot saves the page to Drive", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "Starts a real browser on the desktop.");
    test.setTimeout(120_000);
    await signedIn(page, baseURL, "desktop-web-app");
    await page
      .getByRole("navigation", { name: "Dock" })
      .getByRole("button", { name: "App Store" })
      .click();
    const store = page.getByRole("region", { name: "App Store window" });
    await store.getByRole("tab", { name: "Web apps" }).click();
    await store
      .getByRole("listitem")
      .filter({ hasText: "Wikipedia" })
      .getByRole("button", { name: "Open", exact: true })
      .click();
    const window = page.getByRole("region", { name: "Bee Browser window" });
    await expect(window).toBeVisible({ timeout: 60_000 });
    await expect(window.locator("iframe")).toHaveAttribute(
      "src",
      /open=https%3A%2F%2Fwww\.wikipedia\.org%2F/,
    );
    const viewport = window.frameLocator("iframe").getByTestId("browser-viewport");
    await expect
      .poll(() => viewport.getAttribute("data-frames"), { timeout: 60_000 })
      .not.toBe("0");

    await page
      .getByRole("navigation", { name: "Dock" })
      .getByRole("button", { name: "Launchpad" })
      .click();
    await page.getByRole("dialog", { name: "Launchpad" }).getByRole("searchbox").fill("screenshot");
    await page
      .getByRole("dialog", { name: "Launchpad" })
      .getByRole("button", { name: "Screenshot" })
      .click();
    await page
      .getByRole("region", { name: "Screenshot window" })
      .getByRole("button", { name: "Take screenshot" })
      .click();
    await expect
      .poll(
        async () =>
          (
            (await (await page.request.get("/api/v1/drive/files?kind=images")).json()) as {
              files: { name: string }[];
            }
          ).files.length,
        { timeout: 30_000 },
      )
      .toBe(1);
    await window.getByRole("button", { name: "Close Bee Browser" }).click();
    await expect(page.getByText("Bee Browser closed")).toBeVisible({ timeout: 30_000 });
  });

  test("a browser opens from the dock in a window that streams it, minimises and closes", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "Starts a real browser on the desktop.");
    test.setTimeout(120_000);
    await signedIn(page, baseURL, "desktop-window");
    const dock = page.getByRole("navigation", { name: "Dock" });
    await dock.getByRole("button", { name: "Bee Browser", exact: true }).click();

    const window = page.getByRole("region", { name: "Bee Browser window" });
    await expect(window).toBeVisible({ timeout: 60_000 });
    const frame = window.frameLocator("iframe");
    const viewport = frame.getByTestId("browser-viewport");
    await expect
      .poll(() => viewport.getAttribute("data-frames"), { timeout: 60_000 })
      .not.toBe("0");
    // A window holds the browser alone: no sidebar or launcher of the app in it.
    await expect(frame.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    await expect(dock.getByRole("button", { name: "Bee Browser, open" })).toBeVisible();
    await expect(page.getByLabel("Status")).toContainText("1 of 3 browsers open");
    expect(await wcagViolations(page)).toEqual([]);

    // Minimised, it waits in the dock; its icon brings it back.
    await window.getByRole("button", { name: "Minimise Bee Browser" }).click();
    await expect(window).toBeHidden();
    await dock.getByRole("button", { name: "Bee Browser, minimised" }).click();
    await expect(window).toBeVisible();
    await expect
      .poll(() => viewport.getAttribute("data-frames"), { timeout: 60_000 })
      .not.toBe("0");

    // Dragged by its title bar to the left edge, it fills that half.
    const bar = window.locator(".dt-title");
    const box = await bar.boundingBox();
    const desk = page.viewportSize();
    if (box && desk) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x - 200, box.y + 40, { steps: 6 });
      await page.mouse.move(1, box.y + 40, { steps: 6 });
      await page.mouse.up();
      await expect
        .poll(async () => {
          const rect = await window.boundingBox();
          return rect ? Math.round(rect.x) <= 10 && rect.width < desk.width / 2 + 10 : false;
        })
        .toBe(true);
    }

    // Closing its window ends the session.
    await window.getByRole("button", { name: "Close Bee Browser" }).click();
    await expect(window).toBeHidden();
    await expect(page.getByText("Bee Browser closed")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Status")).toContainText("0 of 3 browsers open");
  });
});
