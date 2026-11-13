import { randomBytes } from "node:crypto";
import {
  accountExportSchema,
  downloadTicketSchema,
  driveFileListSchema,
  driveFileSchema,
  driveFolderSchema,
  driveOverviewSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ObjectStore } from "../src/storage/object-store.js";
import { OBJECT_STORE } from "../src/storage/storage.module.js";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";

// Requires the local services (`pnpm infra:up`), including RustFS and ClamAV.
// The per-file limit is lowered so the test can hit it without a 100 MB upload.
const MAX_FILE_BYTES = 3 * 1024 * 1024;
let h: Harness;
let store: ObjectStore;

const EICAR = [
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$",
  "EICAR-STANDARD-",
  "ANTIVIRUS-TEST-FILE!$H+H*",
].join("");
// A real 1×1 PNG: file-type walks the chunks, so the structure has to be valid.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
);

beforeAll(async () => {
  h = await createHarness({
    ipPrefix: "100.68.0",
    env: { DRIVE_MAX_FILE_BYTES: String(MAX_FILE_BYTES) },
  });
  store = h.app.get<ObjectStore>(OBJECT_STORE);
});

afterAll(async () => {
  await h.close();
});

async function account(tag: string): Promise<{ client: TestBrowser; email: string }> {
  const client = h.browser();
  const email = h.uniqueEmail(tag);
  await h.signUp(client, email);
  return { client, email };
}

async function upload(client: TestBrowser, name: string, content: Buffer, folderId?: string) {
  const response = await client.upload(`/drive/files${folderId ? `?folderId=${folderId}` : ""}`, {
    name,
    content,
  });
  expect(response.statusCode, response.body).toBe(201);
  return driveFileSchema.parse(response.json());
}

async function createFolder(client: TestBrowser, name: string, parentId?: string) {
  const response = await client.post("/drive/folders", { name, parentId });
  expect(response.statusCode, response.body).toBe(201);
  return driveFolderSchema.parse(response.json());
}

async function filesIn(client: TestBrowser, folderId?: string) {
  const response = await client.get(`/drive/files${folderId ? `?folderId=${folderId}` : ""}`);
  expect(response.statusCode).toBe(200);
  return driveFileListSchema.parse(response.json()).files;
}

async function objectKeysOf(email: string): Promise<string[]> {
  const result = await h.database.pool.query<{ object_key: string }>(
    `select f.object_key from drive_files f join users u on u.id = f.user_id where u.email = $1`,
    [email],
  );
  return result.rows.map((row) => row.object_key);
}

