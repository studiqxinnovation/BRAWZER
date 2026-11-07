import { expect, type Page, test } from "@playwright/test";
import { createConfirmedAccount, signIn, signOut, uniqueEmail } from "./mailbox";
import { totp } from "./totp";

const PASSWORD = "violet-harbor-lantern";

async function passwordSignIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("One more step")).toBeVisible();
}

test.describe("two-factor authentication", () => {
  test("turn on, sign in with a code or a recovery code, turn off", async ({ page, baseURL }) => {
    const email = uniqueEmail("totp");
    await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
    await signIn(page.context(), baseURL ?? "", email, PASSWORD);

    await page.goto("/app/account");
    await page.getByRole("button", { name: "Turn on two-factor authentication" }).click();
    await expect(
      page.getByRole("img", { name: "QR code for your authenticator app" }),
    ).toBeVisible();
    const secret = ((await page.getByTestId("totp-key").textContent()) ?? "").replace(/\s/g, "");
    await page.getByRole("textbox", { name: "Authentication code" }).fill("000000");
    await page.getByRole("button", { name: "Turn on", exact: true }).click();
    await expect(page.getByText("That code isn’t right.")).toBeVisible();

    await page.getByRole("textbox", { name: "Authentication code" }).fill(totp(secret));
    await page.getByRole("button", { name: "Turn on", exact: true }).click();
    const codes = page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem");
    await expect(codes).toHaveCount(10);
    const recoveryCode = (await codes.first().textContent()) ?? "";
    await page.getByRole("button", { name: "I’ve saved my codes" }).click();
    await expect(page.getByText("10 recovery codes left")).toBeVisible();

    // Sign in again: the password alone isn't enough any more.
    await signOut(page);
    await passwordSignIn(page, email);
    await page.getByRole("textbox", { name: "Authentication code" }).fill("123456");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText(/That code isn’t right/)).toBeVisible();
    await page.getByRole("textbox", { name: "Authentication code" }).fill(totp(secret, 1));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/app$/);

    await signOut(page);
    await passwordSignIn(page, email);
    await page.getByRole("button", { name: "Use a recovery code instead" }).click();
    await page.getByRole("textbox", { name: "Recovery code" }).fill(recoveryCode);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/app$/);

    await page.goto("/app/account");
    await expect(page.getByText("9 recovery codes left")).toBeVisible();
    await page.getByRole("button", { name: "Turn off" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Turn off" }).click();
    await expect(page.getByText("Two-factor authentication is off")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Turn on two-factor authentication" }),
    ).toBeVisible();
  });
});
