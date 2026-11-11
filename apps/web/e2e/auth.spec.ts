import { expect, type Page, test } from "@playwright/test";
import { horizontalOverflow, wcagViolations } from "./accessibility";
import {
  createConfirmedAccount,
  expectSignedInAs,
  GREETING,
  linkFromEmail,
  otherDevice,
  uniqueEmail,
} from "./mailbox";

// Requires the local services (`pnpm infra:up`): real API, Postgres, Valkey and Mailpit.

const PASSWORD = "violet-harbor-lantern";
const SESSION_COOKIE = "brawzer_session";

// Next keeps the previous page mounted (hidden) after client navigation, so
// field locators must ignore hidden copies. Password inputs have no ARIA
// role, hence getByLabel plus a visibility filter.
const emailField = (page: Page) => page.getByRole("textbox", { name: "Email" });
const passwordField = (page: Page, label = "Password") =>
  page.getByLabel(label, { exact: true }).filter({ visible: true });

async function sessionCookie(page: Page) {
  return (await page.context().cookies()).find((cookie) => cookie.name === SESSION_COOKIE);
}

test.describe("account journey", () => {
  test("create an account, confirm it with the chosen password, sign out", async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    const email = uniqueEmail("journey");
    await page.goto("/create-account");
    await emailField(page).fill(email);
    await passwordField(page).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();
    await expect(page.getByText(email)).toBeVisible();
    expect(await sessionCookie(page)).toBeUndefined();

    await page.goto(await linkFromEmail(request, email, "Confirm your email", baseURL ?? ""));
    await expect(page.getByRole("heading", { name: "Confirm your email" })).toBeVisible();
    // The token is removed from the address bar as soon as the page has read it.
    await expect(page).toHaveURL(/\/verify-email$/);

    await passwordField(page).fill("not-the-chosen-password");
    await page.getByRole("button", { name: "Confirm and sign in" }).click();
    await expect(page.getByText("That isn’t the password you chose")).toBeVisible();
    await expect(passwordField(page)).toHaveAttribute("aria-invalid", "true");

    await passwordField(page).fill(PASSWORD);
    await page.getByRole("button", { name: "Confirm and sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);
    // A new account on a wide screen is asked, once, which desktop it wants.
    if (!isMobile) {
      const picker = page.getByRole("dialog", { name: "Choose your desktop" });
      await picker.getByRole("button", { name: /^Mac style/ }).click();
      await expect(picker).toBeHidden();
    }
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();
    await expectSignedInAs(page, email);
    await expect(
      page
        .getByRole("note", { name: "Shared-computer mode" })
        .getByText("Shared-computer mode is on"),
    ).toBeVisible();

    // Shared-computer default: HttpOnly, SameSite=Lax, gone when the browser closes.
    expect(await sessionCookie(page)).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
      expires: -1,
    });

    // The session keeper marks <html> after hydration; clicking earlier does nothing.
    await expect(page.locator("html")).toHaveAttribute("data-session-keeper", /.+/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in\?signed_out=1$/);
    await expect(page.getByText("You’ve signed out")).toBeVisible();
    expect(await sessionCookie(page)).toBeUndefined();

    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp$/);
  });

  test("sign in with the shared-computer default, or stay signed in when asked", async ({
    page,
    request,
    baseURL,
  }) => {
    const email = uniqueEmail("signin");
    await createConfirmedAccount(request, baseURL ?? "", email, PASSWORD);

    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp$/);
    const keepSignedIn = page.getByRole("checkbox", { name: "Keep me signed in on this device" });
    await expect(keepSignedIn).not.toBeChecked();
    await expect(keepSignedIn).toHaveAccessibleDescription(/Only on your own computer/);

    await emailField(page).fill(email);
    await passwordField(page).fill("wrong-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    // (Next's route announcer is also role="alert", so match by text.)
    await expect(
      page.getByRole("alert").filter({ hasText: "Email or password is incorrect." }),
    ).toBeVisible();
    expect(await sessionCookie(page)).toBeUndefined();

    await passwordField(page).fill(PASSWORD);
    await keepSignedIn.check();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("region", { name: "Network" })).toContainText(
      "Kept on this device",
    );
    await expect(page.getByRole("note", { name: "Shared-computer mode" })).toHaveCount(0);

    const cookie = await sessionCookie(page);
    const twentyNineDays = Date.now() / 1000 + 29 * 24 * 60 * 60;
    expect(cookie?.expires).toBeGreaterThan(twentyNineDays);
  });

  test("validate the form in place before sending anything", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(emailField(page)).toBeFocused();

    await page.goto("/create-account");
    await emailField(page).fill("someone@example.com");
    await passwordField(page).fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
    await expect(passwordField(page)).toBeFocused();
  });

  test("show and hide the password", async ({ page }) => {
    await page.goto("/sign-in");
    await passwordField(page).fill("secret-words-here");
    await expect(passwordField(page)).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(passwordField(page)).toHaveAttribute("type", "text");
  });
});