describe("uploading", () => {
  it("stores a file encrypted, sniffs its type and reports usage", async () => {
    const { client, email } = await account("drive-upload");
    const text = Buffer.from("Shopping list\n- milk\n- bread\n");
    const file = await upload(client, "notes.exe", text);
    expect(file).toMatchObject({
      name: "notes.exe",
      folderId: null,
      size: text.length,
      contentType: "text/plain", // from the bytes, not the name
      status: "clean",
      threat: null,
      previewable: true,
      source: "upload",
    });

    // The store never sees plaintext.
    const [objectKey] = await objectKeysOf(email);
    if (!objectKey) throw new Error("No object key recorded");
    const object = await store.get(objectKey);
    if (!object) throw new Error("The object wasn't stored");
    const chunks: Buffer[] = [];
    for await (const chunk of object) chunks.push(chunk as Buffer);
    const stored = Buffer.concat(chunks);
    expect(stored.length).toBe(9 + text.length + 16);
    expect(stored.includes(Buffer.from("milk"))).toBe(false);

    const overview = driveOverviewSchema.parse((await client.get("/drive")).json());
    expect(overview.usage).toMatchObject({
      usedBytes: text.length,
      fileCount: 1,
      folderCount: 0,
      maxFileBytes: MAX_FILE_BYTES,
    });
    expect(await h.eventTypes(email)).toContain("drive.file_uploaded");
  });

  it("recognises images and PDFs, and marks other types download-only", async () => {
    const { client } = await account("drive-types");
    expect(await upload(client, "photo", PNG)).toMatchObject({
      contentType: "image/png",
      previewable: true,
    });
    expect(await upload(client, "doc.txt", PDF)).toMatchObject({
      contentType: "application/pdf",
      previewable: true,
    });
    const binary = Buffer.concat([Buffer.from([0, 1, 2, 3, 255, 254]), randomBytes(100)]);
    const opaque = await upload(client, "data.bin", binary);
    expect(opaque).toMatchObject({ contentType: "application/octet-stream", previewable: false });
    const empty = await upload(client, "empty.txt", Buffer.alloc(0));
    expect(empty).toMatchObject({ size: 0, contentType: "application/octet-stream" });

    const preview = await client.get(`/drive/files/${opaque.id}/preview`);
    expect(preview.statusCode).toBe(415);
  });

  it("gives a second file with the same name a numbered name, and cleans up the filename", async () => {
    const { client } = await account("drive-names");
    await upload(client, "report.pdf", PDF);
    const second = await upload(client, "REPORT.pdf", PDF);
    expect(second.name).toBe("REPORT (2).pdf");
    const third = await upload(client, "report.pdf", PDF);
    expect(third.name).toBe("report (3).pdf");
    const odd = await upload(client, "../..\\evil\u0000‮.txt", Buffer.from("x"));
    expect(odd.name).toBe("evil.txt");
    const nameless = await upload(client, "", Buffer.from("y"));
    expect(nameless.name).toBe("Untitled");
  });

  it("quarantines an infected file: visible, deletable, never openable", async () => {
    const { client, email } = await account("drive-eicar");
    const infected = await upload(client, "invoice.pdf.exe", Buffer.from(EICAR));
    expect(infected.status).toBe("infected");
    expect(infected.threat).toMatch(/eicar/i);
    expect(infected.previewable).toBe(false);
    expect(await h.eventTypes(email)).toContain("drive.file_quarantined");

    const listed = await filesIn(client);
    expect(listed.map((file) => file.id)).toContain(infected.id);

    expect((await client.get(`/drive/files/${infected.id}/preview`)).statusCode).toBe(403);
    const ticket = await client.post(`/drive/files/${infected.id}/download-ticket`);
    expect(ticket.statusCode).toBe(403);
    expect(h.errorOf(ticket).code).toBe("forbidden");

    expect((await client.delete(`/drive/files/${infected.id}`)).statusCode).toBe(204);
    expect(await filesIn(client)).toEqual([]);
  });

  it("refuses files over the per-file limit and keeps nothing", async () => {
    const { client, email } = await account("drive-too-large");
    const response = await client.upload("/drive/files", {
      name: "big.bin",
      content: randomBytes(MAX_FILE_BYTES + 1),
    });
    expect(response.statusCode).toBe(413);
    expect(h.errorOf(response).code).toBe("payload_too_large");
    expect(await objectKeysOf(email)).toEqual([]);
    const usage = driveOverviewSchema.parse((await client.get("/drive")).json()).usage;
    expect(usage.fileCount).toBe(0);

    // Exactly the limit is fine, and streams through several encryption chunks.
    const exact = await upload(client, "exact.bin", randomBytes(MAX_FILE_BYTES));
    expect(exact.size).toBe(MAX_FILE_BYTES);
  });

  it("refuses uploads once Drive is full", async () => {
    const { client, email } = await account("drive-full");
    await upload(client, "a.txt", Buffer.from("a"));
    // Pretend the account holds its whole allowance.
    await h.database.pool.query(
      `update drive_files set size = 2147483648 where user_id = (select id from users where email = $1)`,
      [email],
    );
    const response = await client.upload("/drive/files", {
      name: "b.txt",
      content: Buffer.from("b"),
    });
    expect(response.statusCode).toBe(409);
    expect(h.errorOf(response).code).toBe("limit_reached");
  });

  it("needs a multipart body and a signed-in session", async () => {
    const { client } = await account("drive-plain");
    const json = await client.post("/drive/files", { name: "x" });
    expect(json.statusCode).toBe(415);
    const noFile = await client.raw("POST", "/drive/files", Buffer.from("--b--\r\n"), {
      "content-type": "multipart/form-data; boundary=b",
    });
    expect([400, 406, 415]).toContain(noFile.statusCode);
    const anonymous = h.browser();
    expect((await anonymous.get("/drive")).statusCode).toBe(401);
  });
});

