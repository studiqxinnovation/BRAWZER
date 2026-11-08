import { expect, type Page, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "violet-harbor-lantern";

// Requires the Docker engine and the runtime image (`pnpm runtime:build`),
// with BROWSER_TEST_SITE=true in the API's environment (the default .env).
async function signedIn(page: Page, baseURL: string | undefined, tag: string): Promise<string> {
  const email = uniqueEmail(tag);
  await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
  await signIn(page.context(), baseURL ?? "", email, PASSWORD);
  await page.goto("/app/browser");
  await expect(page.locator("html")).toHaveAttribute("data-session-keeper", /.+/);
  return email;
}

/**
 * Clicks a point of the streamed page (page coordinates map 1:1 onto the
 * canvas). Locator clicks wait until nothing else, such as a closing dialog's
 * backdrop, is in front of the canvas.
 */
async function clickPage(page: Page, x: number, y: number) {
  await page.getByTestId("browser-viewport").locator("canvas").click({ position: { x, y } });
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

test.describe("browser", () => {
  test("starts a cloud browser, browses the test site and ends the session", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(
      isMobile,
      "The streamed page is driven with a mouse; phones get the start panel test.",
    );
    test.setTimeout(120_000);
    await signedIn(page, baseURL, "browser");
    await expect(page.getByRole("heading", { name: "Browser" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    await page.getByRole("button", { name: "Start browsing" }).click();
    const viewport = page.getByTestId("browser-viewport");
    await expect(viewport).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(() => viewport.getAttribute("data-frames"), { timeout: 30_000 })
      .not.toBe("0");
    expect(await wcagViolations(page)).toEqual([]);

    // The address bar opens the test site served inside the runtime.
    const address = page.getByRole("textbox", { name: "Address or search" });
    await address.fill("http://testsite.invalid/");
    await address.press("Enter");
    await expect(tab(page, "Brawzer test site")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Not secure")).toBeVisible();

    // A click inside the page follows a link; Back returns.
    await clickPage(page, 100, 60);
    await expect(tab(page, "Second page")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(tab(page, "Brawzer test site")).toBeVisible();
    await expect(page.getByRole("button", { name: "Forward" })).toBeEnabled();

    // Typing goes to the page: the search form submits with Enter.
    await clickPage(page, 100, 220);
    await page.keyboard.type("hello");
    await page.keyboard.press("Enter");
    await expect(tab(page, "Results for hello")).toBeVisible();

    // A page dialog is drawn by Brawzer, named after the page's host.
    await address.fill("http://testsite.invalid/");
    await address.press("Enter");
    await expect(tab(page, "Brawzer test site")).toBeVisible();
    await clickPage(page, 100, 140);
    const dialog = page.getByRole("dialog", { name: "testsite.invalid says" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Hello from the test site")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(dialog).toBeHidden();

    // Downloads are refused and explained.
    await clickPage(page, 100, 300);
    await expect(page.getByText("Download refused")).toBeVisible();

    // Tabs.
    await page.getByRole("button", { name: "New tab" }).click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await tab(page, "New tab").getByTestId("tab-close").click();
    await expect(page.getByRole("tab")).toHaveCount(1);

    // Ending destroys the session.
    await page.getByRole("button", { name: "End session" }).click();
    const confirm = page.getByRole("alertdialog", { name: "End this browser session?" });
    await confirm.getByRole("button", { name: "End session" }).click();
    await expect(page.getByText("You ended this browser session.")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    const history = await page.request.get("/api/v1/security/events");
    const { events } = (await history.json()) as { events: { type: string }[] };
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["browser.session_started", "browser.session_ended"]),
    );
  });

  test("the start panel explains what the cloud browser does and doesn't do yet", async ({
    page,
    baseURL,
  }) => {
    await signedIn(page, baseURL, "browser-start");
    await expect(page.getByRole("button", { name: "Start browsing" })).toBeVisible();
    await expect(page.getByRole("note", { name: /Development state/ })).toContainText(
      "Downloads saved to Drive",
    );
    expect(await wcagViolations(page)).toEqual([]);
  });
});
