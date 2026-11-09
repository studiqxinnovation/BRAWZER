import { expect, type Page, test } from "@playwright/test";
import { horizontalOverflow, wcagViolations } from "./accessibility";
import { expireIdentityConfirmation } from "./database";
import { createConfirmedAccount, otherDevice, signIn, uniqueEmail } from "./mailbox";

// The signed-in app against the real API, Postgres, Valkey and Mailpit.

const PASSWORD = "violet-harbor-lantern";

/** A fresh, confirmed account, signed in on this test's page. */
async function signedIn(page: Page, baseURL: string | undefined, tag: string): Promise<string> {
  const email = uniqueEmail(tag);
  await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
  await signIn(page.context(), baseURL ?? "", email, PASSWORD);
  return email;
}

/** The session keeper streams in after the page; wait until it's tracking idle time. */
async function keeperReady(page: Page, mode: "shared" | "persistent" = "shared") {
  await expect(page.locator("html")).toHaveAttribute("data-session-keeper", mode);
}

const appPages = [
  { path: "/app", heading: "Home" },
  { path: "/app/browser", heading: "Browser" },
  { path: "/app/profiles", heading: "Profiles" },
  { path: "/app/drive", heading: "Drive" },
  { path: "/app/proxy", heading: "Proxy" },
  { path: "/app/extensions", heading: "Extensions" },
  { path: "/app/shield", heading: "Shield" },
  { path: "/app/site-rules", heading: "Site rules" },
  { path: "/app/sessions", heading: "Sessions" },
  { path: "/app/team", heading: "Team" },
  { path: "/app/account", heading: "Account" },
] as const;

