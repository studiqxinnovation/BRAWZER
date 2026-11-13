import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { expireIdentityConfirmation } from "./database";
import { createConfirmedAccount, emailText, linkFromEmail, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "violet-harbor-lantern";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";

async function signedIn(page: Page, baseURL: string | undefined, tag: string): Promise<string> {
  const email = uniqueEmail(tag);
  await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
  await signIn(page.context(), baseURL ?? "", email, PASSWORD);
  return email;
}

/** Controls do nothing until the page has hydrated; the session keeper marks that. */
async function interactive(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-session-keeper", /.+/);
}

test.describe("account controls", () => {
  test("change the email address through a link sent to the new one", async ({ page, baseURL }) => {
    const email = await signedIn(page, baseURL, "change-email");
    const newEmail = uniqueEmail("changed");
    await page.goto("/app/account");
    await interactive(page);

    await page.getByRole("button", { name: "Change email address" }).click();
    const dialog = page.getByRole("dialog", { name: "Change your email address" });
    await dialog.getByRole("textbox", { name: "New email address" }).fill(email);
    await dialog.getByRole("button", { name: "Send link" }).click();
    await expect(dialog.getByText("That’s already your email address.")).toBeVisible();
    await dialog.getByRole("textbox", { name: "New email address" }).fill(newEmail);
    await dialog.getByRole("button", { name: "Send link" }).click();
    await expect(page.getByRole("dialog", { name: "Check your new inbox" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await emailText(page.request, email, "Your Brawzer email address may change");

    const link = await linkFromEmail(
      page.request,
      newEmail,
      "Confirm your new email address",
      baseURL ?? "",
    );
    await page.goto(link);
    // Only shown once the page has read the link in the browser.
    const confirm = page.getByRole("button", { name: "Confirm new email address" });
    await expect(confirm).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    expect(await wcagViolations(page)).toEqual([]);
    await confirm.click();
    await expect(
      page.getByRole("heading", { name: "Your email address was changed" }),
    ).toBeVisible();
    await expect(page.getByText(newEmail)).toBeVisible();
    await emailText(page.request, email, "Your Brawzer email address was changed");

    await page.getByRole("link", { name: "Go to your account" }).click();
    await expect(page).toHaveURL(/\/app\/account$/);
    await expect(page.getByRole("main").getByText(newEmail, { exact: true })).toBeVisible();

    // Each link works once.
    await page.goto(link);
    await page.getByRole("button", { name: "Confirm new email address" }).click();
    await expect(
      page.getByRole("heading", { name: "This link has expired or has already been used" }),
    ).toBeVisible();
  });

  test("download your data, with a warning on a shared computer", async ({ page, baseURL }) => {
    const email = await signedIn(page, baseURL, "export");
    await page.goto("/app/account");
    await interactive(page);
    await expect(page.getByText("You’re on a shared computer")).toBeVisible();

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download your data" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^brawzer-account-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(await readFile(await download.path(), "utf8")) as {
      account: { email: string };
      securityHistory: { type: string }[];
    };
    expect(data.account.email).toBe(email);
    expect(data.securityHistory.map((event) => event.type)).toContain("account.created");
  });

  test("delete the account after typing the address and confirming it’s you", async ({
    page,
    baseURL,
  }) => {
    const email = await signedIn(page, baseURL, "delete");
    await page.goto("/app/account");
    await interactive(page);

    await page.getByRole("button", { name: "Delete account…" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete your Brawzer account?" });
    const typed = dialog.getByRole("textbox", { name: /to confirm/ });
    await typed.fill("someone@example.com");
    await dialog.getByRole("button", { name: "Delete account", exact: true }).click();
    await expect(dialog.getByText("Type your email address exactly as it is shown.")).toBeVisible();

    await expireIdentityConfirmation(email);
    await typed.fill(email);
    await dialog.getByRole("button", { name: "Delete account", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Confirm it’s you" });
    await confirm.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await confirm.getByRole("button", { name: "Confirm", exact: true }).click();

    await expect(page).toHaveURL(/\/sign-in\?signed_out=deleted$/);
    await expect(page.getByText("Your account was deleted")).toBeVisible();
    await emailText(page.request, email, "Your Brawzer account was deleted");

    // The passkey button is added once the page is interactive.
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  });
});

test.describe("Shield", () => {
  test("recommends protection and flags a sign-in from a new device", async ({
    page,
    browser,
    baseURL,
  }) => {
    const email = await signedIn(page, baseURL, "shield-alerts");
    const phone = await browser.newContext({ baseURL, userAgent: IPHONE_SAFARI });
    await signIn(phone, baseURL ?? "", email, PASSWORD);
    await phone.close();
    const notice = await emailText(page.request, email, "New sign-in to your Brawzer account");
    expect(notice).toContain("Safari on iOS");

    await page.goto("/app/shield");
    const recommendations = page.getByRole("list", { name: "Recommendations" });
    await expect(recommendations.getByRole("link", { name: "Add a passkey" })).toBeVisible();
    await expect(recommendations.getByRole("link", { name: "Set up two-factor" })).toBeVisible();
    const alerts = page.getByRole("list", { name: "Sign-ins from new devices" });
    await expect(alerts.getByText("New sign-in from Safari on iOS")).toBeVisible();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await wcagViolations(page), colorScheme).toEqual([]);
    }

    await alerts.getByRole("link", { name: "This wasn’t me" }).click();
    await expect(page).toHaveURL(/\/app\/sessions$/);
    await expect(page.getByText("Safari on iOS").first()).toBeVisible();
  });
});

test.describe("undoing an email change", () => {
  test("the old address restores itself with a new password", async ({ page, baseURL }) => {
    const email = await signedIn(page, baseURL, "undo-email");
    const newEmail = uniqueEmail("undo-new");
    const origin = new URL(baseURL ?? "").origin;
    // The change itself, as the account-controls test covers it in the browser.
    expect(
      (
        await page.request.post("/api/v1/account/email", {
          data: { email: newEmail },
          headers: { origin },
        })
      ).status(),
    ).toBe(202);
    const confirmLink = await linkFromEmail(
      page.request,
      newEmail,
      "Confirm your new email address",
      baseURL ?? "",
    );
    const confirmToken = new URL(confirmLink).hash.replace("#token=", "");
    expect(
      (
        await page.request.post("/api/v1/account/email/confirm", {
          data: { token: confirmToken },
          headers: { origin },
        })
      ).status(),
    ).toBe(200);

    const undoLink = await linkFromEmail(
      page.request,
      email,
      "Your Brawzer email address was changed",
      baseURL ?? "",
    );
    await page.goto(undoLink);
    await expect(page.getByRole("heading", { name: "Undo an email change" })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    expect(await wcagViolations(page)).toEqual([]);

    const password = page.getByLabel("New password", { exact: true });
    await password.fill("password1234");
    await page.getByRole("button", { name: "Restore my address and set this password" }).click();
    await expect(
      page.getByText("That password is too common. Choose something harder to guess."),
    ).toBeVisible();
    await password.fill("copper-meadow-whistle");
    await page.getByRole("button", { name: "Restore my address and set this password" }).click();
    await expect(
      page.getByRole("heading", { name: "Your email address was restored" }),
    ).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    // The session that made the change is gone.
    expect((await page.request.get("/api/v1/auth/session/status")).status()).toBe(401);

    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill("copper-meadow-whistle");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
  });
});
