import {
  accountExportSchema,
  type AgentMessage,
  agentMessageSchema,
  browserOverviewSchema,
  browserSessionSchema,
  type ClientMessageInput,
  decodeFrame,
  STREAM_CLOSE_CODES,
  streamTicketSchema,
  type TabState,
} from "@brawzer/contracts";
import { driveFileSchema, profileListSchema, profileSchema } from "@brawzer/contracts";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";

// Requires the local services (`pnpm infra:up`), the Docker engine and the
// runtime image (`pnpm runtime:build`). Each test starts a real container.
let h: Harness;
let baseUrl: string;

/** Small, so an over-limit download is quick to produce. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const EICAR = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`;

beforeAll(async () => {
  h = await createHarness({
    ipPrefix: "100.69.0",
    env: { BROWSER_TEST_SITE: "true", DRIVE_MAX_FILE_BYTES: String(MAX_FILE_BYTES) },
  });
  baseUrl = await h.listen();
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

async function startSession(client: TestBrowser) {
  const response = await client.post("/browser/sessions", {});
  expect(response.statusCode, response.body).toBe(201);
  return browserSessionSchema.parse(response.json());
}

async function ticketFor(client: TestBrowser, id: string) {
  const response = await client.post(`/browser/sessions/${id}/ticket`, {});
  expect(response.statusCode, response.body).toBe(200);
  return streamTicketSchema.parse(response.json());
}

/** A test viewer: opens the stream with a ticket and collects what arrives. */
class Viewer {
  readonly messages: AgentMessage[] = [];
  readonly frames: { tabId: string; frameId: number; bytes: number }[] = [];
  closeCode: number | null = null;
  private readonly socket: WebSocket;
  private waiters: (() => void)[] = [];

  constructor(url: string, ticket: string, origin: string) {
    this.socket = new WebSocket(url.replace(/^http/, "ws"), { headers: { origin } });
    this.socket.binaryType = "nodebuffer";
    this.socket.on("open", () => {
      this.socket.send(JSON.stringify({ type: "ticket", ticket }));
      this.socket.send(
        JSON.stringify({
          type: "hello",
          viewport: { width: 800, height: 600 },
        } satisfies ClientMessageInput),
      );
    });
    this.socket.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const frame = decodeFrame(new Uint8Array(data));
        if (frame) {
          this.frames.push({ ...frame.header, bytes: frame.image.length });
          this.send({
            type: "frame-ack",
            tabId: frame.header.tabId,
            frameId: frame.header.frameId,
          });
        }
      } else {
        this.messages.push(agentMessageSchema.parse(JSON.parse(data.toString("utf8"))));
      }
      for (const waiter of this.waiters.splice(0)) waiter();
    });
    this.socket.on("close", (code) => {
      this.closeCode = code;
      for (const waiter of this.waiters.splice(0)) waiter();
    });
    this.socket.on("error", (error) => {
      console.error("viewer socket error", error.message);
    });
    this.socket.on("unexpected-response", (_req, res) => {
      console.error("viewer unexpected response", res.statusCode);
    });
  }

  send(message: ClientMessageInput): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Waits until `predicate` holds for the messages seen so far. */
  async until(predicate: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) {
        const last = this.messages.at(-1);
        throw new Error(
          `Timed out waiting for ${label} (close code ${String(this.closeCode)}, ${String(this.messages.length)} messages, ${String(this.frames.length)} frames, last: ${last ? JSON.stringify(last).slice(0, 800) : "none"})`,
        );
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 200);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  tabs(): { tabs: TabState[]; activeTabId: string } | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i]!;
      if (message.type === "tabs" || message.type === "welcome") return message;
    }
    return undefined;
  }

  activeTab(): TabState | undefined {
    const snapshot = this.tabs();
    return snapshot?.tabs.find((tab) => tab.id === snapshot.activeTabId);
  }

  close(): void {
    this.socket.close();
  }
}

/** Starts a session and a viewer on it, and waits for the engine's welcome. */
async function openSession(client: TestBrowser, profileId?: string) {
  const response = await client.post("/browser/sessions", profileId ? { profileId } : {});
  expect(response.statusCode, response.body).toBe(201);
  const session = browserSessionSchema.parse(response.json());
  const ticket = await ticketFor(client, session.id);
  const viewer = new Viewer(
    `${baseUrl}/api/v1/browser/sessions/${session.id}/stream`,
    ticket.ticket,
    h.origin,
  );
  await viewer.until(() => viewer.messages.some((m) => m.type === "welcome"), "welcome");
  return { session, viewer, tab: viewer.activeTab()! };
}

