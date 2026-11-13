import { randomBytes, randomUUID } from "node:crypto";
import {
  accountExportSchema,
  adminPageReportListSchema,
  adminPageReportPictureSchema,
  pageReportCreatedSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RetentionService } from "../src/maintenance/retention.js";
import { createHarness, type Harness } from "./support/harness.js";

const ADMIN_EMAIL = `admin-reports-${Date.now().toString(36)}@brawzer.test`;
let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.80.0", env: { ADMIN_EMAILS: ADMIN_EMAIL } });
  await h.listen();
});

afterAll(async () => {
  await h.close();
});

/** Enough of a JPEG for the API: its start and end markers around some bytes. */
const jpeg = (size: number) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    randomBytes(size),
    Buffer.from([0xff, 0xd9]),
  ]);

const report = (overrides: Record<string, unknown> = {}) => ({
  kind: "broken",
  message: "The checkout button does nothing.",
  url: "https://shop.example/checkout",
  title: "Checkout",
  errorCode: null,
  sessionId: null,
  picture: null,
  ...overrides,
});

describe("reporting a page", () => {
  it("keeps what was sent, shows it to administrators, and deletes the picture on closing", async () => {
    const user = h.browser();
    const email = h.uniqueEmail("reports");
    await h.signUp(user, email);

    // Without a picture, and with someone else's (or no) session: no session is recorded.
    const plain = await user.post("/reports", report({ sessionId: randomUUID() }));
    expect(plain.statusCode, plain.body).toBe(201);
    const plainId = pageReportCreatedSchema.parse(plain.json()).id;

    const picture = jpeg(20_000).toString("base64");
    const withPicture = await user.post(
      "/reports",
      report({
        kind: "blocked",
        url: null,
        title: null,
        errorCode: "BRAWZER_REFUSED_PORT",
        picture,
      }),
    );
    expect(withPicture.statusCode, withPicture.body).toBe(201);
    const pictureId = pageReportCreatedSchema.parse(withPicture.json()).id;

    // Only a whole JPEG, under the size limit; and a message is needed.
    for (const [body, detail] of [
      [
        report({ picture: Buffer.from("GIF89a....").toString("base64") }),
        "picture: The picture must be a JPEG.",
      ],
      [
        report({ picture: jpeg(20).subarray(0, 18).toString("base64") }),
        "picture: The picture must be a whole JPEG",
      ],
      [report({ picture: jpeg(700_000).toString("base64") }), "picture: The picture is too large."],
      [report({ message: "   " }), "message: Say what went wrong."],
      [report({ kind: "rude" }), "kind: Choose what went wrong."],
    ] as const) {
      const response = await user.post("/reports", body);
      expect(response.statusCode).toBe(400);
      expect(h.errorOf(response).details?.join("\n")).toContain(detail);
    }

    // The sender's security history says a page was reported, and whether a picture went too.
    const history = (await user.get("/security/events")).json<{
      events: { type: string; details: { kind?: string; picture?: boolean } }[];
    }>();
    const reported = history.events.filter((event) => event.type === "browser.page_reported");
    expect(reported.map((event) => event.details)).toEqual([
      { kind: "blocked", picture: true },
      { kind: "broken", picture: false },
    ]);

    // Administrators only.
    expect((await user.get("/admin/reports")).statusCode).toBe(403);
    expect((await user.get(`/admin/reports/${pictureId}/picture`)).statusCode).toBe(403);
    expect((await user.post(`/admin/reports/${pictureId}/close`, {})).statusCode).toBe(403);

    const admin = h.browser();
    await h.signUp(admin, ADMIN_EMAIL);
    const open = adminPageReportListSchema.parse((await admin.get("/admin/reports")).json());
    const mine = open.reports.filter((entry) => entry.account.email === email);
    expect(mine.map((entry) => [entry.id, entry.kind, entry.hasPicture, entry.engine])).toEqual([
      [pictureId, "blocked", true, null],
      [plainId, "broken", false, null],
    ]);
    expect(mine[0]?.errorCode).toBe("BRAWZER_REFUSED_PORT");
    expect(mine[1]).toMatchObject({ url: "https://shop.example/checkout", title: "Checkout" });
    expect(open.open).toBeGreaterThanOrEqual(2);

    const shown = await admin.get(`/admin/reports/${pictureId}/picture`);
    expect(shown.statusCode, shown.body).toBe(200);
    expect(shown.headers["cache-control"]).toBe("no-store");
    expect(adminPageReportPictureSchema.parse(shown.json()).picture).toBe(picture);
    // Sealed at rest, never stored as sent.
    const stored = await h.database.pool.query<{ picture: string }>(
      "select picture from page_reports where id = $1",
      [pictureId],
    );
    expect(stored.rows[0]?.picture.startsWith("v1.")).toBe(true);
    expect(stored.rows[0]?.picture).not.toContain(picture.slice(0, 40));

    // Closing deletes the picture at once.
    expect((await admin.post(`/admin/reports/${pictureId}/close`, {})).statusCode).toBe(204);
    expect((await admin.post(`/admin/reports/${pictureId}/close`, {})).statusCode).toBe(204);
    expect((await admin.post(`/admin/reports/${randomUUID()}/close`, {})).statusCode).toBe(404);
    expect((await admin.get(`/admin/reports/${pictureId}/picture`)).statusCode).toBe(404);
    const closed = adminPageReportListSchema.parse(
      (await admin.get("/admin/reports?state=closed")).json(),
    );
    expect(closed.reports.find((entry) => entry.id === pictureId)).toMatchObject({
      hasPicture: false,
    });
    const stillOpen = adminPageReportListSchema.parse((await admin.get("/admin/reports")).json());
    expect(stillOpen.reports.some((entry) => entry.id === pictureId)).toBe(false);

    // The sender's data download lists their reports.
    const exported = accountExportSchema.parse((await user.get("/account/export")).json());
    expect(exported.pageReports.map((entry) => [entry.kind, entry.hasPicture])).toEqual([
      ["blocked", false],
      ["broken", false],
    ]);

    // Ten an hour.
    for (let sent = 2; sent < 10; sent += 1) {
      expect((await user.post("/reports", report())).statusCode).toBe(201);
    }
    expect((await user.post("/reports", report())).statusCode).toBe(429);
  });

  it("lets retention delete old pictures and long-closed reports", async () => {
    const user = h.browser();
    await h.signUp(user, h.uniqueEmail("reports-retention"));
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const sent = await user.post("/reports", report({ picture: jpeg(100).toString("base64") }));
      expect(sent.statusCode, sent.body).toBe(201);
      ids.push(pageReportCreatedSchema.parse(sent.json()).id);
    }
    const [old, longClosed, fresh] = ids;
    await h.database.pool.query(
      "update page_reports set created_at = now() - interval '31 days' where id = $1",
      [old],
    );
    await h.database.pool.query(
      "update page_reports set closed_at = now() - interval '91 days' where id = $1",
      [longClosed],
    );

    expect(await h.app.get(RetentionService).run()).not.toBeNull();
    const rows = await h.database.pool.query<{ id: string; has_picture: boolean }>(
      "select id, picture is not null as has_picture from page_reports where id = any($1)",
      [ids],
    );
    const state = Object.fromEntries(rows.rows.map((row) => [row.id, row.has_picture]));
    expect(state).toEqual({ [old ?? ""]: false, [fresh ?? ""]: true });
  });
});
