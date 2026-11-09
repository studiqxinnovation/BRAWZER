import { randomUUID } from "node:crypto";
import {
  type Bookmark,
  type BookmarkList,
  HISTORY_LIMITS,
  type HistoryEntry,
  type HistoryPage,
  type SavedTabs,
  type TabState,
} from "@brawzer/contracts";
import {
  and,
  asc,
  type DatabaseExecutor,
  type DatabaseHandle,
  desc,
  eq,
  gt,
  isNotNull,
  type ProfileRow,
  schema,
  sql,
} from "@brawzer/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AuthContext } from "../auth/session.service.js";
import { ApiException } from "../common/api-exception.js";
import { isUniqueViolation } from "../common/database-errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { SECRET_BOX } from "../crypto/crypto.module.js";
import type { SecretBox } from "../crypto/secret-box.js";
import { DATABASE } from "../database/database.module.js";
import { SecurityEventsService } from "../security-events/security-events.js";
import {
  deriveHistoryKeys,
  type HistoryKeys,
  isRecordable,
  newHistoryKey,
  openValue,
  sealValue,
  urlDigest,
} from "./history-crypto.js";

const logger = new Logger("History");

const DAY_MS = 24 * 60 * 60 * 1000;
/** Unwrapped keys are kept this long, so a session's visits don't each ask the key service. */
const KEY_CACHE_MS = 10 * 60_000;
const KEY_CACHE_SIZE = 1000;
/** Open tabs are written at most this often while a session changes them. */
const TABS_THROTTLE_MS = 2_000;

const profileNotFound = () => new ApiException("not_found", 404, "That profile doesn’t exist.");

const keyContext = (profile: { userId: string; id: string }) =>
  `profile-history:${profile.userId}:${profile.id}`;
const entryContext = (profileId: string, id: string) => `history:${profileId}:${id}`;
const bookmarkContext = (profileId: string, id: string) => `bookmark:${profileId}:${id}`;
const tabsContext = (profileId: string) => `open-tabs:${profileId}`;

interface Page {
  u: string;
  t: string;
}

function asPage(value: unknown): Page {
  const page = value as Partial<Page> | null;
  return {
    u: typeof page?.u === "string" ? page.u : "",
    t: typeof page?.t === "string" ? page.t : "",
  };
}

function asTabs(value: unknown): Page[] {
  return Array.isArray(value) ? value.map(asPage).filter((page) => isRecordable(page.u)) : [];
}

type KeyedProfile = Pick<ProfileRow, "id" | "userId" | "historyKey">;

/** What a session leaves behind, decided once when its stream opens. */
interface SessionContext {
  profile: KeyedProfile;
  recordHistory: boolean;
  keepTabs: boolean;
}

/** Follows one stream's tabs: records visits and keeps the profile's open tabs current. */
export interface SessionObserver {
  tabs(tabs: readonly TabState[]): void;
  /** Writes what is still waiting; the stream is closing. */
  close(): Promise<void>;
}

/**
 * History, bookmarks and open tabs as Brawzer's own records (Phase 8, ideas
 * 2 and 3; ADR 0020). Everything is encrypted with the profile's own key,
 * itself sealed by the key service; nothing here is logged with an address.
 */
