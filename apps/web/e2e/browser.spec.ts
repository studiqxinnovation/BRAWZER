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
    await expect(page.getByText("Direct connection")).toBeVisible();
    await expect(page.getByText("Isolated")).toBeVisible();
    // Sound is on by default and mutes from the status bar.
    const sound = page.getByRole("button", { name: /^Sound on/ });
    await expect(sound).toHaveAttribute("aria-pressed", "true");
    await sound.click();
    await expect(page.getByRole("button", { name: "Sound off" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.getByRole("button", { name: "Sound off" }).click();
    await expect(sound).toBeVisible();

    // A bare host opens over HTTPS: the test site served inside the runtime.
    const address = page.getByRole("textbox", { name: "Address or search" });
    await address.fill("testsite.invalid");
    await address.press("Enter");
    await expect(tab(page, "Brawzer test site")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Not secure")).toBeHidden();

    // Plain HTTP is marked as such.
    await address.fill("http://testsite.invalid/");
    await address.press("Enter");
    await expect(page.getByLabel("Not secure")).toBeVisible();

    // A connection Brawzer refuses (a private address) gets Brawzer's own
    // error page, not the engine's, with the address kept and a way back.
    await address.fill("https://10.0.0.1/");
    await address.press("Enter");
    const failed = page.getByTestId("navigation-error");
    await expect(failed).toBeVisible({ timeout: 30_000 });
    await expect(failed).toHaveAttribute("data-error-kind", "blocked");
    await expect(
      failed.getByRole("heading", { name: "Brawzer didn’t allow this connection" }),
    ).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await failed.getByRole("button", { name: "Copy the address" }).click();
    await expect(page.getByText("Address copied")).toBeVisible();
    // A name nobody answers to, over HTTPS, is told apart from a refusal.
    await address.fill("https://no-such-host.example/");
    await address.press("Enter");
    await expect(failed).toHaveAttribute("data-error-kind", "unresolved", { timeout: 30_000 });
    await expect(failed.getByRole("button", { name: "Search for it" })).toBeVisible();
    await address.fill("http://testsite.invalid/");
    await address.press("Enter");
    await expect(failed).toBeHidden();
    await expect(tab(page, "Brawzer test site")).toBeVisible();

    // Find in page: Brawzer's bar, the engine's count.
    await clickPage(page, 400, 500);
    await page.keyboard.press("Alt+KeyF");
    const findBox = page.getByRole("textbox", { name: "Find in page" });
    await expect(findBox).toBeFocused();
    await findBox.fill("second");
    await expect(page.getByRole("search", { name: "Find in page" })).toContainText("1 of 1");
    expect(await wcagViolations(page)).toEqual([]);

    // Clipboard with intent: the selection goes to this computer only after a
    // confirmation (once per session), and a paste types into the page's field.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Copy selection to this computer" }).click();
    const copyDialog = page.getByRole("alertdialog", {
      name: "Copy to this computer’s clipboard?",
    });
    await expect(copyDialog).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await copyDialog.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(page.getByText("Copied to this computer")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Second");
    await findBox.press("Escape");
    await expect(findBox).toBeHidden();
    await clickPage(page, 100, 220);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Paste from this computer" }).click();
    await expect(page.getByText("Pasted into the page")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(tab(page, "Results for Second")).toBeVisible();
    await address.fill("http://testsite.invalid/");
    await address.press("Enter");
    await expect(tab(page, "Brawzer test site")).toBeVisible();

    // Zoom shows in the address bar and resets from there.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Zoom in" }).click();
    const zoomBadge = page.getByRole("button", { name: "Zoom 110%, reset" });
    await expect(zoomBadge).toBeVisible();
    await zoomBadge.click();
    await expect(zoomBadge).toBeHidden();

    // Reader view on an article, and back.
    await address.fill("http://testsite.invalid/article");
    await address.press("Enter");
    await expect(tab(page, "Aurora forecast")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Reader view" }).click();
    const readerBadge = page.getByRole("button", { name: "Reader" });
    await expect(readerBadge).toBeVisible({ timeout: 15_000 });
    expect(await wcagViolations(page)).toEqual([]);
    await readerBadge.click();
    await expect(readerBadge).toBeHidden({ timeout: 15_000 });
    await address.fill("http://testsite.invalid/");
    await address.press("Enter");
    await expect(tab(page, "Brawzer test site")).toBeVisible();

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

    // A download goes to Drive, scanned, and the person is told.
    await clickPage(page, 100, 300);
    await expect(page.getByText("“brawzer-test.bin” is in Drive")).toBeVisible({
      timeout: 30_000,
    });

    // So does the page itself, as a PDF, from Brawzer's menu.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Save page as PDF in Drive" }).click();
    await expect(page.getByText("“Brawzer test site.pdf” is in Drive")).toBeVisible({
      timeout: 30_000,
    });

    // The downloads panel lists both, scanned and saved.
    await page.getByRole("button", { name: /^Downloads/ }).click();
    const saved = page.getByRole("list", { name: "Files from this session" });
    await expect(saved).toContainText("brawzer-test.bin");
    await expect(saved).toContainText("Brawzer test site.pdf");
    await expect(saved.getByText("Scanned")).toHaveCount(2);
    expect(await wcagViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");

    // A screenshot, made from what this page shows, goes to Drive.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Save a screenshot in Drive" }).click();
    await expect(page.getByText("Screenshot saved in Drive")).toBeVisible({ timeout: 30_000 });

    // A report carries only what the person includes, and they see the picture before it goes.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Report a problem with this page" }).click();
    const reportDialog = page.getByRole("dialog", { name: "Report a problem with this page" });
    await expect(reportDialog.getByText("testsite.invalid")).toBeVisible();
    await reportDialog
      .getByRole("textbox", { name: "What went wrong?" })
      .fill("The second button does nothing.");
    await reportDialog.getByRole("checkbox", { name: /Attach a picture/ }).click();
    await expect(reportDialog.getByRole("img", { name: /What will be sent/ })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await reportDialog.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("Report sent")).toBeVisible();
    await expect(reportDialog).toBeHidden();

    // A website asking for a file is offered Drive, never this computer.
    await clickPage(page, 100, 380);
    const picker = page.getByRole("dialog", { name: "testsite.invalid asks for a file" });
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: "Downloads" }).click();
    await expect(picker.getByRole("list", { name: "Drive files" })).toContainText(
      "brawzer-test.bin",
    );
    expect(await wcagViolations(page)).toEqual([]);
    await picker.getByRole("button", { name: "Cancel" }).click();
    await expect(picker).toBeHidden();

    // Its own window: the pop-out takes the stream, this page says so and can take it back.
    const popupOpened = page.waitForEvent("popup");
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Open in its own window" }).click();
    const popup = await popupOpened;
    const popupViewport = popup.getByTestId("browser-viewport");
    await expect(popupViewport).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => popupViewport.getAttribute("data-frames"), { timeout: 30_000 })
      .not.toBe("0");
    await expect(page.getByText("This session is open in another window")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Bring it back here" }).click();
    await expect(viewport).toBeVisible({ timeout: 30_000 });
    await expect(popup.getByText("This session is open in another window")).toBeVisible();
    await popup.close();

    // Tabs.
    await page.getByRole("button", { name: "New tab" }).click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await tab(page, "New tab").getByTestId("tab-close").click();
    await expect(page.getByRole("tab")).toHaveCount(1);

    // Ending destroys the session.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "End session" }).click();
    const confirm = page.getByRole("alertdialog", { name: "End this browser session?" });
    await confirm.getByRole("button", { name: "End session" }).click();
    await expect(page.getByText("You ended this browser session.")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // Drive holds both files, marked as the cloud browser's.
    await page.goto("/app/drive");
    await page.getByRole("link", { name: "Downloads" }).click();
    await expect(page.getByText("brawzer-test.bin")).toBeVisible();
    await expect(page.getByText("Brawzer test site.pdf")).toBeVisible();
    await expect(page.getByText("From the cloud browser")).toHaveCount(2);

    const history = await page.request.get("/api/v1/security/events");
    const { events } = (await history.json()) as { events: { type: string }[] };
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "browser.session_started",
        "browser.session_ended",
        "browser.clipboard_copied",
        "browser.clipboard_pasted",
        "browser.page_reported",
      ]),
    );
  });

  test("the start panel explains what the cloud browser does and doesn't do yet", async ({
    page,
    baseURL,
  }) => {
    await signedIn(page, baseURL, "browser-start");
    await expect(page.getByRole("button", { name: "Start browsing" })).toBeVisible();
    // The panel says where websites will see the session from.
    await expect(
      page.getByText("Websites see Brawzer’s cloud; the profile has no proxy."),
    ).toBeVisible();
    // The default profile keeps its data; a temporary session is offered too.
    await expect(page.getByText(/Cookies, history and site data are saved to/)).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
  });
});
