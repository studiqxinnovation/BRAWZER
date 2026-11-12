import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { wcagViolations } from "./accessibility";
import { expireIdentityConfirmation } from "./database";
import { createConfirmedAccount, signIn, uniqueEmail } from "./mailbox";

const PASSWORD = "violet-harbor-lantern";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const NOTES = Buffer.from("Packing list\n- passport\n- charger\n");
// The standard antivirus test file, assembled so this source file isn't flagged.
const EICAR = [
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$",
  "EICAR-STANDARD-",
  "ANTIVIRUS-TEST-FILE!$H+H*",
].join("");

async function interactive(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-session-keeper", /.+/);
}

async function signedIn(page: Page, baseURL: string | undefined, tag: string): Promise<string> {
  const email = uniqueEmail(tag);
  await createConfirmedAccount(page.request, baseURL ?? "", email, PASSWORD);
  await signIn(page.context(), baseURL ?? "", email, PASSWORD);
  await page.goto("/app/drive");
  await interactive(page);
  return email;
}

async function uploadFile(
  page: Page,
  name: string,
  content: Buffer,
  mimeType = "application/octet-stream",
) {
  await page.getByTestId("drive-file-input").setInputFiles({ name, mimeType, buffer: content });
  await expect(
    page
      .getByRole("region", { name: "Uploads" })
      .getByText(/Added to Drive|Quarantined|Not uploaded/)
      .first(),
  ).toBeVisible();
}

const list = (page: Page) => page.getByRole("list", { name: "Files and folders" });

