import { expect, type Page, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";
import { startSocksProxy } from "./socks-proxy";

const PASSWORD = "violet-harbor-lantern";
const PROXY_AUTH = { username: "e2e-user", password: "s0cks-secret-pass" };

async function interactive(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-session-keeper", /.+/);
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

// Needs the local API to allow private addresses in proxy tests
// (PROXY_TEST_ALLOW_PRIVATE=true in .env), because the proxy runs here.
test.describe("proxies", () => {
  test("add, test, fix, assign and delete a proxy", async ({ page, baseURL }) => {
    const proxy = await startSocksProxy(PROXY_AUTH);
    try {
      const email = uniqueEmail("proxies");
      await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
      await signIn(page.context(), baseURL ?? "", email, PASSWORD);

      await page.goto("/app/proxy");
      await interactive(page);
      await expect(page.getByText("No proxies yet")).toBeVisible();

      // Add.
      await page.getByRole("button", { name: "Add proxy" }).click();
      const add = page.getByRole("dialog", { name: "Add a proxy" });
      await add.getByRole("textbox", { name: "Name", exact: true }).fill("Local SOCKS");
      await add.getByRole("textbox", { name: "Host", exact: true }).fill("127.0.0.1");
      await add.getByRole("textbox", { name: "Port", exact: true }).fill(String(proxy.port));
      await add.getByRole("textbox", { name: "Username" }).fill(PROXY_AUTH.username);
      await add.getByLabel("Password", { exact: true }).fill(PROXY_AUTH.password);
      expect(await wcagViolations(page)).toEqual([]);
      await add.getByRole("button", { name: "Add proxy" }).click();
      await expect(add).toBeHidden();

      const card = page.getByRole("list", { name: "Your proxies" }).getByRole("listitem");
      await expect(card.getByText(`SOCKS5 · 127.0.0.1:${String(proxy.port)}`)).toBeVisible();
      await expect(card.getByText("Password saved")).toBeVisible();
      await expect(card.getByText("Not tested yet.")).toBeVisible();
      // The password never comes back to the page.
      expect(await page.content()).not.toContain(PROXY_AUTH.password);

      // Test.
      await card.getByRole("button", { name: "Test Local SOCKS" }).click();
      await expect(card.getByText("websites see 127.0.0.1")).toBeVisible();

      // A wrong password: replacing it starts from empty fields.
      await card.getByRole("button", { name: "Edit Local SOCKS" }).click();
      const edit = page.getByRole("dialog", { name: "Edit “Local SOCKS”" });
      await expect(edit.getByRole("radio", { name: "Keep them" })).toBeChecked();
      await expect(edit.getByLabel("Password", { exact: true })).toHaveCount(0);
      await edit.getByRole("radio", { name: "Replace them" }).check();
      await expect(edit.getByLabel("Password", { exact: true })).toHaveValue("");
      await edit.getByRole("textbox", { name: "Username" }).fill(PROXY_AUTH.username);
      await edit.getByLabel("Password", { exact: true }).fill("not-the-password");
      await edit.getByRole("button", { name: "Save" }).click();
      await expect(edit).toBeHidden();
      await expect(card.getByText("Not tested yet.")).toBeVisible();
      await card.getByRole("button", { name: "Test Local SOCKS" }).click();
      await expect(
        card.getByText("The proxy didn’t accept the username or password."),
      ).toBeVisible();

      // Assign it to a profile.
      await page.goto("/app/profiles");
      await interactive(page);
      await page.getByRole("button", { name: "Edit Personal" }).click();
      const profile = page.getByRole("dialog", { name: "Edit “Personal”" });
      await choose(page, "Proxy", "Local SOCKS");
      await profile.getByRole("button", { name: "Save" }).click();
      await expect(profile).toBeHidden();
      await expect(page.getByText("Proxy: Local SOCKS")).toBeVisible();

      await page.goto("/app/proxy");
      await interactive(page);
      await expect(page.getByText("Used by Personal")).toBeVisible();

      // Delete: the profile goes back to no proxy.
      await page.getByRole("button", { name: "Delete Local SOCKS" }).click();
      await page
        .getByRole("alertdialog", { name: "Delete “Local SOCKS”?" })
        .getByRole("button", { name: "Delete proxy" })
        .click();
      await expect(page.getByText("No proxies yet")).toBeVisible();
      await page.goto("/app/profiles");
      await expect(page.getByRole("list", { name: "Your profiles" })).toBeVisible();
      await expect(page.getByText("Proxy: Local SOCKS")).toHaveCount(0);
    } finally {
      await proxy.close();
    }
  });
});
