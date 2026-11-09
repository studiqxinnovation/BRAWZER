import { expect, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { makeAdministrator } from "./database";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "copper-meadow-signal";

test.describe("admin", () => {
  test("reads a reported page, opens its picture and closes it", async ({
    page,
    browser,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "The Admin page's report list is the same on phones; one run covers it.");
    const origin = new URL(baseURL ?? "").origin;

    // Someone reports a page, with a picture (a real JPEG, drawn here).
    const reporterEmail = uniqueEmail("reporter");
    const reporter = await browser.newContext({ baseURL });
    await createConfirmedAccount(reporter.request, baseURL ?? "", reporterEmail, PASSWORD);
    await signIn(reporter, baseURL ?? "", reporterEmail, PASSWORD);
    const drawing = await reporter.newPage();
    await drawing.goto("/");
    const picture = await drawing.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 200;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#e9b949";
        context.fillRect(0, 0, 320, 200);
      }
      return canvas.toDataURL("image/jpeg", 0.8).replace(/^data:image\/jpeg;base64,/, "");
    });
    const message = `The basket empties itself (${reporterEmail})`;
    const sent = await reporter.request.post("/api/v1/reports", {
      data: {
        kind: "broken",
        message,
        url: "https://shop.example/basket",
        title: "Basket",
        errorCode: null,
        sessionId: null,
        picture,
      },
      headers: { origin },
    });
    expect(sent.status()).toBe(201);
    await reporter.close();

    // An administrator sees it, with what was sent and nothing else.
    const adminEmail = uniqueEmail("admin");
    await createConfirmedAccount(page.request, baseURL ?? "", adminEmail, PASSWORD);
    await makeAdministrator(adminEmail);
    await signIn(page.context(), baseURL ?? "", adminEmail, PASSWORD);
    await page.goto("/app/admin");
    await expect(page.getByRole("heading", { name: "Reported pages" })).toBeVisible();
    const reports = page.getByRole("list", { name: "Open reports" });
    const item = reports.getByRole("listitem").filter({ hasText: message });
    await expect(item).toBeVisible({ timeout: 15_000 });
    await expect(item).toContainText(reporterEmail);
    await expect(item).toContainText("https://shop.example/basket");
    await expect(item).toContainText("Doesn’t work");

    await item.getByRole("button", { name: "Show the picture" }).click();
    await expect(item.getByRole("img", { name: `What ${reporterEmail} saw` })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // Closing deletes the picture; the report moves to Closed.
    await item.getByRole("button", { name: `Close ${reporterEmail}’s report` }).click();
    const confirm = page.getByRole("alertdialog", { name: "Close this report?" });
    await expect(confirm).toContainText("Its picture is deleted now.");
    await confirm.getByRole("button", { name: "Close report" }).click();
    await expect(page.getByText("Report closed")).toBeVisible();
    await expect(reports.getByText(message)).toHaveCount(0);
    await page.getByRole("button", { name: "Closed", exact: true }).click();
    const closed = page.getByRole("list", { name: "Closed reports" });
    const closedItem = closed.getByRole("listitem").filter({ hasText: message });
    await expect(closedItem).toBeVisible();
    await expect(closedItem.getByRole("button", { name: "Show the picture" })).toHaveCount(0);
  });
});
