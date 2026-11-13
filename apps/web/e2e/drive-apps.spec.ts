import { expect, type Page, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
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

/** An Office file: a zip of XML parts, the content types first, as Office writes them. */
function office(parts: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, xml] of Object.entries(parts)) entries[path] = strToU8(xml);
  return Buffer.from(zipSync(entries));
}

const TYPES = (overrides: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`;
const RELS = (main: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`;

const DOCX = office({
  "[Content_Types].xml": TYPES(
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
  ),
  "_rels/.rels": RELS("word/document.xml"),
  "word/document.xml":
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Hello from Word</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Written in </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p></w:body></w:document>',
});

const XLSX = office({
  "[Content_Types].xml": TYPES(
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
  ),
  "_rels/.rels": RELS("xl/workbook.xml"),
  "xl/workbook.xml":
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels":
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  "xl/worksheets/sheet1.xml":
    '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Pens</t></is></c><c r="B1"><v>4</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Paper</t></is></c><c r="B2"><v>6</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Total</t></is></c><c r="B3"><f>SUM(B1:B2)</f><v>10</v></c></row></sheetData></worksheet>',
});

const PPTX = office({
  "[Content_Types].xml": TYPES(
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>',
  ),
  "_rels/.rels": RELS("ppt/presentation.xml"),
  "ppt/presentation.xml":
    '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
  "ppt/slides/slide1.xml":
    '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Hello deck</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Subtitle"/><p:cNvSpPr/><p:nvPr><p:ph type="subTitle"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>From PowerPoint</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  "ppt/slides/slide2.xml":
    '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Three points</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>One</a:t></a:r></a:p><a:p><a:r><a:t>Two</a:t></a:r></a:p><a:p><a:r><a:t>Three</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
});

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

  test("the Brawzer Suite opens Word, Excel and PowerPoint files and saves them back as such", async ({
    page,
    baseURL,
  }) => {
    const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    await upload(page, baseURL ?? "", "Essay.docx", DOCX, WORD);
    await upload(page, baseURL ?? "", "Budget.xlsx", XLSX, "application/octet-stream");
    await upload(page, baseURL ?? "", "Pitch.pptx", PPTX, "application/octet-stream");

    // Writer: the Word file's heading and bold text, saved back as Word, opened again.
    const writer = await openApp(page, "Writer");
    await writer.getByRole("button", { name: "Open…" }).click();
    const documents = page.getByRole("dialog", { name: "Open a document" });
    await documents.getByRole("button", { name: /^Essay\.docx/ }).click();
    const paper = writer.getByRole("textbox", { name: "Document", exact: true });
    await expect(paper.getByRole("heading", { level: 1, name: "Hello from Word" })).toBeVisible();
    await expect(paper.locator("b", { hasText: "bold" })).toBeVisible();
    await expect(writer).toContainText("Word document");
    await paper.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" and Brawzer");
    await writer.getByRole("button", { name: "Save to Drive" }).click();
    await expect(page.getByText("Saved “Essay.docx” in Drive")).toBeVisible();
    expect(await driveNames(page)).toEqual(["Budget.xlsx", "Essay.docx", "Pitch.pptx"]);
    await writer.getByRole("button", { name: "Open…" }).click();
    await documents.getByRole("button", { name: /^Essay\.docx/ }).click();
    await expect(paper).toContainText("and Brawzer");
    await expect(paper.getByRole("heading", { level: 1, name: "Hello from Word" })).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // Calc: the workbook's cells and formula, saved back as Excel.
    const calc = await openApp(page, "Calc");
    await calc.getByRole("button", { name: "Open…" }).click();
    const sheets = page.getByRole("dialog", { name: "Open a sheet" });
    await sheets.getByRole("button", { name: /^Budget\.xlsx/ }).click();
    await expect(calc.getByRole("textbox", { name: "A1", exact: true })).toHaveValue("Pens");
    await expect(calc.getByRole("textbox", { name: "B3", exact: true })).toHaveValue("10");
    await expect(calc).toContainText("Excel workbook");
    await calc.getByRole("textbox", { name: "B2", exact: true }).fill("16");
    await calc.getByRole("textbox", { name: "B2", exact: true }).press("Enter");
    // Enter moved to B3, which shows its formula while it has the focus.
    await calc.getByRole("textbox", { name: "B3", exact: true }).press("Escape");
    await expect(calc.getByRole("textbox", { name: "B3", exact: true })).toHaveValue("20");
    await calc.getByRole("button", { name: "Save to Drive" }).click();
    await expect(page.getByText("Saved “Budget.xlsx” in Drive")).toBeVisible();
    await calc.getByRole("button", { name: "Open…" }).click();
    await sheets.getByRole("button", { name: /^Budget\.xlsx/ }).click();
    await expect(calc.getByRole("textbox", { name: "B3", exact: true })).toHaveValue("20");
    await calc.getByRole("textbox", { name: "B3", exact: true }).focus();
    await expect(calc.getByRole("textbox", { name: "B3", exact: true })).toHaveValue("=SUM(B1:B2)");

    // Slides: the presentation's two slides, saved back as PowerPoint.
    const slides = await openApp(page, "Slides");
    await slides.getByRole("button", { name: "Open…" }).click();
    const decks = page.getByRole("dialog", { name: "Open a presentation" });
    await decks.getByRole("button", { name: /^Pitch\.pptx/ }).click();
    const rail = slides.getByRole("listbox", { name: "Slides" });
    await expect(rail.getByRole("option")).toHaveCount(2);
    await expect(slides.getByRole("heading", { name: "Hello deck" })).toBeVisible();
    await expect(slides).toContainText("PowerPoint file");
    await rail.getByRole("option", { name: "Slide 2: Three points" }).click();
    await expect(slides.getByRole("textbox", { name: "Points, one per line" })).toHaveValue(
      "One\nTwo\nThree",
    );
    await slides.getByRole("button", { name: "Save to Drive" }).click();
    await expect(page.getByText("Saved “Pitch.pptx” in Drive")).toBeVisible();
    await slides.getByRole("button", { name: "Open…" }).click();
    await decks.getByRole("button", { name: /^Pitch\.pptx/ }).click();
    await expect(rail.getByRole("option")).toHaveCount(2);
    await expect(rail.getByRole("option", { name: "Slide 2: Three points" })).toBeVisible();
    expect(await driveNames(page)).toEqual(["Budget.xlsx", "Essay.docx", "Pitch.pptx"]);
    expect(await wcagViolations(page)).toEqual([]);
  });

  test("files are pasted and dropped in from this computer, copied and cut between the desktop and Files, and a Word file opens from the desktop", async ({
    page,
  }) => {
    const dock = page.getByRole("navigation", { name: "Dock" });
    await dock.getByRole("button", { name: "Brawzer, open" }).click();
    const desktop = page.getByRole("list", { name: "Desktop" });
    await expect(desktop.getByRole("button", { name: "Brawzer Drive", exact: true })).toBeVisible();

    // Nothing to paste yet.
    await page.mouse.click(700, 500, { button: "right" });
    const menu = page.getByRole("menu", { name: "Menu" });
    await expect(menu.getByRole("menuitem", { name: "Paste" })).toBeDisabled();
    await page.keyboard.press("Escape");

    // A file copied on this computer, pasted on the desktop: uploaded to Drive's Desktop folder.
    await page.mouse.click(700, 500);
    await page.evaluate((bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], "Essay.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      );
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }, Array.from(DOCX));
    await expect(page.getByText("1 file on the desktop")).toBeVisible();
    await expect(desktop.getByRole("button", { name: "Essay.docx", exact: true })).toBeVisible();

    // Dropped on the desktop from this computer: the same.
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["Hello drop"], "dropped.txt", { type: "text/plain" }));
      const target = document.elementFromPoint(700, 500);
      target?.dispatchEvent(
        new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
    });
    await expect(desktop.getByRole("button", { name: "dropped.txt", exact: true })).toBeVisible();

    // The Word file opens in Writer from the desktop.
    await desktop.getByRole("button", { name: "Essay.docx", exact: true }).dblclick();
    const writer = page.getByRole("region", { name: "Writer window" });
    await expect(
      writer
        .getByRole("textbox", { name: "Document", exact: true })
        .getByRole("heading", { name: "Hello from Word" }),
    ).toBeVisible();
    await writer.getByRole("button", { name: "Close Writer" }).click();

    // Copy, then Paste on the desktop: a numbered copy beside it.
    await desktop
      .getByRole("button", { name: "Essay.docx", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy" }).click();
    await expect(page.getByText("Copied “Essay.docx”")).toBeVisible();
    await page.mouse.click(700, 500, { button: "right" });
    await expect(menu.getByRole("menuitem", { name: "Paste" })).toContainText("copied");
    await menu.getByRole("menuitem", { name: "Paste" }).click();
    await expect(
      desktop.getByRole("button", { name: "Essay (2).docx", exact: true }),
    ).toBeVisible();
    await expect(desktop.getByRole("button", { name: "Essay.docx", exact: true })).toBeVisible();

    // Cut with the keyboard, pasted into a folder in Files: moved there.
    await desktop.getByRole("button", { name: "Essay (2).docx", exact: true }).click();
    await page.keyboard.press("ControlOrMeta+x");
    await expect(page.getByText("Cut “Essay (2).docx”")).toBeVisible();
    const files = await openApp(page, "Files");
    await files.getByRole("button", { name: "Documents, folder" }).dblclick();
    await files.getByRole("button", { name: "Paste" }).click();
    await expect(page.getByText("Moved “Essay (2).docx” to Documents")).toBeVisible();
    await expect(files.getByRole("button", { name: /^Essay \(2\)\.docx/ })).toBeVisible();
    await expect(desktop.getByRole("button", { name: "Essay (2).docx", exact: true })).toHaveCount(
      0,
    );
    await expect(files.getByRole("button", { name: "Paste" })).toHaveCount(0);

    // Copied in Files and pasted onto the desktop, and a file pasted into Files from this computer.
    await files.getByRole("button", { name: /^Essay \(2\)\.docx/ }).click();
    await files.getByRole("button", { name: "Copy", exact: true }).click();
    await files.getByRole("button", { name: "Up one folder" }).click();
    await files.getByRole("button", { name: "Desktop, folder" }).dblclick();
    await files.getByRole("button", { name: "Paste" }).click();
    await expect(page.getByText("Copied “Essay (2).docx” to Desktop")).toBeVisible();
    await expect(
      desktop.getByRole("button", { name: "Essay (2).docx", exact: true }),
    ).toBeVisible();
    await files.locator(".ap-file-grid").evaluate((node) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["Pasted here"], "pasted.txt", { type: "text/plain" }));
      node.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    });
    await expect(page.getByRole("heading", { name: "Uploaded “pasted.txt”" })).toBeVisible();
    await expect(files.getByRole("button", { name: /^pasted\.txt/ })).toBeVisible();
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
    // The starter web apps are already on the desktop; the rest can be installed.
    for (const name of ["WhatsApp", "Telegram", "ChatGPT", "Claude", "YouTube", "Spotify"]) {
      await expect(store.getByRole("button", { name: `Remove ${name}` })).toBeVisible();
    }
    for (const name of ["Slack", "Discord", "Gemini"]) {
      await expect(store.getByRole("button", { name: `Install ${name}` })).toBeVisible();
    }
    await store.getByRole("button", { name: "Remove Spotify" }).click();
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
    await expect(dock.getByRole("button", { name: "WhatsApp" })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Spotify" })).toHaveCount(0);

    // The dock comes back the same after a reload: it's kept with the account.
    await page.reload();
    await expect(dock.getByRole("button", { name: "Wikipedia" })).toBeVisible();
    await expect(dock.getByRole("button", { name: "WhatsApp" })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Spotify" })).toHaveCount(0);
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
