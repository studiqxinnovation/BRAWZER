import {
  accountExportSchema,
  bookmarkListSchema,
  bookmarkSchema,
  browserOverviewSchema,
  historyPageSchema,
  profileListSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HistoryService } from "../src/history/history.service.js";
import { RetentionService } from "../src/maintenance/retention.js";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.82.0" });
  await h.listen();
});

afterAll(async () => {
  await h.close();
});

async function person(tag: string) {
  const client = h.browser();
  const email = h.uniqueEmail(tag);
  await h.signUp(client, email);
  const profile = profileListSchema.parse((await client.get("/profiles")).json()).profiles[0];
  if (!profile) throw new Error("no profile");
  return { client, email, profile };
}

async function keyed(profileId: string) {
  const result = await h.database.pool.query<{
    id: string;
    user_id: string;
    history_key: string | null;
  }>("select id, user_id, history_key from profiles where id = $1", [profileId]);
  const row = result.rows[0];
  if (!row) throw new Error("no profile row");
  return { id: row.id, userId: row.user_id, historyKey: row.history_key };
}

async function historyOf(client: TestBrowser, profileId: string, query = "") {
  const response = await client.get(`/profiles/${profileId}/history${query}`);
  expect(response.statusCode, response.body).toBe(200);
  return historyPageSchema.parse(response.json());
}