@Injectable()
export class HistoryService {
  private readonly keys = new Map<string, { keys: HistoryKeys; expires: number }>();

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
  ) {}

  // ── Keys ───────────────────────────────────────────────────────────────

  /** The profile's keys; made on first use when `create`, else null while it has none. */
  private async keysFor(profile: KeyedProfile, create: boolean): Promise<HistoryKeys | null> {
    const cached = this.keys.get(profile.id);
    if (cached && cached.expires > Date.now()) return cached.keys;
    let sealed = profile.historyKey;
    if (!sealed) {
      const [current] = await this.database.db
        .select({ historyKey: schema.profiles.historyKey })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, profile.id));
      sealed = current?.historyKey ?? null;
    }
    if (!sealed) {
      if (!create) return null;
      const master = newHistoryKey();
      const candidate = await this.box.seal(master.toString("base64"), keyContext(profile));
      master.fill(0);
      // Two first visits at once: whichever key is stored first is the profile's.
      await this.database.db
        .update(schema.profiles)
        .set({ historyKey: candidate })
        .where(and(eq(schema.profiles.id, profile.id), sql`${schema.profiles.historyKey} is null`));
      const [stored] = await this.database.db
        .select({ historyKey: schema.profiles.historyKey })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, profile.id));
      sealed = stored?.historyKey ?? null;
      if (!sealed) throw profileNotFound();
    }
    const master = Buffer.from(await this.box.open(sealed, keyContext(profile)), "base64");
    const keys = deriveHistoryKeys(master);
    master.fill(0);
    if (this.keys.size >= KEY_CACHE_SIZE) {
      const oldest = this.keys.keys().next().value;
      if (oldest !== undefined) this.forget(oldest);
    }
    this.keys.set(profile.id, { keys, expires: Date.now() + KEY_CACHE_MS });
    return keys;
  }

  private forget(profileId: string): void {
    const cached = this.keys.get(profileId);
    if (cached) {
      cached.keys.encrypt.fill(0);
      cached.keys.digest.fill(0);
    }
    this.keys.delete(profileId);
  }

  private async profileOf(userId: string, profileId: string): Promise<ProfileRow> {
    const [row] = await this.database.db
      .select()
      .from(schema.profiles)
      .where(and(eq(schema.profiles.id, profileId), eq(schema.profiles.userId, userId)));
    if (!row) throw profileNotFound();
    return row;
  }

  // ── History ────────────────────────────────────────────────────────────

  /** A visit: one row per address, its count and time brought up to date. */
  async recordVisit(
    profile: KeyedProfile,
    url: string,
    title: string,
    counted = true,
  ): Promise<void> {
    if (!isRecordable(url)) return;
    const keys = await this.keysFor(profile, true);
    if (!keys) return;
    const digest = urlDigest(keys, url);
    const page: Page = { u: url, t: title.slice(0, 1024) };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const [existing] = await this.database.db
        .select({ id: schema.profileHistory.id })
        .from(schema.profileHistory)
        .where(
          and(
            eq(schema.profileHistory.profileId, profile.id),
            eq(schema.profileHistory.urlDigest, digest),
          ),
        );
      if (existing) {
        await this.database.db
          .update(schema.profileHistory)
          .set({
            entry: sealValue(keys, entryContext(profile.id, existing.id), page),
            ...(counted
              ? { lastVisitedAt: new Date(), visits: sql`${schema.profileHistory.visits} + 1` }
              : {}),
          })
          .where(eq(schema.profileHistory.id, existing.id));
        return;
      }
      const id = randomUUID();
      try {
        await this.database.db.insert(schema.profileHistory).values({
          id,
          profileId: profile.id,
          urlDigest: digest,
          entry: sealValue(keys, entryContext(profile.id, id), page),
        });
        return;
      } catch (error) {
        // Recorded by another write in the meantime: update that row instead.
        if (!isUniqueViolation(error)) throw error;
      }
    }
  }

  /** Newest first, filtered by `q` across address and title, a page at a time. */
  async history(
    userId: string,
    profileId: string,
    query: { q?: string | undefined; cursor?: string | undefined },
  ): Promise<HistoryPage> {
    const profile = await this.profileOf(userId, profileId);
    const keys = await this.keysFor(profile, false);
    const entries: HistoryEntry[] = [];
    if (keys) {
      const rows = await this.database.db
        .select()
        .from(schema.profileHistory)
        .where(eq(schema.profileHistory.profileId, profile.id))
        .orderBy(desc(schema.profileHistory.lastVisitedAt))
        .limit(HISTORY_LIMITS.maxEntries);
      const needle = query.q?.toLowerCase() ?? "";
      for (const row of rows) {
        const page = this.openEntry(keys, row.profileId, row.id, row.entry);
        if (!page) continue;
        if (
          needle &&
          !page.u.toLowerCase().includes(needle) &&
          !page.t.toLowerCase().includes(needle)
        ) {
          continue;
        }
        entries.push({
          id: row.id,
          url: page.u,
          title: page.t,
          firstVisitedAt: row.firstVisitedAt.toISOString(),
          lastVisitedAt: row.lastVisitedAt.toISOString(),
          visits: row.visits,
        });
      }
    }
    const start = query.cursor ? Number(query.cursor) : 0;
    const end = start + HISTORY_LIMITS.pageSize;
    return {
      entries: entries.slice(start, end),
      next: end < entries.length ? String(end) : null,
      keepHistory: profile.keepHistory,
      recording: profile.keepHistory && profile.keepData,
    };
  }

  private openEntry(keys: HistoryKeys, profileId: string, id: string, sealed: string): Page | null {
    try {
      return asPage(openValue(keys, entryContext(profileId, id), sealed));
    } catch {
      logger.warn(`A history entry of profile ${profileId} could not be opened`);
      return null;
    }
  }

  async deleteEntry(userId: string, profileId: string, id: string): Promise<void> {
    const profile = await this.profileOf(userId, profileId);
    const removed = await this.database.db
      .delete(schema.profileHistory)
      .where(and(eq(schema.profileHistory.id, id), eq(schema.profileHistory.profileId, profile.id)))
      .returning({ id: schema.profileHistory.id });
    if (removed.length === 0) {
      throw new ApiException("not_found", 404, "That page isn’t in the history.");
    }
  }

  /** Clears the history and the saved tabs; bookmarks stay. */
  async clear(auth: AuthContext, profileId: string, meta: RequestMeta): Promise<void> {
    const profile = await this.profileOf(auth.user.id, profileId);
    await this.clearFor(profile.id);
    await this.events.record({
      type: "profile.history_cleared",
      userId: auth.user.id,
      sessionId: auth.session.id,
      meta,
    });
  }

  /** For "Clear data" and the history page: history and saved tabs go, bookmarks stay. */
  async clearFor(profileId: string, executor: DatabaseExecutor = this.database.db): Promise<void> {
    await executor
      .delete(schema.profileHistory)
      .where(eq(schema.profileHistory.profileId, profileId));
    await executor
      .update(schema.profiles)
      .set({ openTabs: null, openTabsAt: null, openTabsHandedOff: false })
      .where(eq(schema.profiles.id, profileId));
  }

  // ── Bookmarks ──────────────────────────────────────────────────────────

  async bookmarks(userId: string, profileId: string): Promise<BookmarkList> {
    const profile = await this.profileOf(userId, profileId);
    const keys = await this.keysFor(profile, false);
    const bookmarks: Bookmark[] = [];
    if (keys) {
      const rows = await this.database.db
        .select()
        .from(schema.profileBookmarks)
        .where(eq(schema.profileBookmarks.profileId, profile.id))
        .orderBy(asc(schema.profileBookmarks.createdAt));
      for (const row of rows) {
        try {
          const page = asPage(openValue(keys, bookmarkContext(row.profileId, row.id), row.entry));
          bookmarks.push({
            id: row.id,
            url: page.u,
            title: page.t,
            createdAt: row.createdAt.toISOString(),
          });
        } catch {
          logger.warn(`A bookmark of profile ${row.profileId} could not be opened`);
        }
      }
    }
    return { bookmarks, limit: HISTORY_LIMITS.maxBookmarks };
  }

  /** Bookmarks a page; bookmarking it again keeps the one there is. */
  async addBookmark(
    userId: string,
    profileId: string,
    input: { url: string; title: string },
  ): Promise<{ bookmark: Bookmark; created: boolean }> {
    const profile = await this.profileOf(userId, profileId);
    const keys = await this.keysFor(profile, true);
    if (!keys) throw profileNotFound();
    const digest = urlDigest(keys, input.url);
    const existing = await this.findBookmark(keys, profile.id, digest);
    if (existing) return { bookmark: existing, created: false };
    const [count] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.profileBookmarks)
      .where(eq(schema.profileBookmarks.profileId, profile.id));
    if ((count?.count ?? 0) >= HISTORY_LIMITS.maxBookmarks) {
      throw new ApiException(
        "limit_reached",
        409,
        `A profile keeps up to ${String(HISTORY_LIMITS.maxBookmarks)} bookmarks. Remove one first.`,
      );
    }
    const id = randomUUID();
    const page: Page = { u: input.url, t: input.title };
    try {
      const [row] = await this.database.db
        .insert(schema.profileBookmarks)
        .values({
          id,
          profileId: profile.id,
          urlDigest: digest,
          entry: sealValue(keys, bookmarkContext(profile.id, id), page),
        })
        .returning();
      if (!row) throw new Error("Bookmark insert returned nothing");
      return {
        bookmark: { id, url: page.u, title: page.t, createdAt: row.createdAt.toISOString() },
        created: true,
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findBookmark(keys, profile.id, digest);
      if (!raced) throw error;
      return { bookmark: raced, created: false };
    }
  }

  private async findBookmark(
    keys: HistoryKeys,
    profileId: string,
    digest: string,
  ): Promise<Bookmark | null> {
    const [row] = await this.database.db
      .select()
      .from(schema.profileBookmarks)
      .where(
        and(
          eq(schema.profileBookmarks.profileId, profileId),
          eq(schema.profileBookmarks.urlDigest, digest),
        ),
      );
    if (!row) return null;
    const page = asPage(openValue(keys, bookmarkContext(profileId, row.id), row.entry));
    return { id: row.id, url: page.u, title: page.t, createdAt: row.createdAt.toISOString() };
  }

  async renameBookmark(
    userId: string,
    profileId: string,
    id: string,
    title: string,
  ): Promise<Bookmark> {
    const profile = await this.profileOf(userId, profileId);
    const keys = await this.keysFor(profile, false);
    const [row] = keys
      ? await this.database.db
          .select()
          .from(schema.profileBookmarks)
          .where(
            and(
              eq(schema.profileBookmarks.id, id),
              eq(schema.profileBookmarks.profileId, profile.id),
            ),
          )
      : [];
    if (!keys || !row) throw new ApiException("not_found", 404, "That bookmark doesn’t exist.");
    const page = {
      ...asPage(openValue(keys, bookmarkContext(profile.id, id), row.entry)),
      t: title,
    };
    await this.database.db
      .update(schema.profileBookmarks)
      .set({ entry: sealValue(keys, bookmarkContext(profile.id, id), page) })
      .where(eq(schema.profileBookmarks.id, id));
    return { id, url: page.u, title: page.t, createdAt: row.createdAt.toISOString() };
  }

  async removeBookmark(userId: string, profileId: string, id: string): Promise<void> {
    const profile = await this.profileOf(userId, profileId);
    const removed = await this.database.db
      .delete(schema.profileBookmarks)
      .where(
        and(eq(schema.profileBookmarks.id, id), eq(schema.profileBookmarks.profileId, profile.id)),
      )
      .returning({ id: schema.profileBookmarks.id });
    if (removed.length === 0)
      throw new ApiException("not_found", 404, "That bookmark doesn’t exist.");
  }

  // ── Open tabs (idea 3) ─────────────────────────────────────────────────

  private async saveTabs(profile: KeyedProfile, tabs: readonly Page[]): Promise<void> {
    const keys = await this.keysFor(profile, true);
    if (!keys) return;
    await this.database.db
      .update(schema.profiles)
      .set({ openTabs: sealValue(keys, tabsContext(profile.id), tabs), openTabsAt: new Date() })
      .where(eq(schema.profiles.id, profile.id));
  }

  /** The tabs each of the account's profiles last left open, while they are still offered. */
  async savedTabsFor(userId: string): Promise<SavedTabs[]> {
    const rows = await this.database.db
      .select()
      .from(schema.profiles)
      .where(
        and(
          eq(schema.profiles.userId, userId),
          isNotNull(schema.profiles.openTabs),
          gt(
            schema.profiles.openTabsAt,
            new Date(Date.now() - HISTORY_LIMITS.openTabsDays * DAY_MS),
          ),
        ),
      );
    const saved: SavedTabs[] = [];
    for (const row of rows) {
      if (!row.openTabs || !row.openTabsAt) continue;
      const keys = await this.keysFor(row, false);
      if (!keys) continue;
      try {
        const tabs = asTabs(openValue(keys, tabsContext(row.id), row.openTabs));
        if (tabs.length === 0) continue;
        saved.push({
          profileId: row.id,
          savedAt: row.openTabsAt.toISOString(),
          handedOff: row.openTabsHandedOff,
          tabs: tabs.map((tab) => ({ url: tab.u, title: tab.t })),
        });
      } catch {
        logger.warn(`The saved tabs of profile ${row.id} could not be opened`);
      }
    }
    return saved;
  }

  /** A session starting: it reopens the profile's saved tabs when asked to. */
  async prepareSession(
    sessionId: string,
    profileId: string,
    resume: boolean,
    executor: DatabaseExecutor = this.database.db,
  ): Promise<void> {
    if (resume) {
      await executor.execute(sql`
        update browser_sessions set restore_tabs = p.open_tabs
        from profiles p where browser_sessions.id = ${sessionId} and p.id = ${profileId}
      `);
    }
    await executor
      .update(schema.profiles)
      .set({ openTabsHandedOff: false })
      .where(eq(schema.profiles.id, profileId));
  }

  /** The tabs to reopen, once: the first stream of a resumed session takes them. */
  async claimRestore(sessionId: string): Promise<string[]> {
    // The row is locked while it's read, so two streams can't both take the tabs.
    const claimed = await this.database.pool.query<{ restore_tabs: string; profile_id: string }>(
      `with old as (
         select id, restore_tabs, profile_id from browser_sessions
         where id = $1 and restore_tabs is not null and profile_id is not null
         for update
       )
       update browser_sessions s set restore_tabs = null from old where s.id = old.id
       returning old.restore_tabs, old.profile_id`,
      [sessionId],
    );
    const taken = claimed.rows[0];
    if (!taken) return [];
    const [profile] = await this.database.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, taken.profile_id));
    const keys = profile ? await this.keysFor(profile, false) : null;
    if (!keys) return [];
    try {
      return asTabs(openValue(keys, tabsContext(taken.profile_id), taken.restore_tabs))
        .slice(0, HISTORY_LIMITS.maxOpenTabs)
        .map((tab) => tab.u);
    } catch {
      logger.warn(`The tabs to reopen in session ${sessionId} could not be opened`);
      return [];
    }
  }

  /** Marks the profile's saved tabs as handed off on purpose (the session is ending). */
  async markHandedOff(profileId: string): Promise<void> {
    await this.database.db
      .update(schema.profiles)
      .set({ openTabsHandedOff: true })
      .where(eq(schema.profiles.id, profileId));
  }

  // ── Following a session ────────────────────────────────────────────────

  private async contextOf(sessionId: string): Promise<SessionContext | null> {
    const [row] = await this.database.db
      .select({ profile: schema.profiles })
      .from(schema.browserSessions)
      .innerJoin(schema.profiles, eq(schema.profiles.id, schema.browserSessions.profileId))
      .where(eq(schema.browserSessions.id, sessionId));
    if (!row) return null;
    const { profile } = row;
    return {
      profile,
      recordHistory: profile.keepData && profile.keepHistory,
      keepTabs: profile.keepData,
    };
  }

  /**
   * Follows a stream's tabs. Visits are recorded when a page has finished
   * loading without an error; a temporary session, or a profile that keeps
   * nothing, leaves nothing. Writes for one stream run one after another.
   */
  observe(sessionId: string): SessionObserver {
    const context = this.contextOf(sessionId).catch((error: unknown) => {
      logger.warn(`Session ${sessionId}: ${error instanceof Error ? error.message : "unknown"}`);
      return null;
    });
    const seen = new Map<string, Page>();
    let chain: Promise<void> = Promise.resolve();
    let sawPage = false;
    let lastSaved = "";
    let pending: Page[] | null = null;
    let timer: NodeJS.Timeout | undefined;
    let savedAt = 0;
    const run = (work: (ctx: SessionContext) => Promise<void>) => {
      chain = chain
        .then(async () => {
          const ctx = await context;
          if (ctx) await work(ctx);
        })
        .catch((error: unknown) => {
          logger.warn(
            `Session ${sessionId}: history not written: ${error instanceof Error ? error.message : "unknown"}`,
          );
        });
    };
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      const tabs = pending;
      pending = null;
      if (!tabs) return;
      savedAt = Date.now();
      run(async (ctx) => {
        if (ctx.keepTabs) await this.saveTabs(ctx.profile, tabs);
      });
    };
    return {
      tabs: (tabs) => {
        const open: Page[] = [];
        const present = new Set<string>();
        for (const tab of tabs) {
          present.add(tab.id);
          if (!isRecordable(tab.url)) continue;
          sawPage = true;
          open.push({ u: tab.url, t: tab.title });
          if (tab.loading || tab.error !== null) continue;
          const before = seen.get(tab.id);
          if (before?.u === tab.url && (before.t === tab.title || tab.title === "")) continue;
          const counted = before?.u !== tab.url;
          seen.set(tab.id, { u: tab.url, t: tab.title });
          run(async (ctx) => {
            if (ctx.recordHistory) await this.recordVisit(ctx.profile, tab.url, tab.title, counted);
          });
        }
        for (const id of seen.keys()) if (!present.has(id)) seen.delete(id);
        // A session that never showed a page doesn't replace what the last one left.
        if (!sawPage) return;
        const serialized = JSON.stringify(open.slice(0, HISTORY_LIMITS.maxOpenTabs));
        if (serialized === lastSaved) return;
        lastSaved = serialized;
        pending = open.slice(0, HISTORY_LIMITS.maxOpenTabs);
        const wait = savedAt + TABS_THROTTLE_MS - Date.now();
        if (wait <= 0) flush();
        else timer ??= setTimeout(flush, wait);
      },
      close: async () => {
        flush();
        await chain;
      },
    };
  }

  // ── Account ────────────────────────────────────────────────────────────

  /** For "download your data": every profile's history and bookmarks. */
  async forExport(userId: string) {
    const profiles = await this.database.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, userId))
      .orderBy(asc(schema.profiles.position));
    const history: {
      profile: string;
      url: string;
      title: string;
      lastVisitedAt: string;
      visits: number;
    }[] = [];
    const bookmarks: { profile: string; url: string; title: string; createdAt: string }[] = [];
    for (const profile of profiles) {
      if (!profile.historyKey) continue;
      const page = await this.history(userId, profile.id, {});
      let cursor = page.next;
      const entries = [...page.entries];
      while (cursor) {
        const more = await this.history(userId, profile.id, { cursor });
        entries.push(...more.entries);
        cursor = more.next;
      }
      for (const entry of entries) {
        history.push({
          profile: profile.name,
          url: entry.url,
          title: entry.title,
          lastVisitedAt: entry.lastVisitedAt,
          visits: entry.visits,
        });
      }
      for (const bookmark of (await this.bookmarks(userId, profile.id)).bookmarks) {
        bookmarks.push({
          profile: profile.name,
          url: bookmark.url,
          title: bookmark.title,
          createdAt: bookmark.createdAt,
        });
      }
    }
    return { history, bookmarks };
  }
}