describe("folders", () => {
  it("creates, nests, renames, moves and refuses cycles", async () => {
    const { client } = await account("drive-folders");
    const work = await createFolder(client, "Work");
    const reports = await createFolder(client, "Reports", work.id);
    expect(reports.parentId).toBe(work.id);

    const duplicate = await client.post("/drive/folders", { name: "work" });
    expect(duplicate.statusCode).toBe(409);
    // The same name is fine somewhere else.
    expect(
      (await client.post("/drive/folders", { name: "Work", parentId: work.id })).statusCode,
    ).toBe(201);

    const renamed = await client.patch(`/drive/folders/${reports.id}`, { name: "Monthly reports" });
    expect(driveFolderSchema.parse(renamed.json()).name).toBe("Monthly reports");

    const intoItself = await client.patch(`/drive/folders/${work.id}`, { parentId: work.id });
    expect(intoItself.statusCode).toBe(400);
    const intoChild = await client.patch(`/drive/folders/${work.id}`, { parentId: reports.id });
    expect(intoChild.statusCode).toBe(400);
    const toTop = await client.patch(`/drive/folders/${reports.id}`, { parentId: null });
    expect(driveFolderSchema.parse(toTop.json()).parentId).toBeNull();

    const someoneElse = await account("drive-folders-other");
    expect((await someoneElse.client.get(`/drive/files?folderId=${work.id}`)).statusCode).toBe(200);
    expect(
      (await someoneElse.client.patch(`/drive/folders/${work.id}`, { name: "Mine" })).statusCode,
    ).toBe(404);
    expect((await someoneElse.client.delete(`/drive/folders/${work.id}`)).statusCode).toBe(404);
  });

  it("deleting a folder removes everything below it, objects included", async () => {
    const { client, email } = await account("drive-folder-delete");
    const parent = await createFolder(client, "Parent");
    const child = await createFolder(client, "Child", parent.id);
    await upload(client, "one.txt", Buffer.from("one"), parent.id);
    await upload(client, "two.txt", Buffer.from("two"), child.id);
    const kept = await upload(client, "kept.txt", Buffer.from("kept"));
    const keys = await objectKeysOf(email);
    expect(keys).toHaveLength(3);

    expect((await client.delete(`/drive/folders/${parent.id}`)).statusCode).toBe(204);
    const overview = driveOverviewSchema.parse((await client.get("/drive")).json());
    expect(overview.folders).toEqual([]);
    expect(overview.usage).toMatchObject({ fileCount: 1, usedBytes: 4 });
    expect((await filesIn(client)).map((file) => file.id)).toEqual([kept.id]);
    for (const key of keys) {
      const remaining = await objectKeysOf(email);
      expect(await store.get(key)).toSatisfy((value) =>
        remaining.includes(key) ? value !== null : value === null,
      );
    }
    expect(await h.eventTypes(email)).toContain("drive.folder_deleted");
  });
});

