import { expect, type Page, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { createConfirmedAccount, GREETING, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "violet-harbor-lantern";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

async function openApp(page: Page, name: string) {
  // Trash lives in the Dock, as on the prototype, not in Launchpad.
  if (name === "Trash") {
    await page
      .getByRole("navigation", { name: "Dock" })
      .getByRole("button", { name: /^Trash/ })
      .click();
    const trash = page.getByRole("region", { name: "Trash window" });
    await expect(trash).toBeVisible();
    return trash;
  }
  await page
    .getByRole("navigation", { name: "Dock" })
    .getByRole("button", { name: "Launchpad" })
    .click();
  const launchpad = page.getByRole("dialog", { name: "Launchpad" });
  await launchpad.getByRole("searchbox").fill(name);
  await launchpad.getByRole("button", { name, exact: true }).click();
  const window = page.getByRole("region", { name: `${name} window` }).last();
  await expect(window).toBeVisible();
  return window;
}

async function driveNames(page: Page): Promise<string[]> {
  const listed = (await (await page.request.get("/api/v1/drive/files?q=.")).json()) as {
    files: { name: string }[];
  };
  return listed.files.map((file) => file.name).sort();
}

async function upload(page: Page, baseURL: string, name: string, buffer: Buffer, mimeType: string) {
  const response = await page.request.post("/api/v1/drive/files", {
    headers: { origin: baseURL },
    multipart: { file: { name, mimeType, buffer } },
  });
  expect(response.status()).toBe(201);
}

test.describe("Drive's apps", () => {
  test.skip(({ isMobile }) => isMobile, "The apps are the desktop's.");

  test.beforeEach(async ({ page, baseURL }, info) => {
    const email = uniqueEmail(`drive-apps-${String(info.parallelIndex)}`);
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

  test("Notepad saves to Drive, Files opens it again, and saving again keeps one file", async ({
    page,
  }) => {
    const notepad = await openApp(page, "Notepad");
    await notepad.getByLabel("File name").fill("shopping.txt");
    await notepad.getByRole("textbox", { name: "Text" }).fill("Milk\nBread");
    await notepad.getByRole("button", { name: "Save to Drive" }).click();
    await expect(page.getByText("Saved “shopping.txt” in Drive")).toBeVisible();
    await expect.poll(() => driveNames(page)).toEqual(["shopping.txt"]);
    await notepad.getByRole("button", { name: "Close Notepad" }).click();

    // Files shows the Notes folder; opening the file brings it back in Notepad.
    const files = await openApp(page, "Files");
    await files.getByRole("button", { name: "Notes, folder" }).dblclick();
    await files.getByRole("button", { name: /^shopping\.txt/ }).dblclick();
    const again = page.getByRole("region", { name: "Notepad window" });
    await expect(again.getByRole("textbox", { name: "Text" })).toHaveValue("Milk\nBread");
    await again.getByRole("textbox", { name: "Text" }).press("End");
    await again.getByRole("textbox", { name: "Text" }).pressSequentially("\nEggs");
    await again.getByRole("button", { name: "Save to Drive" }).click();
    await expect(page.getByText("Saved “shopping.txt” in Drive")).toBeVisible();
    await expect.poll(() => driveNames(page)).toEqual(["shopping.txt"]);
    expect(await wcagViolations(page)).toEqual([]);
  });

  test("Writer starts from a template, and Calc works out and saves a sheet", async ({ page }) => {
    const templates = await openApp(page, "Templates");
    await templates.getByRole("button", { name: /Business plan/ }).click();
    const writer = page.getByRole("region", { name: "Writer window" });
    await expect(writer.getByRole("textbox", { name: "Document", exact: true })).toContainText(
      "Customers and market",
    );
    await writer.getByRole("button", { name: "Save to Drive" }).click();
    await expect(page.getByText("Saved “Business plan.html” in Drive")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    const calc = await openApp(page, "Calc");
    await calc.getByLabel("A1", { exact: true }).fill("12");
    await calc.getByLabel("A2", { exact: true }).fill("30");
    await calc.getByLabel("A3", { exact: true }).fill("=SUM(A1:A2)*2");
    await calc.getByLabel("B1", { exact: true }).click();
    await expect(calc.getByLabel("A3", { exact: true })).toHaveValue("84");
    await calc.getByLabel("Sheet name").fill("Totals.csv");
    await calc.getByRole("button", { name: "Save to Drive" }).click();
    await expect(page.getByText("Saved “Totals.csv” in Drive")).toBeVisible();
    await expect.poll(() => driveNames(page)).toEqual(["Business plan.html", "Totals.csv"]);
    const csv = await (
      await page.request.get(
        `/api/v1/drive/files/${((await (await page.request.get("/api/v1/drive/files?q=Totals")).json()) as { files: { id: string }[] }).files[0]?.id ?? ""}/preview`,
      )
    ).text();
    expect(csv).toBe("12\r\n30\r\n=SUM(A1:A2)*2");
    expect(await wcagViolations(page)).toEqual([]);
  });

  test("Slides starts from a template, presents, saves to Drive and opens again", async ({
    page,
  }) => {
    const templates = await openApp(page, "Templates");
    await templates.getByRole("button", { name: /Pitch deck/ }).click();
    const slides = page.getByRole("region", { name: "Slides window" });
    await expect(slides).toBeVisible();
    const rail = slides.getByRole("listbox", { name: "Slides" });
    await expect(rail.getByRole("option")).toHaveCount(10);
    await expect(slides.getByRole("heading", { name: "Company name" })).toBeVisible();

    // A new slide goes in after the current one, and takes what's typed.
    await slides.getByRole("button", { name: "New slide" }).click();
    await expect(rail.getByRole("option")).toHaveCount(11);
    await expect(rail.getByRole("option", { selected: true })).toHaveAccessibleName("Slide 2");
    await slides.getByLabel("Title", { exact: true }).fill("Our bet");
    await slides.getByLabel("Points, one per line").fill("Faster\nSafer\nOwned by you");
    await expect(rail.getByRole("option", { selected: true })).toHaveAccessibleName(
      "Slide 2: Our bet",
    );
    await expect(slides.getByRole("listitem").filter({ hasText: "Owned by you" })).toHaveCount(1);

    // Presenting fills the screen; the keys step through; Escape leaves.
    await slides.getByRole("button", { name: "Present" }).click();
    const show = page.getByRole("dialog", { name: "Presentation" });
    await expect(show).toContainText("Slide 2 of 11");
    await page.keyboard.press("ArrowRight");
    await expect(show).toContainText("Slide 3 of 11");
    await page.keyboard.press("Home");
    await expect(show).toContainText("Slide 1 of 11");
    await expect(show.getByRole("heading", { name: "Company name" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(show).toHaveCount(0);
    expect(await wcagViolations(page)).toEqual([]);

    await slides.getByLabel("Presentation name").fill("Seed round.slides");
    await slides.getByRole("button", { name: "Save to Drive" }).click();
    await expect(page.getByText("Saved “Seed round.slides” in Drive")).toBeVisible();
    await expect(slides).toContainText("Saved in Drive");
    await slides.getByRole("button", { name: "Close Slides" }).click();

    // Opened again from Drive, it's the same deck: eleven slides, the new one kept.
    const again = await openApp(page, "Slides");
    await expect(again.getByRole("listbox", { name: "Slides" }).getByRole("option")).toHaveCount(1);
    await again.getByRole("button", { name: "Open…" }).click();
    await page
      .getByRole("dialog", { name: "Open a presentation" })
      .getByText("Seed round.slides")
      .click();
    await expect(again.getByRole("listbox", { name: "Slides" }).getByRole("option")).toHaveCount(
      11,
    );
    await again
      .getByRole("listbox", { name: "Slides" })
      .getByRole("option", { name: "Slide 2: Our bet" })
      .click();
    await expect(again.getByLabel("Title", { exact: true })).toHaveValue("Our bet");
  });

  test("Trash keeps a deleted file to put back, and Photos and PDF Viewer show Drive's", async ({
    page,
    baseURL,
  }) => {
    await upload(page, baseURL ?? "", "beach.png", PNG, "image/png");
    await upload(page, baseURL ?? "", "ticket.pdf", PDF, "application/pdf");

    const files = await openApp(page, "Files");
    await files.getByRole("button", { name: /^beach\.png/ }).click();
    await files.getByRole("button", { name: "Move to Trash" }).click();
    await expect(page.getByText("“beach.png” is in Trash")).toBeVisible();
    await expect(files.getByRole("button", { name: /^beach\.png/ })).toHaveCount(0);

    const trash = await openApp(page, "Trash");
    await expect(trash.getByText("Files stay here 30 days")).toBeVisible();
    await trash.getByRole("button", { name: /^beach\.png/ }).click();
    await trash.getByRole("button", { name: "Put back" }).click();
    await expect(page.getByText("“beach.png” is back")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    const photos = await openApp(page, "Photos");
    await photos.getByRole("button", { name: "beach.png" }).click();
    await expect(photos.getByRole("img", { name: "beach.png" })).toBeVisible();
    await expect(photos.getByText("1 of 1")).toBeVisible();

    const pdf = await openApp(page, "PDF Viewer");
    await pdf.getByRole("button", { name: "ticket.pdf" }).click();
    await expect(pdf.locator('iframe[title="ticket.pdf"]')).toHaveAttribute("src", /\/preview$/);
    expect(await wcagViolations(page)).toEqual([]);
  });
});

test.describe("the account's tools", () => {
  test.skip(({ isMobile }) => isMobile, "The apps are the desktop's.");

  test.beforeEach(async ({ page, baseURL }, info) => {
    const email = uniqueEmail(`tools-${String(info.parallelIndex)}`);
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

  test("the App Store keeps the Dock with the account, and Terminal runs Brawzer's commands", async ({
    page,
  }) => {
    const store = await openApp(page, "App Store");
    await store.getByRole("button", { name: "Keep in Dock: Terminal" }).click();
    await store.getByRole("button", { name: "Web apps", exact: true }).click();
    await store.getByRole("button", { name: "Install Wikipedia" }).click();
    // The newer web apps and the Brawzer Suite are listed too.
    for (const name of ["WhatsApp", "Telegram", "ChatGPT", "Claude", "Slack", "Spotify"]) {
      await expect(store.getByRole("button", { name: `Install ${name}` })).toBeVisible();
    }
    await store.getByRole("button", { name: "Brawzer Suite", exact: true }).click();
    const suite = store.getByRole("list", { name: "Brawzer Suite" });
    await expect(suite.getByRole("listitem").filter({ hasText: "Writer" })).toBeVisible();
    await expect(suite.getByRole("listitem").filter({ hasText: "Calc" })).toBeVisible();
    await expect(suite.getByRole("listitem").filter({ hasText: "Slides" })).toBeVisible();
    await store.getByRole("button", { name: "All", exact: true }).click();
    await expect(store.getByText("AI pack")).toBeVisible();
    await expect(store.getByText("Social pack")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    const dock = page.getByRole("navigation", { name: "Dock" });
    await expect(dock.getByRole("button", { name: "Terminal", exact: true })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Wikipedia" })).toBeVisible();

    // The dock comes back the same after a reload: it's kept with the account.
    await page.reload();
    await expect(dock.getByRole("button", { name: "Wikipedia" })).toBeVisible();
    await dock.getByRole("button", { name: "Terminal", exact: true }).click();
    const terminal = page.getByRole("region", { name: "Terminal window" });
    const command = terminal.getByRole("textbox", { name: "Command" });
    for (const line of ["mkdir Projects", "cd Projects", "pwd"]) {
      await command.fill(line);
      await command.press("Enter");
    }
    const output = terminal.getByRole("log", { name: "Terminal output" });
    await expect(output).toContainText("/Projects");
    await command.fill("frobnicate");
    await command.press("Enter");
    await expect(output).toContainText("frobnicate: not a Brawzer command");
    expect(await wcagViolations(page)).toEqual([]);
  });

  test("Usage, Passwords, Web Store, Screenshot and Send to Phone", async ({ page, baseURL }) => {
    const usage = await openApp(page, "Usage");
    await expect(usage.getByRole("meter", { name: "Drive storage" })).toBeVisible();
    await expect(usage).toContainText("No browsing yet this month.");

    const passwords = await openApp(page, "Passwords");
    await expect(
      passwords.getByRole("heading", { name: "Password managers on the web" }),
    ).toBeVisible();
    await expect(passwords).toContainText("Bitwarden");

    const webStore = await openApp(page, "Web Store");
    await expect(webStore).toContainText("uBlock Origin");

    const screenshot = await openApp(page, "Screenshot");
    await expect(screenshot).toContainText("Open a browser first");
    expect(await wcagViolations(page)).toEqual([]);

    await upload(page, baseURL ?? "", "ticket.pdf", PDF, "application/pdf");
    const files = await openApp(page, "Files");
    await files.getByRole("button", { name: /^ticket\.pdf/ }).click();
    await files.getByRole("button", { name: "Send to Phone" }).click();
    const phone = page.getByRole("region", { name: "Send to Phone window" });
    await expect(
      phone.getByRole("img", { name: "QR code for “ticket.pdf” in Drive" }),
    ).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
  });
});

test.describe("the assistant's apps", () => {
  test.skip(({ isMobile }) => isMobile, "The apps are the desktop's.");

  test("say plainly when the assistant isn't turned on, and Study Notes still keeps the notes", async ({
    page,
    baseURL,
  }) => {
    const email = uniqueEmail("assistant-off");
    await page.addInitScript(() => {
      sessionStorage.setItem("brawzer:notices-seen", String(Date.now() + 60_000));
      sessionStorage.setItem("brawzer:desktop-style", "mac");
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
    await signIn(page.context(), baseURL ?? "", email, PASSWORD);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1, name: GREETING })).toBeVisible();
    // This installation runs without a Claude key.
    const status = (await (await page.request.get("/api/v1/assistant")).json()) as {
      available: boolean;
    };
    test.skip(status.available, "The assistant is turned on here.");

    const assistant = await openApp(page, "Assistant");
    await expect(assistant).toContainText("isn’t turned on for this Brawzer");

    const study = await openApp(page, "Study Notes");
    await study
      .getByRole("textbox", { name: "Your notes" })
      .fill("Photosynthesis turns light into chemical energy.");
    await expect(study).toContainText("which isn’t turned on for this Brawzer");
    await expect(study.getByRole("status").last()).toHaveText("Saved with your account");
    expect(await wcagViolations(page)).toEqual([]);
  });
});