test.describe("drive", () => {
  test("a deleted file waits in Trash, and comes back from it", async ({ page, baseURL }) => {
    await signedIn(page, baseURL, "drive-trash");
    // The page has finished arriving before anything is uploaded to it.
    await expect(page.locator("#main-content").getByText("Nothing in Drive yet")).toBeVisible();
    await uploadFile(page, "packing.txt", Buffer.from("Socks\nCharger\n"), "text/plain");
    await list(page).getByRole("button", { name: "Actions for packing.txt" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Move “packing.txt” to Trash?" });
    await expect(confirm).toContainText("stays in Trash for 30 days");
    await confirm.getByRole("button", { name: "Move to Trash" }).click();
    await expect(page.locator("#main-content").getByText("Nothing in Drive yet")).toBeVisible();

    await page.getByText("Kept 30 days, then removed").click();
    const trash = page.getByRole("list", { name: "In Trash" });
    await expect(trash).toContainText("packing.txt");
    expect(await wcagViolations(page)).toEqual([]);
    await trash.getByRole("button", { name: "Put back" }).click();
    await expect(page.getByText("“packing.txt” is back")).toBeVisible();
    await expect(list(page).getByText("packing.txt")).toBeVisible();
  });

  test("upload, organise, preview, save and delete files", async ({ page, baseURL }) => {
    const email = await signedIn(page, baseURL, "drive");
    await expect(page.locator("#main-content").getByText("Nothing in Drive yet")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);

    // A folder.
    await page.getByRole("button", { name: "New folder" }).click();
    const newFolder = page.getByRole("dialog", { name: "New folder" });
    await newFolder.getByRole("textbox", { name: "Name" }).fill("Trip");
    expect(await wcagViolations(page)).toEqual([]);
    await newFolder.getByRole("button", { name: "Create folder" }).click();
    await expect(newFolder).toBeHidden();
    await expect(list(page).getByRole("link", { name: "Trip" })).toBeVisible();

    // Uploads: a text file at the top level, an image inside the folder.
    await uploadFile(page, "notes.txt", NOTES, "text/plain");
    const notes = list(page).getByRole("listitem").filter({ hasText: "notes.txt" });
    await expect(notes.getByText("Text", { exact: true })).toBeVisible();
    await expect(notes.getByText(`${String(NOTES.length)} bytes`)).toBeVisible();
    await page.getByRole("button", { name: "Clear finished" }).click();

    await list(page).getByRole("link", { name: "Trip" }).click();
    await expect(
      page.getByRole("navigation", { name: "Folder path" }).getByText("Trip"),
    ).toBeVisible();
    await expect(page.getByText("This folder is empty")).toBeVisible();
    await uploadFile(page, "beach.png", PNG, "image/png");
    const beach = list(page).getByRole("listitem").filter({ hasText: "beach.png" });
    await expect(beach.getByText("PNG image", { exact: false })).toBeVisible();

    // Preview the image without saving it anywhere.
    await beach.getByRole("button", { name: "beach.png", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "beach.png" });
    const image = preview.getByTestId("drive-preview-image");
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBe(1);
    expect(await wcagViolations(page)).toEqual([]);
    await preview.getByRole("button", { name: "Close preview" }).click();
    await expect(preview).toBeHidden();

    // Search finds files everywhere and says where they are.
    await page.getByRole("searchbox", { name: "Search files" }).fill("NOTES");
    await page.getByRole("searchbox", { name: "Search files" }).press("Enter");
    await expect(page).toHaveURL(/\/app\/drive\?q=NOTES$/);
    const results = page.getByRole("list", { name: "Search results" });
    await expect(results.getByText("notes.txt")).toBeVisible();
    await expect(results.getByText("in Drive")).toBeVisible();
    await page.getByRole("link", { name: "Clear" }).click();
    await expect(page).toHaveURL(/\/app\/drive$/);

    // Preview text in a sandboxed frame.
    await list(page).getByRole("button", { name: "notes.txt", exact: true }).click();
    const textPreview = page.getByRole("dialog", { name: "notes.txt" });
    const frame = textPreview.getByTestId("drive-preview-frame");
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute("sandbox", "");
    await textPreview.getByRole("button", { name: "Close preview" }).click();
    await expect(textPreview).toBeHidden();

    // Save to this computer: a warning on a shared computer, then "confirm it's you".
    await expireIdentityConfirmation(email);
    await list(page).getByRole("button", { name: "Actions for notes.txt" }).click();
    await page.getByRole("menuitem", { name: "Save to this computer…" }).click();
    const save = page.getByRole("alertdialog", { name: "Save “notes.txt” to this computer?" });
    await expect(save.getByText("You’re on a shared computer")).toBeVisible();
    expect(await wcagViolations(page)).toEqual([]);
    await save.getByRole("button", { name: "Save to this computer" }).click();
    const confirm = page.getByRole("dialog", { name: "Confirm it’s you" });
    await confirm.getByLabel("Password", { exact: true }).fill(PASSWORD);
    const downloading = page.waitForEvent("download");
    await confirm.getByRole("button", { name: "Confirm", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("notes.txt");
    expect(await readFile(await download.path())).toEqual(NOTES);
    await expect(save).toBeHidden();
    // The link worked once; the page never carried a session-free way to the content.
    const url = download.url();
    expect(url).toMatch(/\/api\/v1\/drive\/files\/[^/]+\/content\?ticket=/);
    const again = await page.request.get(url);
    expect(again.status()).toBe(400);

    // Rename, move into the folder, then delete the folder with everything in it.
    await list(page).getByRole("button", { name: "Actions for notes.txt" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const rename = page.getByRole("dialog", { name: "Rename file" });
    await rename.getByRole("textbox", { name: "Name" }).fill("packing.txt");
    await rename.getByRole("button", { name: "Rename" }).click();
    await expect(rename).toBeHidden();
    await expect(list(page).getByText("packing.txt")).toBeVisible();

    await list(page).getByRole("button", { name: "Actions for packing.txt" }).click();
    await page.getByRole("menuitem", { name: "Move…" }).click();
    const move = page.getByRole("dialog", { name: "Move “packing.txt”" });
    await move.getByRole("combobox", { name: "Move to" }).click();
    await page.getByRole("option", { name: "Drive / Trip", exact: true }).click();
    await move.getByRole("button", { name: "Move" }).click();
    await expect(move).toBeHidden();
    await expect(list(page).getByText("packing.txt")).toHaveCount(0);
    await expect(page.getByText("2 of 2000 files")).toBeVisible();

    await list(page).getByRole("button", { name: "Actions for Trip" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const remove = page.getByRole("alertdialog", { name: "Delete “Trip” and everything in it?" });
    await remove.getByRole("button", { name: "Delete folder" }).click();
    await expect(page.locator("#main-content").getByText("Nothing in Drive yet")).toBeVisible();
    await expect(page.getByText("0 of 2000 files")).toBeVisible();

    // Nothing secret reaches the page.
    const html = await page.content();
    expect(html).not.toContain("wrappedKey");
    expect(html).not.toContain("objectKey");
  });

  test("an infected upload is quarantined and can only be deleted", async ({ page, baseURL }) => {
    await signedIn(page, baseURL, "drive-eicar");
    await uploadFile(page, "invoice.pdf.exe", Buffer.from(EICAR));
    await expect(
      page.getByRole("region", { name: "Uploads" }).getByText(/^Quarantined ·/),
    ).toBeVisible();
    const row = list(page).getByRole("listitem").filter({ hasText: "invoice.pdf.exe" });
    await expect(row.getByText("Quarantined", { exact: true })).toBeVisible();
    await expect(row.getByText(/The malware scan found .*Eicar/i)).toBeVisible();
    // Not a link or button: it can't be opened.
    await expect(row.getByRole("button", { name: "invoice.pdf.exe", exact: true })).toHaveCount(0);
    expect(await wcagViolations(page)).toEqual([]);

    await row.getByRole("button", { name: "Actions for invoice.pdf.exe" }).click();
    await expect(page.getByRole("menuitem", { name: "Save to this computer…" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Preview" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page
      .getByRole("alertdialog", { name: "Delete “invoice.pdf.exe”?" })
      .getByRole("button", { name: "Delete file" })
      .click();
    await expect(page.locator("#main-content").getByText("Nothing in Drive yet")).toBeVisible();
  });

  test("a file over the limit is refused before it is sent", async ({ page, baseURL }) => {
    await signedIn(page, baseURL, "drive-limit");
    // Playwright caps in-memory files at 50 MB, so the oversized file lives on disk.
    const folder = await mkdtemp(path.join(tmpdir(), "brawzer-drive-"));
    const huge = path.join(folder, "huge.bin");
    await writeFile(huge, Buffer.alloc(100 * 1024 * 1024 + 1));
    try {
      await page.getByTestId("drive-file-input").setInputFiles(huge);
      const uploads = page.getByRole("region", { name: "Uploads" });
      await expect(uploads.getByText("Not uploaded", { exact: false })).toBeVisible();
      await expect(uploads.getByText("Files can be up to 100 MB", { exact: false })).toBeVisible();
      await expect(page.locator("#main-content").getByText("Nothing in Drive yet")).toBeVisible();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  test("an unknown folder is explained, not an error", async ({ page, baseURL }) => {
    await signedIn(page, baseURL, "drive-missing");
    await page.goto("/app/drive?folder=00000000-0000-7000-8000-000000000000");
    await expect(
      page.locator("#main-content").getByText("That folder doesn’t exist"),
    ).toBeVisible();
    await page.getByRole("link", { name: "Back to Drive" }).click();
    await expect(page.locator("#main-content").getByText("Nothing in Drive yet")).toBeVisible();
  });
});