test.describe("navigation", () => {
  test("the sidebar moves between sections and marks the current one", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "phones use the drawer");
    await signedIn(page, baseURL, "nav");
    await page.goto("/app");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    // Home opens the cloud browser; no development notes are left on it.
    await expect(page.getByRole("heading", { name: "Cloud browser" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start browsing" })).toHaveAttribute(
      "href",
      "/app/browser",
    );
    await expect(page.getByRole("note", { name: /Development state/ })).toHaveCount(0);

    await nav.getByRole("link", { name: "Sessions" }).click();
    await expect(page).toHaveURL(/\/app\/sessions$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sessions");
    await expect(nav.getByRole("link", { name: "Sessions" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await nav.getByRole("link", { name: /^Extensions/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Extensions");
    await expect(page.getByRole("list", { name: "Extension catalogue" })).toBeVisible();
  });

  test("phones open the navigation in a drawer", async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, "desktop uses the sidebar");
    await signedIn(page, baseURL, "drawer");
    await page.goto("/app");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("navigation", { name: "Brawzer" })
      .getByRole("link", { name: "Shield" })
      .click();
    await expect(page).toHaveURL(/\/app\/shield$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Shield");
    await expect(page.getByRole("navigation", { name: "Brawzer" })).toBeHidden();
  });

  test("an expired session cookie leads back to sign-in", async ({ page, baseURL }) => {
    await page
      .context()
      .addCookies([{ name: "brawzer_session", value: "A".repeat(43), url: baseURL ?? "" }]);
    await page.goto("/app/sessions");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fsessions&expired=1$/);
    await expect(page.getByText("Your session has ended")).toBeVisible();
  });
});

test.describe("accessibility of signed-in pages", () => {
  test("every page has one h1, fits small screens and has no WCAG violations", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    await signedIn(page, baseURL, "a11y-app");
    for (const { path, heading } of appPages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(page.locator("h1")).toHaveCount(1);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        expect(await wcagViolations(page), `${path} ${colorScheme}`).toEqual([]);
      }
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("sessions", () => {
  test("signing out another device clears its open page", async ({ page, browser, baseURL }) => {
    const email = await signedIn(page, baseURL, "remote");
    const phone = await otherDevice(browser, baseURL ?? "", email, PASSWORD);
    const phonePage = await phone.newPage();
    await phonePage.clock.install();
    await phonePage.goto("/app");
    await keeperReady(phonePage);

    await page.goto("/app/sessions");
    await expect(page.getByText("This device")).toBeVisible();
    // The other device's row (its button is named after the device).
    await page
      .getByRole("listitem")
      .getByRole("button", { name: /^Sign out / })
      .click();
    await expect(page.getByText("No other devices are signed in.")).toBeVisible();

    // The phone's page notices on its next background check (every 30 seconds).
    await phonePage.clock.fastForward("00:31");
    await expect(phonePage).toHaveURL(/\/sign-in\?expired=1&next=%2Fapp$/);
    await phone.close();
  });

  test("sign out every other device after confirming", async ({ page, browser, baseURL }) => {
    const email = await signedIn(page, baseURL, "others");
    const phone = await otherDevice(browser, baseURL ?? "", email, PASSWORD);
    const library = await otherDevice(browser, baseURL ?? "", email, PASSWORD);

    await page.goto("/app/sessions");
    await page.getByRole("button", { name: "Sign out all other devices" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Sign out 2 devices?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Sign out 2 devices" }).click();
    await expect(page.getByText("No other devices are signed in.")).toBeVisible();

    for (const context of [phone, library]) {
      expect((await context.request.get("/api/v1/auth/session/status")).status()).toBe(401);
      await context.close();
    }
    expect((await page.request.get("/api/v1/auth/session/status")).status()).toBe(204);
  });
});

test.describe("confirming it's you", () => {
  test("signing a device out after a while asks for the password first", async ({
    page,
    browser,
    baseURL,
  }) => {
    const email = await signedIn(page, baseURL, "confirm");
    const phone = await otherDevice(browser, baseURL ?? "", email, PASSWORD);
    await expireIdentityConfirmation(email);

    await page.goto("/app/sessions");
    await page
      .getByRole("listitem")
      .getByRole("button", { name: /^Sign out / })
      .click();
    const dialog = page.getByRole("dialog", { name: "Confirm it’s you" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Password", { exact: true })).toBeFocused();

    await dialog.getByLabel("Password", { exact: true }).fill("not-my-password");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog.getByText("That isn’t your password.")).toBeVisible();

    await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("No other devices are signed in.")).toBeVisible();
    expect((await phone.request.get("/api/v1/auth/session/status")).status()).toBe(401);
    await phone.close();
  });

  test("cancelling leaves everything as it was", async ({ page, browser, baseURL }) => {
    const email = await signedIn(page, baseURL, "confirm-cancel");
    const phone = await otherDevice(browser, baseURL ?? "", email, PASSWORD);
    await expireIdentityConfirmation(email);

    await page.goto("/app/sessions");
    await page
      .getByRole("listitem")
      .getByRole("button", { name: /^Sign out / })
      .click();
    await page
      .getByRole("dialog", { name: "Confirm it’s you" })
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(page.getByRole("dialog", { name: "Confirm it’s you" })).toBeHidden();
    expect((await phone.request.get("/api/v1/auth/session/status")).status()).toBe(204);
    await phone.close();
  });
});

test.describe("account", () => {
  test("change the password, which signs out the other devices", async ({
    page,
    browser,
    baseURL,
  }) => {
    const email = await signedIn(page, baseURL, "change");
    const phone = await otherDevice(browser, baseURL ?? "", email, PASSWORD);

    await page.goto("/app/account");
    const current = page.getByLabel("Current password", { exact: true });
    const next = page.getByLabel("New password", { exact: true });
    await current.fill("not-my-password");
    await next.fill("amber-river-compass");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("That isn’t your current password.")).toBeVisible();
    await expect(current).toBeFocused();

    await current.fill(PASSWORD);
    await next.fill("amber-river-compass");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/1 other device was signed out/)).toBeVisible();
    await expect(current).toHaveValue("");

    expect((await phone.request.get("/api/v1/auth/session/status")).status()).toBe(401);
    expect((await page.request.get("/api/v1/auth/session/status")).status()).toBe(204);
    await phone.close();
  });

  test("Shield shows the account's security history", async ({ page, baseURL }) => {
    const email = await signedIn(page, baseURL, "shield");
    const origin = new URL(baseURL ?? "").origin;
    await page.request.post("/api/v1/auth/login", {
      data: { email, password: "wrong-password-1" },
      headers: { origin },
    });

    await page.goto("/app/shield");
    const activity = page.getByRole("list").filter({ hasText: "Account created" });
    for (const entry of [
      "Failed sign-in: wrong password",
      "Signed in",
      "Email address confirmed",
    ]) {
      await expect(activity.getByText(entry, { exact: true }).first()).toBeVisible();
    }
  });
});

test.describe("shared-computer safety", () => {
  test("warns before signing out an idle session, then signs out and clears the page", async ({
    page,
    baseURL,
  }) => {
    await signedIn(page, baseURL, "idle");
    await page.clock.install();
    await page.goto("/app/account");
    await keeperReady(page);

    await page.clock.fastForward("26:30");
    const warning = page.getByRole("alertdialog", { name: "Are you still there?" });
    await expect(warning).toBeVisible();
    // Focus starts on "Sign out": if the owner has walked away, a passer-by
    // pressing Enter signs them out instead of keeping their account open.
    await expect(warning.getByRole("button", { name: "Sign out" })).toBeFocused();

    await page.clock.fastForward("01:40");
    await expect(page).toHaveURL(/\/sign-in\?signed_out=idle$/);
    await expect(page.getByText("You were signed out")).toBeVisible();
    expect((await page.request.get("/api/v1/auth/session/status")).status()).toBe(401);
  });

  test("“Stay signed in” keeps the session", async ({ page, baseURL }) => {
    await signedIn(page, baseURL, "stay");
    await page.clock.install();
    await page.goto("/app");
    await keeperReady(page);

    await page.clock.fastForward("26:30");
    await page.getByRole("button", { name: "Stay signed in" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await page.clock.fastForward("05:00");
    await expect(page).toHaveURL(/\/app$/);
    expect((await page.request.get("/api/v1/auth/session/status")).status()).toBe(204);
  });

  test("signing out in one tab signs out the others", async ({ page, baseURL }) => {
    await signedIn(page, baseURL, "tabs");
    const second = await page.context().newPage();
    await second.goto("/app/shield");
    await keeperReady(second);
    await page.goto("/app");
    await keeperReady(page);

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in\?signed_out=1$/);
    await expect(second).toHaveURL(/\/sign-in\?signed_out=1$/);
  });

  test("a kept-signed-in session doesn't idle out", async ({ page, baseURL }) => {
    const email = uniqueEmail("persistent");
    await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
    const origin = new URL(baseURL ?? "").origin;
    await page.request.post("/api/v1/auth/login", {
      data: { email, password: PASSWORD, keepSignedIn: true },
      headers: { origin },
    });
    await page.clock.install();
    await page.goto("/app");
    await keeperReady(page, "persistent");

    await page.clock.fastForward("29:00");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/app$/);
  });
});
