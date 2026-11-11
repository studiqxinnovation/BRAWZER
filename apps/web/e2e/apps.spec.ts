import { expect, type Page, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { createConfirmedAccount, GREETING, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "violet-harbor-lantern";

/** Opens an app from Launchpad and returns its window. */
async function openApp(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Dock" })
    .getByRole("button", { name: "Launchpad" })
    .click();
  const launchpad = page.getByRole("dialog", { name: "Launchpad" });
  await launchpad.getByRole("searchbox").fill(name);
  await launchpad.getByRole("button", { name, exact: true }).click();
  const window = page.getByRole("region", { name: `${name} window` });
  await expect(window).toBeVisible();
  return window;
}

async function driveFiles(page: Page): Promise<string[]> {
  const listed = (await (await page.request.get("/api/v1/drive/files?q=.")).json()) as {
    files: { name: string }[];
  };
  return listed.files.map((file) => file.name);
}

test.describe("desktop apps", () => {
  test.skip(({ isMobile }) => isMobile, "The apps are the desktop's.");

  test.beforeEach(async ({ page, baseURL }, info) => {
    const email = uniqueEmail(`apps-${String(info.parallelIndex)}`);
    await page.addInitScript(() => {
      sessionStorage.setItem("brawzer:notices-seen", String(Date.now() + 60_000));
      if (!sessionStorage.getItem("brawzer:desktop-style")) {
        sessionStorage.setItem("brawzer:desktop-style", "mac");
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
    await signIn(page.context(), baseURL ?? "", email, PASSWORD);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();
  });

  test("Assignments and Citations keep what's added with the account", async ({ page }) => {
    const assignments = await openApp(page, "Assignments");
    await assignments.getByLabel("Assignment", { exact: true }).fill("Essay on memory");
    await assignments.getByLabel("Module").fill("PSY101");
    const due = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await assignments
      .getByLabel("Due")
      .fill(
        `${String(due.getFullYear())}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`,
      );
    await assignments.getByRole("button", { name: "Add" }).click();
    await expect(assignments.getByRole("region", { name: "This week" })).toContainText(
      "Due in 3 days",
    );
    await expect(assignments.getByRole("status")).toHaveText("Saved with your account");
    expect(await wcagViolations(page)).toEqual([]);

    const citations = await openApp(page, "Citations");
    await citations.getByRole("radio", { name: "Book" }).click();
    await citations.getByLabel("Authors").fill("Smith, Jane");
    await citations.getByLabel("Title").fill("Learning to learn");
    await citations.getByLabel("Publisher").fill("Oxford University Press");
    await citations.getByLabel("Year").fill("2021");
    await expect(
      citations.getByText("Smith, J. (2021) Learning to learn. Oxford University Press."),
    ).toBeVisible();
    await citations.getByRole("button", { name: "Add to list" }).click();
    await citations.getByRole("radio", { name: "APA 7" }).click();
    await expect(citations.getByRole("region", { name: /Reference list/ })).toContainText(
      "Smith, J. (2021). Learning to learn. Oxford University Press.",
    );
    await expect(citations.getByRole("status")).toHaveText("Saved with your account");
    expect(await wcagViolations(page)).toEqual([]);

    // A reload brings both back, from the account.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();
    const again = await openApp(page, "Assignments");
    await expect(again).toContainText("Essay on memory");
    await expect(await openApp(page, "Citations")).toContainText("Learning to learn");
  });

  test("Money adds up a month and Invoices saves a PDF to Drive", async ({ page }) => {
    const money = await openApp(page, "Money");
    for (const [kind, amount, category] of [
      ["Income", "1250.50", "Sales"],
      ["Expense", "40.10", "Stock"],
      ["Expense", "9.90", "Stock"],
    ] as const) {
      await money.getByRole("radio", { name: kind }).click();
      await money.getByLabel(/^Amount/).fill(amount);
      await money.getByLabel("Category").fill(category);
      await money.getByRole("button", { name: "Add", exact: true }).click();
    }
    const glance = money.getByRole("group", { name: /at a glance/ });
    await expect(glance).toContainText("£1,250.50");
    await expect(glance).toContainText("£50.00");
    await expect(glance).toContainText("£1,200.50");
    await money.getByRole("button", { name: "Save month to Drive (CSV)" }).click();
    await expect(page.getByText("Saved in Drive")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    const invoices = await openApp(page, "Invoices");
    await invoices.getByRole("button", { name: "Your business" }).click();
    await invoices.getByLabel("Business name").fill("Bright Tutors");
    await invoices.getByRole("button", { name: "Invoice", exact: true }).click();
    await invoices.getByLabel("Client", { exact: true }).fill("Ada Lovelace");
    await invoices.getByLabel("Item 1 description").fill("Maths tutoring, 4 hours");
    await invoices.getByLabel("Item 1 quantity").fill("4");
    await invoices.getByLabel("Item 1 unit price").fill("30");
    await expect(invoices.getByRole("definition").last()).toHaveText("£120.00");
    expect(await wcagViolations(page)).toEqual([]);
    await invoices.getByRole("button", { name: "Save PDF to Drive" }).click();
    await expect(page.getByText("PDF saved in Drive")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => driveFiles(page))
      .toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^Money \d{4}-\d{2}\.csv$/),
          "INV-0001 Ada Lovelace.pdf",
        ]),
      );
  });

  test("Focus Timer runs, and Exam Mode keeps to the apps chosen until the password ends it", async ({
    page,
  }) => {
    const focus = await openApp(page, "Focus Timer");
    await expect(focus.getByRole("timer", { name: "Time left" })).toHaveText("25:00");
    await focus.getByRole("button", { name: "Start" }).click();
    await expect(focus.getByRole("timer", { name: "Time left" })).not.toHaveText("25:00");
    await focus.getByRole("button", { name: "Pause" }).click();
    await expect(focus.getByRole("button", { name: "Resume" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    const exam = await openApp(page, "Exam Mode");
    await exam.getByRole("checkbox", { name: "Calculator" }).check();
    await exam.getByRole("checkbox", { name: "Money" }).uncheck();
    await exam.getByRole("checkbox", { name: "Focus Timer" }).uncheck();
    await exam.getByRole("button", { name: "Start Exam Mode" }).click();
    await expect(exam).toContainText("Exam Mode is on");
    await expect(page.getByRole("button", { name: /^Exam Mode · \d+ min left$/ })).toBeVisible();
    // The focus timer wasn't chosen: it's tucked away, and Money won't open.
    await expect(focus).toBeHidden();
    await page
      .getByRole("navigation", { name: "Dock" })
      .getByRole("button", { name: "Launchpad" })
      .click();
    await page
      .getByRole("dialog", { name: "Launchpad" })
      .getByRole("button", { name: "Money" })
      .click();
    await expect(page.getByText("Not during Exam Mode")).toBeVisible();
    await expect(page.getByRole("region", { name: "Money window" })).toHaveCount(0);
    expect(await wcagViolations(page)).toEqual([]);

    // A reload keeps to it; ending it early takes the password.
    await page.reload();
    await expect(page.getByRole("button", { name: /^Exam Mode · \d+ min left$/ })).toBeVisible();
    await page.getByRole("button", { name: /^Exam Mode · / }).click();
    const again = page.getByRole("region", { name: "Exam Mode window" });
    await again.getByRole("button", { name: "End early…" }).click();
    await again.getByLabel("Your password, to end it early").fill(PASSWORD);
    await again.getByRole("button", { name: "End Exam Mode" }).click();
    await expect(page.getByRole("button", { name: /^Exam Mode · / })).toHaveCount(0);
    await expect(await openApp(page, "Money")).toBeVisible();
  });
});
