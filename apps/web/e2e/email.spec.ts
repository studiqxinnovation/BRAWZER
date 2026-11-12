import { expect, test } from "@playwright/test";
import { createConfirmedAccount, emailText, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "violet-harbor-lantern";

test.describe("email", () => {
  test("a new account is welcomed, chooses its optional emails, and a footer link without a token can't be used", async ({
    page,
    baseURL,
  }) => {
    const email = uniqueEmail("email");
    await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
    // The welcome arrives once the address is confirmed.
    const welcome = await emailText(page.request, email, "Welcome to Brawzer");
    expect(welcome).toContain("never sees your passwords");

    await signIn(page.context(), baseURL ?? "", email, PASSWORD);
    await page.addInitScript(() => {
      sessionStorage.setItem("brawzer:desktop", "off");
    });
    await page.goto("/app/account");
    await expect(page.locator("html")).toHaveAttribute("data-session-keeper", /.+/);
    const settings = page.getByTestId("email-preferences");
    const usage = settings.getByRole("switch", { name: /Usage notices/ });
    await expect(usage).toHaveAttribute("aria-checked", "true");
    await usage.click();
    await expect(usage).toHaveAttribute("aria-checked", "false");
    // Kept with the account: a reload shows the same choice.
    await page.reload();
    await expect(settings.getByRole("switch", { name: /Usage notices/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(settings.getByRole("switch", { name: /Team updates/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(settings).toContainText("always sent");

    // The footer page needs its token; without one it says so and offers the account instead.
    await page.goto("/unsubscribe");
    await expect(page.getByRole("heading", { name: "This link can’t be used" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });
});
