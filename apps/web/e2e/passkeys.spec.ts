import { expect, type Page, test } from "@playwright/test";
import { expireIdentityConfirmation } from "./database";
import { createConfirmedAccount, expectSignedInAs, signOut, uniqueEmail } from "./mailbox";

// Passkeys need a domain name: they never work on an IP address such as the
// 127.0.0.1 the other tests use, so these tests browse localhost.
const SITE = "http://localhost:3100";
const PASSWORD = "violet-harbor-lantern";

/** Chromium's virtual authenticator: "internal" is built into the device, "usb" is a security key. */
async function virtualAuthenticator(page: Page, transport: "internal" | "usb") {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function signInWithPassword(page: Page, email: string, keepSignedIn: boolean) {
  await page.goto(`${SITE}/sign-in`);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  if (keepSignedIn)
    await page.getByRole("checkbox", { name: "Keep me signed in on this device" }).check();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function addPasskey(page: Page) {
  await page.goto(`${SITE}/app/account`);
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByText("Passkey added")).toBeVisible();
  await expect(page.getByText(/^Passkey on /)).toBeVisible();
}

test.describe("passkeys", () => {
  test("add a passkey on your own device, then sign in with only the passkey", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("passkey");
    await createConfirmedAccount(request, SITE, email, PASSWORD);
    await virtualAuthenticator(page, "internal");
    await signInWithPassword(page, email, true);
    await addPasskey(page);

    await signOut(page);

    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expectSignedInAs(page, email);

    await page.goto(`${SITE}/app/sessions`);
    await expect(page.getByText("Signed in with a passkey")).toBeVisible();
  });

  test("on a shared computer, a passkey can only go on a phone or security key", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("passkey-shared");
    await createConfirmedAccount(request, SITE, email, PASSWORD);
    await virtualAuthenticator(page, "usb");
    await signInWithPassword(page, email, false);

    await page.goto(`${SITE}/app/account`);
    // Scoped to the page: while it streams in, a copy waits in a hidden template.
    await expect(
      page.locator("#main-content").getByText(/only be saved on your phone or a security key/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await expect(page.getByText("Passkey added")).toBeVisible();
  });

  test("confirm it's you with a passkey before removing one", async ({ page, request }) => {
    const email = uniqueEmail("passkey-confirm");
    await createConfirmedAccount(request, SITE, email, PASSWORD);
    await virtualAuthenticator(page, "internal");
    await signInWithPassword(page, email, true);
    await addPasskey(page);
    await expireIdentityConfirmation(email);

    await page.reload();
    // The page works once its scripts run; the session keeper marks that.
    await expect(page.locator("html")).toHaveAttribute("data-session-keeper", /.+/);
    await page.getByRole("button", { name: /^Remove Passkey on / }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove passkey" }).click();
    const confirm = page.getByRole("dialog", { name: "Confirm it’s you" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Use a passkey instead" }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByText("No passkeys yet.")).toBeVisible();
  });
});