test.describe("password reset", () => {
  test("reset the password from an emailed link, then sign in with the new one", async ({
    page,
    request,
    baseURL,
  }) => {
    const email = uniqueEmail("reset");
    await createConfirmedAccount(request, baseURL ?? "", email, PASSWORD);

    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await emailField(page).fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();

    await page.goto(
      await linkFromEmail(request, email, "Reset your Brawzer password", baseURL ?? ""),
    );
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await expect(page).toHaveURL(/\/reset-password$/);

    const newPassword = passwordField(page, "New password");
    await newPassword.fill("password1234");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/too common/)).toBeVisible();

    await newPassword.fill("amber-river-compass");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("heading", { name: "Password changed" })).toBeFocused();

    await page.getByRole("link", { name: "Sign in" }).click();
    await emailField(page).fill(email);
    await passwordField(page).fill("amber-river-compass");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test("explain what to do with an incomplete or used link", async ({ page }) => {
    await page.goto("/verify-email");
    await expect(page.getByRole("heading", { name: "This link isn’t complete" })).toBeVisible();

    // Well-formed but unknown: the API rejects it.
    await page.goto(`/reset-password#token=${"A".repeat(43)}`);
    await passwordField(page, "New password").fill("amber-river-compass");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(
      page.getByRole("heading", { name: "This link has expired or has already been used" }),
    ).toBeFocused();
    await expect(page.getByRole("link", { name: "Request a new link" })).toBeVisible();
  });
});

test.describe("accessibility of account pages", () => {
  for (const path of [
    "/sign-in",
    "/create-account",
    "/forgot-password",
    "/verify-email",
    "/reset-password",
  ]) {
    test(`${path} has one h1, works on small screens and has no WCAG violations`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        expect(await wcagViolations(page), `${path} ${colorScheme}`).toEqual([]);
      }
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("form errors and the signed-in page have no WCAG violations", async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto("/create-account");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    const email = uniqueEmail("a11y");
    await createConfirmedAccount(request, baseURL ?? "", email, PASSWORD);
    // A returning visitor: Home's notices don't slide in while the audit runs.
    await page.addInitScript(() => {
      sessionStorage.setItem("brawzer:notices-seen", String(Date.now() + 60_000));
    });
    await page.goto("/sign-in");
    await emailField(page).fill(email);
    await passwordField(page).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await wcagViolations(page), `/app ${colorScheme}`).toEqual([]);
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("before the page is interactive", () => {
  // With scripts off, the browser submits the form itself, as it would for
  // someone who presses Enter before the page has finished loading.
  test("a submitted form never puts what was typed in the address", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    const page = await context.newPage();
    for (const path of ["/sign-in", "/create-account"]) {
      await page.goto(path);
      await page.getByRole("textbox", { name: "Email" }).fill("someone@example.com");
      const password = page.getByLabel("Password", { exact: true });
      await password.fill("violet-harbor-lantern");
      await password.press("Enter");
      await page.waitForLoadState();
      expect(page.url(), path).not.toContain("violet-harbor-lantern");
      expect(new URL(page.url()).search, path).toBe("");
    }
    await context.close();
  });
});

test.describe("sign in with your phone", () => {
  test("sign in on a computer by approving from a signed-in phone", async ({
    page,
    browser,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "The computer side is a desktop; the phone side is its own context.");
    test.setTimeout(60_000);
    const email = uniqueEmail("phone");
    const password = "violet-harbor-lantern";
    await createConfirmedAccount(page.request, baseURL ?? "", email, password);

    // The computer: a code and a number, nothing typed.
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Sign in with your phone" }).click();
    await expect(page.getByRole("heading", { name: "Sign in with your phone" })).toBeVisible();
    const qr = page.getByRole("img", { name: "QR code to scan with your phone" });
    await expect(qr).toBeVisible();
    const approvalUrl = (await qr.getAttribute("data-approval-url")) ?? "";
    expect(approvalUrl).toContain("/app/approve-sign-in?r=");
    const code = (await page.locator("p.font-mono").textContent())?.trim() ?? "";
    expect(code).toMatch(/^[1-9][0-9]$/);
    expect(await wcagViolations(page)).toEqual([]);

    // The phone: signed in, scans the code, sees the computer, picks the number.
    const phone = await otherDevice(browser, baseURL ?? "", email, password);
    const phonePage = await phone.newPage();
    // The QR code carries the site's own origin; the test stack is reached under another name.
    const approval = new URL(approvalUrl);
    await phonePage.goto(`${approval.pathname}${approval.search}`);
    await expect(phonePage.getByRole("heading", { name: "Approve a sign-in" })).toBeVisible();
    await expect(phonePage.getByText("Chrome", { exact: false }).first()).toBeVisible();
    expect(await wcagViolations(phonePage)).toEqual([]);
    const choices = phonePage.getByRole("group", { name: "The number on the computer" });
    await expect(choices.getByRole("button")).toHaveCount(3);
    await choices.getByRole("button", { name: code, exact: true }).click();
    await expect(phonePage.getByText("Signed in on the computer")).toBeVisible();

    // The computer is in, with a shared-computer session.
    await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 });
    await expect(page.getByText("Shared-computer mode").first()).toBeVisible();
    await phone.close();
  });
});