describe("files", () => {
  it("lists by folder, searches everywhere, renames and moves", async () => {
    const { client } = await account("drive-files");
    const folder = await createFolder(client, "Photos");
    const top = await upload(client, "Beach.png", PNG);
    const inside = await upload(client, "beach-2.png", PNG, folder.id);
    const other = await upload(client, "notes.txt", Buffer.from("beach plans"), folder.id);

    expect((await filesIn(client)).map((file) => file.id)).toEqual([top.id]);
    expect((await filesIn(client, folder.id)).map((file) => file.id)).toEqual([
      inside.id,
      other.id,
    ]);

    const search = await client.get("/drive/files?q=BEACH");
    expect(
      driveFileListSchema
        .parse(search.json())
        .files.map((file) => file.id)
        .sort(),
    ).toEqual([top.id, inside.id].sort());
    // LIKE wildcards in the query are literal.
    expect(
      driveFileListSchema.parse((await client.get("/drive/files?q=%25")).json()).files,
    ).toEqual([]);

    const taken = await client.patch(`/drive/files/${other.id}`, { name: "BEACH-2.png" });
    expect(taken.statusCode).toBe(409);
    const renamed = await client.patch(`/drive/files/${other.id}`, { name: "plans.txt" });
    expect(driveFileSchema.parse(renamed.json()).name).toBe("plans.txt");
    const moved = await client.patch(`/drive/files/${inside.id}`, { folderId: null });
    expect(driveFileSchema.parse(moved.json()).folderId).toBeNull();
    expect((await filesIn(client)).map((file) => file.id).sort()).toEqual(
      [top.id, inside.id].sort(),
    );

    const stranger = await account("drive-files-other");
    expect((await stranger.client.get(`/drive/files/${top.id}/preview`)).statusCode).toBe(404);
    expect((await stranger.client.delete(`/drive/files/${top.id}`)).statusCode).toBe(404);
    const bad = await client.patch(`/drive/files/${top.id}`, { name: "a/b" });
    expect(bad.statusCode).toBe(400);
  });

  it("previews safe types inline with sandboxing headers, byte for byte", async () => {
    const { client } = await account("drive-preview");
    const text = Buffer.from("<script>alert(1)</script> plain text, really");
    const file = await upload(client, "page.html", text);
    const response = await client.get(`/drive/files/${file.id}/preview`);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response.headers["content-disposition"]).toContain("inline;");
    expect(response.headers["content-disposition"]).toContain("page.html");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain("sandbox");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-length"]).toBe(String(text.length));
    expect(response.rawPayload.equals(text)).toBe(true);

    const image = await upload(client, "photo.png", PNG);
    const shown = await client.get(`/drive/files/${image.id}/preview`);
    expect(shown.headers["content-type"]).toBe("image/png");
    expect(shown.rawPayload.equals(PNG)).toBe(true);

    const pdf = await upload(client, "doc.pdf", PDF);
    const viewer = await client.get(`/drive/files/${pdf.id}/preview`);
    expect(viewer.headers["content-type"]).toBe("application/pdf");
    expect(viewer.headers["content-security-policy"]).not.toContain("sandbox");
    expect(viewer.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
  });

  it("saves to a computer with a confirmed, single-use, short-lived ticket", async () => {
    const { client, email } = await account("drive-save");
    const content = randomBytes(1024 * 1024 + 123);
    const file = await upload(client, "archive.bin", content);

    await h.expireConfirmation(email);
    const stale = await client.post(`/drive/files/${file.id}/download-ticket`);
    expect(stale.statusCode).toBe(403);
    expect(h.errorOf(stale).code).toBe("reauthentication_required");
    const reauth = await client.post("/auth/reauthenticate", { password: "violet-harbor-lantern" });
    expect(reauth.statusCode).toBe(200);

    const issued = await client.post(`/drive/files/${file.id}/download-ticket`);
    expect(issued.statusCode, issued.body).toBe(200);
    const ticket = downloadTicketSchema.parse(issued.json());
    expect(new Date(ticket.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60_000);
    expect(ticket.url).toMatch(
      /^\/api\/v1\/drive\/files\/[0-9a-f-]+\/content\?ticket=[A-Za-z0-9_-]{43}$/,
    );
    expect(await h.eventTypes(email)).toContain("drive.file_saved");

    // No cookie: the ticket is the credential.
    const anonymous = h.browser();
    const download = await anonymous.get(ticket.url.replace("/api/v1", ""));
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-disposition"]).toContain("attachment;");
    expect(download.headers["content-disposition"]).toContain("archive.bin");
    expect(download.headers["content-type"]).toBe("application/octet-stream");
    expect(download.rawPayload.equals(content)).toBe(true);

    // Once only.
    const again = await anonymous.get(ticket.url.replace("/api/v1", ""));
    expect(again.statusCode).toBe(400);
    expect(h.errorOf(again).code).toBe("token_invalid");

    // A ticket for one file can't fetch another.
    const second = await upload(client, "other.txt", Buffer.from("other"));
    const forFirst = downloadTicketSchema.parse(
      (await client.post(`/drive/files/${file.id}/download-ticket`)).json(),
    );
    const swapped = forFirst.url.replace(file.id, second.id).replace("/api/v1", "");
    expect((await anonymous.get(swapped)).statusCode).toBe(400);
    // And it was burned by the attempt.
    expect((await anonymous.get(forFirst.url.replace("/api/v1", ""))).statusCode).toBe(400);

    const garbage = await anonymous.get(`/drive/files/${file.id}/content?ticket=not-a-ticket`);
    expect(garbage.statusCode).toBe(400);
  });
});

describe("the account", () => {
  it("lists Drive in the data download and removes every object on deletion", async () => {
    const { client, email } = await account("drive-account");
    const folder = await createFolder(client, "Tax");
    await upload(client, "2026.pdf", PDF, folder.id);
    await upload(client, "readme.txt", Buffer.from("hi"));

    const exported = accountExportSchema.parse((await client.get("/account/export")).json());
    expect(exported.drive.folders).toEqual([
      { path: "/Tax", createdAt: expect.any(String) as string },
    ]);
    expect(exported.drive.files.map((file) => file.path).sort()).toEqual([
      "/Tax/2026.pdf",
      "/readme.txt",
    ]);
    expect(JSON.stringify(exported)).not.toContain("wrappedKey");
    expect(JSON.stringify(exported)).not.toContain("objectKey");

    const keys = await objectKeysOf(email);
    expect(keys).toHaveLength(2);
    const deleted = await client.post("/account/delete", { email });
    expect(deleted.statusCode).toBe(204);
    for (const key of keys) expect(await store.get(key)).toBeNull();
  });
});