describe("history and bookmarks", () => {
  it("keeps history per profile, encrypted, searchable and forgettable one page at a time", async () => {
    const { client, profile } = await person("history");
    expect(await historyOf(client, profile.id)).toEqual({
      entries: [],
      next: null,
      keepHistory: true,
      recording: true,
    });

    const history = h.app.get(HistoryService);
    await history.recordVisit(
      await keyed(profile.id),
      "https://news.example/today",
      "Today’s news",
    );
    await history.recordVisit(await keyed(profile.id), "https://shop.example/basket", "Basket");
    await history.recordVisit(
      await keyed(profile.id),
      "https://news.example/today",
      "Today’s news",
    );
    // A title arriving later updates the entry without counting a visit.
    await history.recordVisit(
      await keyed(profile.id),
      "https://shop.example/basket",
      "Your basket",
      false,
    );
    // Brawzer's start page and anything but the web are never recorded.
    await history.recordVisit(await keyed(profile.id), "https://bee.invalid/", "New tab");
    await history.recordVisit(await keyed(profile.id), "file:///etc/passwd", "passwd");

    const page = await historyOf(client, profile.id);
    expect(page.entries.map((entry) => [entry.url, entry.title, entry.visits])).toEqual([
      ["https://news.example/today", "Today’s news", 2],
      ["https://shop.example/basket", "Your basket", 1],
    ]);
    expect(
      (await historyOf(client, profile.id, "?q=NEWS")).entries.map((entry) => entry.url),
    ).toEqual(["https://news.example/today"]);
    expect((await historyOf(client, profile.id, "?q=basket")).entries).toHaveLength(1);

    // Stored encrypted: no address, title or host in the clear.
    const stored = await h.database.pool.query<{ entry: string; url_digest: string }>(
      "select entry, url_digest from profile_history where profile_id = $1",
      [profile.id],
    );
    for (const row of stored.rows) {
      expect(`${row.entry} ${row.url_digest}`).not.toMatch(/news|shop|example|basket/i);
    }
    const key = await h.database.pool.query<{ history_key: string }>(
      "select history_key from profiles where id = $1",
      [profile.id],
    );
    expect(key.rows[0]?.history_key.startsWith("v1.")).toBe(true);

    // Nobody else reads or changes it.
    const other = await person("history-other");
    expect((await other.client.get(`/profiles/${profile.id}/history`)).statusCode).toBe(404);
    const [first] = page.entries;
    expect(
      (await other.client.delete(`/profiles/${profile.id}/history/${first?.id ?? ""}`)).statusCode,
    ).toBe(404);

    // One page at a time, then all of it; the clearing is in the security history.
    expect(
      (await client.delete(`/profiles/${profile.id}/history/${first?.id ?? ""}`)).statusCode,
    ).toBe(204);
    expect((await historyOf(client, profile.id)).entries.map((entry) => entry.url)).toEqual([
      "https://shop.example/basket",
    ]);
    expect((await client.delete(`/profiles/${profile.id}/history`)).statusCode).toBe(204);
    expect((await historyOf(client, profile.id)).entries).toEqual([]);
    expect(
      await h.eventTypes(
        (await other.client.get("/auth/session")).json<{ account: { email: string } }>().account
          .email,
      ),
    ).not.toContain("profile.history_cleared");
    const events = (await client.get("/security/events")).json<{ events: { type: string }[] }>()
      .events;
    expect(events.map((event) => event.type)).toContain("profile.history_cleared");

    // Switched off, nothing new is recorded.
    const off = await client.patch(`/profiles/${profile.id}`, { keepHistory: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json<{ keepHistory: boolean }>().keepHistory).toBe(false);
    expect((await historyOf(client, profile.id)).recording).toBe(false);
  });

  it("keeps bookmarks: one per page, renamed, removed, and kept through clearing data", async () => {
    const { client, profile } = await person("bookmarks");
    const url = `/profiles/${profile.id}/bookmarks`;
    const created = await client.post(url, { url: "https://docs.example/guide", title: "Guide" });
    expect(created.statusCode, created.body).toBe(201);
    const bookmark = bookmarkSchema.parse(created.json());
    const again = await client.post(url, { url: "https://docs.example/guide", title: "Other" });
    expect(again.statusCode).toBe(200);
    expect(bookmarkSchema.parse(again.json()).id).toBe(bookmark.id);
    for (const body of [
      { url: "javascript:alert(1)" },
      { url: "file:///etc/passwd" },
      { url: "not a url" },
      { url: "https://x.example/", title: "x".repeat(301) },
    ]) {
      expect((await client.post(url, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    const renamed = await client.patch(`${url}/${bookmark.id}`, { title: "The guide" });
    expect(bookmarkSchema.parse(renamed.json()).title).toBe("The guide");
    expect((await client.post(url, { url: "https://docs.example/faq" })).statusCode).toBe(201);
    const list = bookmarkListSchema.parse((await client.get(url)).json());
    expect(list.bookmarks.map((entry) => [entry.url, entry.title])).toEqual([
      ["https://docs.example/guide", "The guide"],
      ["https://docs.example/faq", ""],
    ]);

    // Clearing the profile's data clears history and saved tabs, not bookmarks.
    await h.app
      .get(HistoryService)
      .recordVisit(await keyed(profile.id), "https://docs.example/guide", "Guide");
    expect((await client.delete(`/profiles/${profile.id}/data`)).statusCode).toBe(200);
    expect((await historyOf(client, profile.id)).entries).toEqual([]);
    expect(bookmarkListSchema.parse((await client.get(url)).json()).bookmarks).toHaveLength(2);

    // The data download has them, by profile name.
    await h.app
      .get(HistoryService)
      .recordVisit(await keyed(profile.id), "https://docs.example/faq", "FAQ");
    const exported = accountExportSchema.parse((await client.get("/account/export")).json());
    expect(exported.bookmarks.map((entry) => [entry.profile, entry.url])).toEqual([
      ["Personal", "https://docs.example/guide"],
      ["Personal", "https://docs.example/faq"],
    ]);
    expect(exported.history.map((entry) => entry.url)).toEqual(["https://docs.example/faq"]);

    expect((await client.delete(`${url}/${bookmark.id}`)).statusCode).toBe(204);
    expect((await client.delete(`${url}/${bookmark.id}`)).statusCode).toBe(404);
    const other = await person("bookmarks-other");
    expect((await other.client.get(url)).statusCode).toBe(404);
  });

  it("lets retention forget old pages and old saved tabs", async () => {
    const { client, profile } = await person("history-retention");
    const history = h.app.get(HistoryService);
    await history.recordVisit(await keyed(profile.id), "https://old.example/", "Old");
    await history.recordVisit(await keyed(profile.id), "https://new.example/", "New");
    await h.database.pool.query(
      `update profile_history set last_visited_at = now() - interval '91 days'
       where profile_id = $1 and visits = 1 and first_visited_at = (
         select min(first_visited_at) from profile_history where profile_id = $1)`,
      [profile.id],
    );
    // Saved tabs from eight days ago are no longer offered, then forgotten.
    const observer = history.observe("00000000-0000-0000-0000-000000000000");
    await observer.close();
    await h.database.pool.query(
      "update profiles set open_tabs = 'x', open_tabs_at = now() - interval '8 days' where id = $1",
      [profile.id],
    );
    expect(browserOverviewSchema.parse((await client.get("/browser")).json()).savedTabs).toEqual(
      [],
    );

    expect(await h.app.get(RetentionService).run()).not.toBeNull();
    expect((await historyOf(client, profile.id)).entries.map((entry) => entry.url)).toEqual([
      "https://new.example/",
    ]);
    const tabs = await h.database.pool.query<{ open_tabs: string | null }>(
      "select open_tabs from profiles where id = $1",
      [profile.id],
    );
    expect(tabs.rows[0]?.open_tabs).toBeNull();
  });
});