/** Navigates the viewer's active tab and waits until the title is `title`. */
async function openPage(viewer: Viewer, tabId: string, url: string, title: string) {
  viewer.send({ type: "navigate", tabId, url });
  await viewer.until(
    () => viewer.activeTab()?.title === title && !viewer.activeTab()?.loading,
    `page titled ${title}`,
  );
}

function click(viewer: Viewer, tabId: string, x: number, y: number) {
  viewer.send({
    type: "mouse",
    tabId,
    kind: "down",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  viewer.send({ type: "mouse", tabId, kind: "up", x, y, button: "left", clickCount: 1 });
}

describe("cloud browser sessions", () => {
  it("reports no session and a reachable runtime before anything starts", async () => {
    const { client } = await account("browser-overview");
    const response = await client.get("/browser");
    expect(response.statusCode).toBe(200);
    const overview = browserOverviewSchema.parse(response.json());
    expect(overview.session).toBeNull();
    expect(overview.runtime).toBe("available");
    expect(overview.limits).toEqual({ idleMinutes: 15, maxHours: 4 });
  });

  it("starts a session, streams the page, browses the test site and ends", async () => {
    const { client, email } = await account("browser-session");
    const session = await startSession(client);
    expect(session.status).toBe("running");
    expect(session.startedAt).not.toBeNull();

    // One live session per account.
    const second = await client.post("/browser/sessions", {});
    expect(second.statusCode).toBe(409);

    const overview = browserOverviewSchema.parse((await client.get("/browser")).json());
    expect(overview.session?.id).toBe(session.id);

    const ticket = await ticketFor(client, session.id);
    expect(ticket.url).toBe(`ws://127.0.0.1:4100/api/v1/browser/sessions/${session.id}/stream`);
    const viewer = new Viewer(
      `${baseUrl}/api/v1/browser/sessions/${session.id}/stream`,
      ticket.ticket,
      h.origin,
    );
    await viewer.until(() => viewer.messages.some((m) => m.type === "welcome"), "welcome");
    const welcome = viewer.messages.find((m) => m.type === "welcome");
    expect(welcome?.type === "welcome" && welcome.engine.name).toBe("chromium");
    const tab = viewer.activeTab();
    expect(tab).toBeDefined();

    // The test site over HTTPS: the proxy's CONNECT tunnel, with the engine
    // trusting the site's own certificate and nothing else.
    viewer.send({ type: "navigate", tabId: tab!.id, url: "https://testsite.invalid/second" });
    await viewer.until(
      () => viewer.activeTab()?.title === "Second page" && !viewer.activeTab()?.loading,
      "test site over https",
    );
    expect(viewer.activeTab()).toMatchObject({ url: "https://testsite.invalid/second" });

    // The test site, through the filtering proxy.
    viewer.send({ type: "navigate", tabId: tab!.id, url: "http://testsite.invalid/" });
    await viewer.until(() => viewer.activeTab()?.title === "Brawzer test site", "test site title");
    expect(viewer.activeTab()).toMatchObject({
      url: "http://testsite.invalid/",
      loading: false,
      security: "insecure",
    });
    await viewer.until(() => viewer.frames.length > 0, "a frame");
    expect(viewer.frames[0]).toMatchObject({ tabId: tab!.id, width: 800, height: 600 });
    expect(viewer.frames[0]!.bytes).toBeGreaterThan(1000);

    // A click on the "Second page" box (fixed at 40,40 → 320,96).
    const click = (kind: "down" | "up") =>
      viewer.send({
        type: "mouse",
        tabId: tab!.id,
        kind,
        x: 100,
        y: 60,
        button: "left",
        buttons: kind === "down" ? 1 : 0,
        clickCount: 1,
        modifiers: 0,
      });
    viewer.send({ type: "mouse", tabId: tab!.id, kind: "move", x: 100, y: 60 });
    click("down");
    click("up");
    await viewer.until(
      () => viewer.activeTab()?.title === "Second page" && viewer.activeTab()?.canGoBack === true,
      "second page",
    );

    viewer.send({ type: "back", tabId: tab!.id });
    await viewer.until(
      () =>
        viewer.activeTab()?.title === "Brawzer test site" &&
        viewer.activeTab()?.canGoForward === true,
      "back",
    );

    // Typing into the search field and pressing Enter submits the form.
    viewer.send({ type: "mouse", tabId: tab!.id, kind: "move", x: 100, y: 220 });
    viewer.send({
      type: "mouse",
      tabId: tab!.id,
      kind: "down",
      x: 100,
      y: 220,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    viewer.send({
      type: "mouse",
      tabId: tab!.id,
      kind: "up",
      x: 100,
      y: 220,
      button: "left",
      clickCount: 1,
    });
    for (const char of "hi") {
      viewer.send({
        type: "key",
        tabId: tab!.id,
        kind: "down",
        key: char,
        code: `Key${char.toUpperCase()}`,
        keyCode: char.toUpperCase().charCodeAt(0),
        text: char,
      });
      viewer.send({
        type: "key",
        tabId: tab!.id,
        kind: "up",
        key: char,
        code: `Key${char.toUpperCase()}`,
        keyCode: char.toUpperCase().charCodeAt(0),
      });
    }
    viewer.send({
      type: "key",
      tabId: tab!.id,
      kind: "down",
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    });
    viewer.send({
      type: "key",
      tabId: tab!.id,
      kind: "up",
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    });
    await viewer.until(() => viewer.activeTab()?.title === "Results for hi", "search results");

    // A page dialog reaches the viewer, who answers it.
    viewer.send({ type: "navigate", tabId: tab!.id, url: "http://testsite.invalid/" });
    await viewer.until(
      () => viewer.activeTab()?.title === "Brawzer test site" && !viewer.activeTab()?.loading,
      "home again",
    );
    viewer.send({ type: "mouse", tabId: tab!.id, kind: "move", x: 100, y: 140 });
    viewer.send({
      type: "mouse",
      tabId: tab!.id,
      kind: "down",
      x: 100,
      y: 140,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    viewer.send({
      type: "mouse",
      tabId: tab!.id,
      kind: "up",
      x: 100,
      y: 140,
      button: "left",
      clickCount: 1,
    });
    await viewer.until(() => viewer.messages.some((m) => m.type === "dialog"), "dialog");
    const dialog = viewer.messages.find((m) => m.type === "dialog");
    expect(dialog).toMatchObject({ kind: "alert", message: "Hello from the test site" });
    viewer.send({ type: "dialog", tabId: tab!.id, accept: true });

    // Downloads are refused and reported.
    viewer.send({ type: "mouse", tabId: tab!.id, kind: "move", x: 100, y: 300 });
    viewer.send({
      type: "mouse",
      tabId: tab!.id,
      kind: "down",
      x: 100,
      y: 300,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    viewer.send({
      type: "mouse",
      tabId: tab!.id,
      kind: "up",
      x: 100,
      y: 300,
      button: "left",
      clickCount: 1,
    });
    // The download is handed to Drive: scanned, encrypted, in the Downloads folder.
    await viewer.until(
      () => viewer.messages.some((m) => m.type === "transfer" && m.state === "saved"),
      "download saved to Drive",
    );
    const saved = viewer.messages.find((m) => m.type === "transfer" && m.state === "saved");
    expect(saved).toMatchObject({ kind: "download", filename: "brawzer-test.bin", bytes: 1024 });
    const downloads = await h.database.pool.query<{ name: string; source: string; folder: string }>(
      `select f.name, f.source, d.name as folder from drive_files f
         join users u on u.id = f.user_id join drive_folders d on d.id = f.folder_id
        where u.email = $1`,
      [email],
    );
    expect(downloads.rows).toEqual([
      { name: "brawzer-test.bin", source: "browser", folder: "Downloads" },
    ]);

    // Private addresses are blocked inside the container.
    viewer.send({ type: "navigate", tabId: tab!.id, url: "http://127.0.0.1:4100/api/v1/health" });
    await viewer.until(() => viewer.activeTab()?.title === "Blocked by Brawzer", "blocked page");

    // Tabs.
    viewer.send({ type: "new-tab", url: "http://testsite.invalid/second" });
    await viewer.until(() => (viewer.tabs()?.tabs.length ?? 0) === 2, "two tabs");
    await viewer.until(() => viewer.activeTab()?.title === "Second page", "new tab active");
    const newTab = viewer.activeTab()!;
    expect(newTab.id).not.toBe(tab!.id);
    viewer.send({ type: "close-tab", tabId: newTab.id });
    await viewer.until(() => (viewer.tabs()?.tabs.length ?? 0) === 1, "one tab");
    expect(viewer.activeTab()?.id).toBe(tab!.id);

    // Ending the session closes the stream and removes the container.
    const ended = await client.delete(`/browser/sessions/${session.id}`);
    expect(ended.statusCode).toBe(204);
    await viewer.until(() => viewer.closeCode !== null, "stream closed");
    expect(viewer.closeCode).toBe(STREAM_CLOSE_CODES.ended);
    const after = browserOverviewSchema.parse((await client.get("/browser")).json());
    expect(after.session).toBeNull();

    expect(await h.eventTypes(email)).toEqual(
      expect.arrayContaining(["browser.session_started", "browser.session_ended"]),
    );
    const exported = accountExportSchema.parse((await client.get("/account/export")).json());
    expect(exported.browserSessions).toHaveLength(1);
    expect(exported.browserSessions[0]).toMatchObject({ engine: "chromium", endReason: "user" });
  }, 90_000);

  it("refuses the stream without a valid ticket, and a ticket works only once", async () => {
    const { client } = await account("browser-ticket");
    const session = await startSession(client);
    const url = `${baseUrl}/api/v1/browser/sessions/${session.id}/stream`;

    const bogus = new Viewer(url, "A".repeat(43), h.origin);
    await bogus.until(() => bogus.closeCode !== null, "bogus closed");
    expect(bogus.closeCode).toBe(STREAM_CLOSE_CODES.unauthorized);

    const ticket = await ticketFor(client, session.id);
    const first = new Viewer(url, ticket.ticket, h.origin);
    await first.until(() => first.messages.some((m) => m.type === "welcome"), "welcome");
    const replay = new Viewer(url, ticket.ticket, h.origin);
    await replay.until(() => replay.closeCode !== null, "replay closed");
    expect(replay.closeCode).toBe(STREAM_CLOSE_CODES.unauthorized);

    // A second viewer with a fresh ticket replaces the first.
    const again = await ticketFor(client, session.id);
    const second = new Viewer(url, again.ticket, h.origin);
    await second.until(() => second.messages.some((m) => m.type === "welcome"), "welcome 2");
    await first.until(() => first.closeCode !== null, "first replaced");
    expect(first.closeCode).toBe(STREAM_CLOSE_CODES.replaced);

    // Someone else's session is not reachable, even with their own valid cookie.
    const { client: other } = await account("browser-other");
    expect((await other.post(`/browser/sessions/${session.id}/ticket`, {})).statusCode).toBe(404);
    expect((await other.delete(`/browser/sessions/${session.id}`)).statusCode).toBe(404);

    second.close();
    await client.delete(`/browser/sessions/${session.id}`);
  }, 60_000);

  it("ends the session when the sign-in that started it ends", async () => {
    const { client } = await account("browser-signout");
    const session = await startSession(client);
    const ticket = await ticketFor(client, session.id);
    const viewer = new Viewer(
      `${baseUrl}/api/v1/browser/sessions/${session.id}/stream`,
      ticket.ticket,
      h.origin,
    );
    await viewer.until(() => viewer.messages.some((m) => m.type === "welcome"), "welcome");

    expect((await client.post("/auth/logout")).statusCode).toBe(204);
    await viewer.until(() => viewer.closeCode !== null, "closed after sign-out");
    expect(viewer.closeCode).toBe(STREAM_CLOSE_CODES.ended);

    const rows = await h.database.pool.query<{ status: string; end_reason: string }>(
      "select status, end_reason from browser_sessions where id = $1",
      [session.id],
    );
    expect(rows.rows[0]).toEqual({ status: "ended", end_reason: "signed_out" });
  }, 60_000);
});

describe("files between the cloud browser and Drive", () => {
  it("saves a printed page as a PDF, and refuses a download over the limit", async () => {
    const { client, email } = await account("browser-files");
    const { session, viewer, tab } = await openSession(client);
    await openPage(viewer, tab.id, "http://testsite.invalid/second", "Second page");

    viewer.send({ type: "print", tabId: tab.id });
    await viewer.until(
      () =>
        viewer.messages.some(
          (m) => m.type === "transfer" && m.kind === "print" && m.state === "saved",
        ),
      "printed page saved",
    );
    const printed = viewer.messages.find((m) => m.type === "transfer" && m.state === "saved");
    expect(printed).toMatchObject({ filename: "Second page.pdf" });
    const files = await h.database.pool.query<{ name: string; content_type: string }>(
      `select f.name, f.content_type from drive_files f join users u on u.id = f.user_id where u.email = $1`,
      [email],
    );
    expect(files.rows).toEqual([{ name: "Second page.pdf", content_type: "application/pdf" }]);

    // Over Drive's per-file limit: cancelled in the engine, nothing kept.
    viewer.send({
      type: "navigate",
      tabId: tab.id,
      url: `http://testsite.invalid/download?bytes=${String(MAX_FILE_BYTES + 1)}&name=huge.bin`,
    });
    await viewer.until(
      () => viewer.messages.some((m) => m.type === "transfer" && m.state === "too_large"),
      "download refused as too large",
    );
    expect(
      (await h.database.pool.query("select 1 from drive_files where name = 'huge.bin'")).rowCount,
    ).toBe(0);
    expect(await h.eventTypes(email)).toEqual(expect.arrayContaining(["browser.file_saved"]));

    viewer.close();
    await client.delete(`/browser/sessions/${session.id}`);
  }, 90_000);

  it("gives a page's file chooser clean Drive files, never quarantined ones", async () => {
    const { client, email } = await account("browser-chooser");
    const clean = await client.upload("/drive/files", {
      name: "notes.txt",
      content: Buffer.from("hello drive"),
    });
    expect(clean.statusCode, clean.body).toBe(201);
    const cleanFile = driveFileSchema.parse(clean.json());
    const infected = await client.upload("/drive/files", {
      name: "virus.txt",
      content: Buffer.from(EICAR),
    });
    expect(infected.statusCode, infected.body).toBe(201);
    const infectedFile = driveFileSchema.parse(infected.json());
    expect(infectedFile.status).toBe("infected");

    const { session, viewer, tab } = await openSession(client);
    await openPage(viewer, tab.id, "http://testsite.invalid/upload", "Upload page");
    click(viewer, tab.id, 100, 60);
    await viewer.until(
      () => viewer.messages.some((m) => m.type === "file-chooser"),
      "file chooser",
    );
    const chooser = viewer.messages.find((m) => m.type === "file-chooser");
    expect(chooser).toMatchObject({ tabId: tab.id, multiple: true });
    viewer.send({
      type: "file-chooser",
      tabId: tab.id,
      chooserId: chooser?.type === "file-chooser" ? chooser.chooserId : "",
      fileIds: [cleanFile.id, infectedFile.id],
    });
    // The page sees the file it was given (name and size), and only that one.
    await viewer.until(
      () => viewer.activeTab()?.title === "notes.txt 11",
      "page received the file",
    );
    expect(await h.eventTypes(email)).toEqual(expect.arrayContaining(["browser.file_sent"]));

    viewer.close();
    await client.delete(`/browser/sessions/${session.id}`);
  }, 90_000);
});

describe("profiles that keep their data", () => {
  it("keeps cookies between sessions, not in temporary sessions, and forgets them on request", async () => {
    const { client } = await account("browser-profile");
    const list = profileListSchema.parse((await client.get("/profiles")).json());
    const profile = list.profiles[0]!;
    expect(profile).toMatchObject({ keepData: true, data: null });

    // Session 1 under the profile: a site sets a cookie.
    const first = await openSession(client, profile.id);
    await openPage(first.viewer, first.tab.id, "http://testsite.invalid/set-cookie", "Cookie set");
    first.viewer.close();
    expect((await client.delete(`/browser/sessions/${first.session.id}`)).statusCode).toBe(204);
    const afterFirst = profileSchema.parse(
      profileListSchema.parse((await client.get("/profiles")).json()).profiles[0],
    );
    expect(afterFirst.data).not.toBeNull();
    expect(afterFirst.data!.bytes).toBeGreaterThan(0);

    // Session 2 under the same profile sees it; a temporary session doesn't.
    const second = await openSession(client, profile.id);
    await openPage(
      second.viewer,
      second.tab.id,
      "http://testsite.invalid/cookie",
      "Cookie: brawzer_test=kept",
    );
    second.viewer.close();
    await client.delete(`/browser/sessions/${second.session.id}`);
    const temporary = await openSession(client);
    await openPage(
      temporary.viewer,
      temporary.tab.id,
      "http://testsite.invalid/cookie",
      "Cookie: none",
    );
    temporary.viewer.close();
    await client.delete(`/browser/sessions/${temporary.session.id}`);

    // Clearing the data forgets the cookie; a profile that keeps nothing saves nothing.
    const cleared = await client.delete(`/profiles/${profile.id}/data`);
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(profileSchema.parse(cleared.json()).data).toBeNull();
    expect((await client.patch(`/profiles/${profile.id}`, { keepData: false })).statusCode).toBe(
      200,
    );
    const third = await openSession(client, profile.id);
    await openPage(third.viewer, third.tab.id, "http://testsite.invalid/cookie", "Cookie: none");
    await openPage(third.viewer, third.tab.id, "http://testsite.invalid/set-cookie", "Cookie set");
    third.viewer.close();
    await client.delete(`/browser/sessions/${third.session.id}`);
    const final = profileListSchema.parse((await client.get("/profiles")).json()).profiles[0]!;
    expect(final.data).toBeNull();
    const objects = await h.database.pool.query(
      "select 1 from profiles where data_object_key is not null and id = $1",
      [profile.id],
    );
    expect(objects.rowCount).toBe(0);
  }, 180_000);
});
