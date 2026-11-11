import {
  binaryKind,
  decodeAudioChunk,
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
import {
  driveFileSchema,
  historyPageSchema,
  profileListSchema,
  profileSchema,
} from "@brawzer/contracts";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";
import { answeringSocks5Proxy, type TestServer } from "./support/proxy-servers.js";

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
    env: {
      BROWSER_TEST_SITE: "true",
      DRIVE_MAX_FILE_BYTES: String(MAX_FILE_BYTES),
      // The test proxy below runs on this machine's loopback.
      PROXY_TEST_ALLOW_PRIVATE: "true",
    },
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
  /** Sound chunks, with whether anything audible was in them. */
  readonly audio: { seq: number; bytes: number; loud: boolean }[] = [];
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
        const bytes = new Uint8Array(data);
        if (binaryKind(bytes) === "audio") {
          const chunk = decodeAudioChunk(bytes);
          if (chunk) {
            const view = new DataView(
              chunk.samples.buffer,
              chunk.samples.byteOffset,
              chunk.samples.byteLength,
            );
            let loud = false;
            for (let offset = 0; offset + 1 < chunk.samples.length; offset += 2) {
              if (Math.abs(view.getInt16(offset, true)) > 2000) loud = true;
            }
            this.audio.push({ seq: chunk.header.seq, bytes: chunk.samples.length, loud });
          }
          return;
        }
        const frame = decodeFrame(bytes);
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
    expect(overview.limits).toEqual({ idleMinutes: 15, maxHours: 4, liveSessions: 3 });
  });

  it("starts a session, streams the page, browses the test site and ends", async () => {
    const { client, email } = await account("browser-session");
    const session = await startSession(client);
    expect(session.status).toBe("running");
    expect(session.startedAt).not.toBeNull();

    // Several browsers at once (three on the free plan), a profile in one at a time.
    const [profile] = profileListSchema.parse((await client.get("/profiles")).json()).profiles;
    const second = await client.post("/browser/sessions", { profileId: profile?.id });
    expect(second.statusCode, second.body).toBe(201);
    const secondId = browserSessionSchema.parse(second.json()).id;
    const twice = await client.post("/browser/sessions", { profileId: profile?.id });
    expect(twice.statusCode).toBe(409);
    expect(h.errorOf(twice).message).toContain("is already open in another browser");

    const overview = browserOverviewSchema.parse((await client.get("/browser")).json());
    expect(overview.session?.id).toBe(secondId);
    expect(overview.sessions.map((entry) => entry.id)).toEqual([secondId, session.id]);
    expect((await client.delete(`/browser/sessions/${secondId}`)).statusCode).toBe(204);

    const ticket = await ticketFor(client, session.id);
    expect(ticket.url).toBe(`ws://127.0.0.1:4100/api/v1/browser/sessions/${session.id}/stream`);
    const viewer = new Viewer(
      `${baseUrl}/api/v1/browser/sessions/${session.id}/stream`,
      ticket.ticket,
      h.origin,
    );
    await viewer.until(() => viewer.messages.some((m) => m.type === "welcome"), "welcome");
    const welcome = viewer.messages.find((m) => m.type === "welcome");
    expect(welcome?.type === "welcome" && welcome.engine.name).toBe("bee");
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

    // Websites are told it's Bee, built on Chromium, and never that it runs without a window.
    const beeAgent = await agentOf(viewer, tab!.id);
    expect(beeAgent).toMatch(/ Chrome\/\d+[.\d]* Safari\/537\.36 Bee\/[\d.]+ \| /);
    expect(beeAgent).toMatch(/"Chromium";v="\d+"/);
    expect(beeAgent).not.toContain("Headless");

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

    // A connection the proxy refuses (a private address) is reported
    // as data, with the address that failed and the engine's code, so Brawzer
    // draws the error page; the next page clears it.
    viewer.send({ type: "navigate", tabId: tab!.id, url: "https://10.0.0.1/" });
    await viewer.until(
      () => viewer.activeTab()?.error?.code === "BRAWZER_REFUSED_ADDRESS",
      "navigation error",
    );
    expect(viewer.activeTab()).toMatchObject({
      url: "https://10.0.0.1/",
      error: { url: "https://10.0.0.1/", code: "BRAWZER_REFUSED_ADDRESS" },
    });
    viewer.send({ type: "navigate", tabId: tab!.id, url: "http://testsite.invalid/" });
    await viewer.until(
      () => viewer.activeTab()?.title === "Brawzer test site" && viewer.activeTab()?.error === null,
      "error cleared",
    );

    // Brawzer's page tools run inside the page: find reports its count and
    // place, zoom is kept on the tab, reader view replaces an article page.
    viewer.send({ type: "find", tabId: tab!.id, text: "second", forward: true });
    await viewer.until(
      () =>
        viewer.messages.some(
          (m) =>
            m.type === "find-result" && m.text === "second" && m.matches >= 1 && m.active === 1,
        ),
      "find result",
    );
    // Clipboard with intent: the selection the find made, asked for on purpose;
    // a paste types into the focused field.
    viewer.send({ type: "copy", tabId: tab!.id });
    await viewer.until(
      () => viewer.messages.some((m) => m.type === "clipboard" && m.text === "Second"),
      "selection copied",
    );
    viewer.send({ type: "find-stop", tabId: tab!.id });
    viewer.send({ type: "zoom", tabId: tab!.id, factor: 1.5 });
    await viewer.until(() => viewer.activeTab()?.zoom === 1.5, "zoom applied");
    viewer.send({ type: "reader", tabId: tab!.id, on: true });
    await viewer.until(
      () => viewer.messages.some((m) => m.type === "reader-unavailable"),
      "no article on the home page",
    );
    viewer.send({ type: "navigate", tabId: tab!.id, url: "http://testsite.invalid/article" });
    await viewer.until(
      () => viewer.activeTab()?.title === "Aurora forecast" && !viewer.activeTab()?.loading,
      "article page",
    );
    expect(viewer.activeTab()?.zoom).toBe(1.5);
    viewer.send({ type: "reader", tabId: tab!.id, on: true });
    await viewer.until(() => viewer.activeTab()?.reader === true, "reader view");
    viewer.send({ type: "reader", tabId: tab!.id, on: false });
    await viewer.until(
      () => viewer.activeTab()?.reader === false && viewer.activeTab()?.title === "Aurora forecast",
      "reader view left",
    );
    viewer.send({ type: "zoom", tabId: tab!.id, factor: 1 });
    await viewer.until(() => viewer.activeTab()?.zoom === 1, "zoom reset");
    viewer.send({ type: "navigate", tabId: tab!.id, url: "http://testsite.invalid/" });
    await viewer.until(() => viewer.activeTab()?.title === "Brawzer test site", "home again");

    // Sound: what the page plays reaches the viewer as audio chunks, and only while wanted.
    viewer.send({ type: "navigate", tabId: tab!.id, url: "http://testsite.invalid/sound" });
    await viewer.until(() => viewer.activeTab()?.title === "Sound test", "sound page");
    for (const kind of ["down", "up"] as const) {
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
    }
    await viewer.until(() => viewer.activeTab()?.title === "Playing", "tone started");
    await viewer.until(() => viewer.audio.some((chunk) => chunk.loud), "audible sound", 20_000);
    expect(viewer.audio[0]?.bytes).toBe(960);
    viewer.send({ type: "sound", on: false });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const heard = viewer.audio.length;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(viewer.audio.length).toBe(heard);
    viewer.send({ type: "sound", on: true });
    await viewer.until(() => viewer.audio.length > heard, "sound back on", 20_000);
    viewer.send({ type: "navigate", tabId: tab!.id, url: "http://testsite.invalid/" });
    await viewer.until(
      () => viewer.activeTab()?.title === "Brawzer test site" && !viewer.activeTab()?.loading,
      "home after sound",
    );

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
    // A paste from the local computer types into the focused field, then keys follow.
    viewer.send({ type: "paste", tabId: tab!.id, text: "brown " });
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
    await viewer.until(
      () => viewer.activeTab()?.title === "Results for brown hi",
      "search results",
    );

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
    // Home's numbers: when it browsed, never what.
    expect(after.activity.recentStarts).toHaveLength(2);
    expect(after.activity.lastEndedAt).not.toBeNull();
    expect(after.activity.minutesThisMonth.map((entry) => entry.engine)).toEqual(["bee"]);

    expect(await h.eventTypes(email)).toEqual(
      expect.arrayContaining(["browser.session_started", "browser.session_ended"]),
    );
    const exported = accountExportSchema.parse((await client.get("/account/export")).json());
    // Both browsers it opened, each ended by the person.
    expect(exported.browserSessions).toHaveLength(2);
    for (const entry of exported.browserSessions) {
      expect(entry).toMatchObject({ engine: "bee", endReason: "user" });
    }
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

  it("stops streaming while the sign-in is locked, and the browser waits for it", async () => {
    const { client } = await account("browser-lock");
    const session = await startSession(client);
    const url = `${baseUrl}/api/v1/browser/sessions/${session.id}/stream`;
    const ticket = await ticketFor(client, session.id);
    const viewer = new Viewer(url, ticket.ticket, h.origin);
    await viewer.until(() => viewer.messages.some((m) => m.type === "welcome"), "welcome");

    expect((await client.post("/auth/session/lock")).statusCode).toBe(204);
    await viewer.until(() => viewer.closeCode !== null, "closed on lock");
    expect(viewer.closeCode).toBe(STREAM_CLOSE_CODES.locked);
    // No new stream while locked, but the browser keeps running.
    expect((await client.post(`/browser/sessions/${session.id}/ticket`, {})).statusCode).toBe(423);
    const rows = await h.database.pool.query<{ status: string }>(
      "select status from browser_sessions where id = $1",
      [session.id],
    );
    expect(rows.rows[0]?.status).toBe("running");

    // Unlocked, it streams again.
    expect(
      (await client.post("/auth/reauthenticate", { password: "violet-harbor-lantern" })).statusCode,
    ).toBe(200);
    const again = await ticketFor(client, session.id);
    const back = new Viewer(url, again.ticket, h.origin);
    await back.until(() => back.messages.some((m) => m.type === "welcome"), "welcome again");
    back.close();
    await client.delete(`/browser/sessions/${session.id}`);
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

describe("the egress (ADR 0014)", () => {
  const servers: TestServer[] = [];
  afterAll(async () => {
    await Promise.all(servers.map((server) => server.close()));
  });

  it("gives every session an egress sidecar that owns its network, and records no proxy without one", async () => {
    const { client } = await account("browser-egress");
    const { session, viewer } = await openSession(client);
    expect(session.proxyId).toBeNull();
    const containers = await h.database.pool.query<{ container_id: string }>(
      "select container_id from browser_sessions where id = $1",
      [session.id],
    );
    const runtime = containers.rows[0]?.container_id ?? "";
    expect(runtime).not.toBe("");
    // The runtime has no network of its own: it shares the egress sidecar's namespace.
    const inspect = await fetchDocker(`/containers/${runtime}/json`);
    expect(inspect.HostConfig.NetworkMode).toMatch(/^container:/);
    expect(inspect.HostConfig.CapAdd ?? []).toEqual([]);
    viewer.close();
    expect((await client.delete(`/browser/sessions/${session.id}`)).statusCode).toBe(204);
    // Both containers go with the session.
    expect((await fetchDocker(`/containers/${runtime}/json`, true)).status).toBe(404);
  }, 90_000);

  it("sends a profile's traffic through its proxy, names unresolved, credentials never in the runtime", async () => {
    const { client } = await account("browser-proxy");
    const auth = { username: "tester", password: "c0rrect-h0rse" };
    const socks = await answeringSocks5Proxy(auth);
    servers.push(socks);
    const proxy = await client.post("/proxies", {
      name: "Answering proxy",
      protocol: "socks5",
      host: "127.0.0.1",
      port: socks.port,
      credentials: auth,
    });
    expect(proxy.statusCode, proxy.body).toBe(201);
    const proxyId = proxy.json<{ id: string }>().id;
    const profile = profileListSchema.parse((await client.get("/profiles")).json()).profiles[0]!;
    expect((await client.patch(`/profiles/${profile.id}`, { proxyId })).statusCode).toBe(200);

    const { session, viewer, tab } = await openSession(client, profile.id);
    expect(session.proxyId).toBe(proxyId);
    // A name that doesn't exist anywhere: only the proxy can "resolve" it.
    await openPage(
      viewer,
      tab.id,
      "http://nowhere-at-all.example/page",
      "Through the proxy: nowhere-at-all.example",
    );
    expect(socks.requests).toContain("nowhere-at-all.example:80");

    // The account's site rules are applied by the egress, before the proxy sees anything.
    expect(
      (await client.post("/site-rules", { kind: "block", host: "nowhere-at-all.example" }))
        .statusCode,
    ).toBe(201);
    viewer.close();
    expect((await client.delete(`/browser/sessions/${session.id}`)).statusCode).toBe(204);
    const ruled = await openSession(client, profile.id);
    await openPage(
      ruled.viewer,
      ruled.tab.id,
      "http://sub.nowhere-at-all.example/",
      "Blocked by Brawzer",
    );
    expect(socks.requests).not.toContain("sub.nowhere-at-all.example:80");
    await openPage(
      ruled.viewer,
      ruled.tab.id,
      "http://elsewhere.example/",
      "Through the proxy: elsewhere.example",
    );
    ruled.viewer.close();
    expect((await client.delete(`/browser/sessions/${ruled.session.id}`)).statusCode).toBe(204);
    const rules = (await client.get("/site-rules")).json<{ rules: { id: string }[] }>().rules;
    for (const rule of rules)
      expect((await client.delete(`/site-rules/${rule.id}`)).statusCode).toBe(204);
    const fresh = await openSession(client, profile.id);

    // Private addresses stay refused even with a proxy, unless the profile asks
    // for them to go through it; loopback never does.
    await openPage(fresh.viewer, fresh.tab.id, "http://10.0.0.1/", "Blocked by Brawzer");
    expect(socks.requests).not.toContain("10.0.0.1:80");
    fresh.viewer.close();
    expect((await client.delete(`/browser/sessions/${fresh.session.id}`)).statusCode).toBe(204);
    const opted = await client.patch(`/profiles/${profile.id}`, { privateThroughProxy: true });
    expect(opted.statusCode, opted.body).toBe(200);
    expect(opted.json<{ privateThroughProxy: boolean }>().privateThroughProxy).toBe(true);
    const again = await openSession(client, profile.id);
    await openPage(again.viewer, again.tab.id, "http://10.0.0.1/", "Through the proxy: 10.0.0.1");
    expect(socks.requests).toContain("10.0.0.1:80");
    await openPage(
      again.viewer,
      again.tab.id,
      "http://127.0.0.1:7000/healthz",
      "Blocked by Brawzer",
    );
    expect(socks.requests).not.toContain("127.0.0.1:7000");
    // The runtime's own environment never holds the proxy's password.
    const containers = await h.database.pool.query<{ container_id: string }>(
      "select container_id from browser_sessions where id = $1",
      [again.session.id],
    );
    const runtimeEnv = (
      await fetchDocker(`/containers/${containers.rows[0]?.container_id ?? ""}/json`)
    ).Config.Env.join("\n");
    expect(runtimeEnv).not.toContain(auth.password);
    expect(runtimeEnv).toContain("BRAWZER_EGRESS_PROXY=");
    expect(runtimeEnv).toContain("BRAWZER_PRIVATE_VIA_EGRESS=true");
    again.viewer.close();
    await client.delete(`/browser/sessions/${again.session.id}`);
  }, 120_000);

  it("browses through a team's proxy, and ends the session when its person leaves the team", async () => {
    const owner = await account("browser-team-owner");
    expect((await owner.client.post("/team", { name: "Browsing crew" })).statusCode).toBe(200);
    const member = await account("browser-team-member");
    expect(
      (await owner.client.post("/team/invitations", { email: member.email, role: "member" }))
        .statusCode,
    ).toBe(200);
    const invitation = (await member.client.get("/team")).json<{ invitations: { id: string }[] }>()
      .invitations[0]?.id;
    expect(
      (await member.client.post(`/team/invitations/${invitation ?? ""}/join`, {})).statusCode,
    ).toBe(200);

    const socks = await answeringSocks5Proxy({ username: "crew", password: "team-pass-123" });
    servers.push(socks);
    const added = await owner.client.post("/proxies", {
      name: "Crew exit",
      protocol: "socks5",
      host: "127.0.0.1",
      port: socks.port,
      credentials: { username: "crew", password: "team-pass-123" },
      team: true,
    });
    expect(added.statusCode, added.body).toBe(201);
    const proxyId = added.json<{ id: string }>().id;
    const profile = profileListSchema.parse((await member.client.get("/profiles")).json())
      .profiles[0]!;
    expect((await member.client.patch(`/profiles/${profile.id}`, { proxyId })).statusCode).toBe(
      200,
    );

    const { session, viewer, tab } = await openSession(member.client, profile.id);
    expect(session.proxyId).toBe(proxyId);
    await openPage(viewer, tab.id, "http://crew.example/", "Through the proxy: crew.example");
    expect(socks.requests).toContain("crew.example:80");

    // Leaving the team ends the session: the proxy is no longer theirs.
    expect((await member.client.post("/team/leave", {})).statusCode).toBe(200);
    await viewer.until(() => viewer.closeCode !== null, "closed after leaving the team");
    expect((await member.client.get("/browser")).json<{ session: unknown }>().session).toBeNull();
    const ended = (await member.client.get("/security/events"))
      .json<{ events: { type: string; details: { reason?: string } }[] }>()
      .events.find((event) => event.type === "browser.session_ended");
    expect(ended?.details.reason).toBe("team_left");
  }, 120_000);

  it("records a profile's history from its sessions, and hands its tabs to the next one", async () => {
    const { client } = await account("browser-history");
    const profile = profileListSchema.parse((await client.get("/profiles")).json()).profiles[0]!;
    const historyUrls = async () =>
      historyPageSchema
        .parse((await client.get(`/profiles/${profile.id}/history`)).json())
        .entries.map((entry) => `${entry.url} ${entry.title}`);

    const { session, viewer, tab } = await openSession(client, profile.id);
    await openPage(viewer, tab.id, "http://testsite.invalid/", "Brawzer test site");
    await openPage(viewer, tab.id, "http://testsite.invalid/second", "Second page");
    viewer.send({ type: "new-tab", url: "http://testsite.invalid/upload" });
    await viewer.until(
      () =>
        viewer.tabs()?.tabs.some((entry) => entry.title === "Upload page" && !entry.loading) ??
        false,
      "the second tab",
    );
    // Visits are recorded as pages finish loading; Brawzer's start page never is.
    await expect
      .poll(historyUrls, { timeout: 10_000 })
      .toEqual([
        "http://testsite.invalid/upload Upload page",
        "http://testsite.invalid/second Second page",
        "http://testsite.invalid/ Brawzer test site",
      ]);

    // Handing off ends the session and keeps its tabs for the next one, on any device.
    expect((await client.post(`/browser/sessions/${session.id}/hand-off`, {})).statusCode).toBe(
      204,
    );
    await viewer.until(() => viewer.closeCode !== null, "closed by the hand-off");
    await expect
      .poll(
        async () =>
          browserOverviewSchema
            .parse((await client.get("/browser")).json())
            .savedTabs.map((saved) => [
              saved.profileId,
              saved.handedOff,
              saved.tabs.map((entry) => entry.url),
            ]),
        { timeout: 10_000 },
      )
      .toEqual([
        [profile.id, true, ["http://testsite.invalid/second", "http://testsite.invalid/upload"]],
      ]);
    const ended = (await client.get("/security/events"))
      .json<{ events: { type: string; details: { reason?: string } }[] }>()
      .events.find((event) => event.type === "browser.session_ended");
    expect(ended?.details.reason).toBe("handed_off");

    // The next session continues from them: the tabs reopen, in their order.
    const resumed = await client.post("/browser/sessions", { profileId: profile.id, resume: true });
    expect(resumed.statusCode, resumed.body).toBe(201);
    const next = browserSessionSchema.parse(resumed.json());
    const ticket = await ticketFor(client, next.id);
    const again = new Viewer(
      `${baseUrl}/api/v1/browser/sessions/${next.id}/stream`,
      ticket.ticket,
      h.origin,
    );
    await again.until(
      () => {
        const titles = again.tabs()?.tabs.map((entry) => (entry.loading ? "" : entry.title));
        return titles?.join("|") === "Second page|Upload page";
      },
      "the reopened tabs",
      30_000,
    );
    again.close();
    expect((await client.delete(`/browser/sessions/${next.id}`)).statusCode).toBe(204);

    // A temporary session keeps nothing, and has nothing to hand off.
    const before = await historyUrls();
    const temporary = await openSession(client);
    await openPage(
      temporary.viewer,
      temporary.tab.id,
      "http://testsite.invalid/upload",
      "Upload page",
    );
    expect(
      (await client.post(`/browser/sessions/${temporary.session.id}/hand-off`, {})).statusCode,
    ).toBe(409);
    temporary.viewer.close();
    expect((await client.delete(`/browser/sessions/${temporary.session.id}`)).statusCode).toBe(204);
    expect(await historyUrls()).toEqual(before);
  }, 180_000);

  it("asks the owner to confirm it's them before a profile's proxy changes", async () => {
    const { client, email } = await account("browser-proxy-stepup");
    const proxy = await client.post("/proxies", {
      name: "Work proxy",
      protocol: "http",
      host: "proxy.example.com",
      port: 8080,
    });
    const proxyId = proxy.json<{ id: string }>().id;
    const profile = profileListSchema.parse((await client.get("/profiles")).json()).profiles[0]!;
    await h.expireConfirmation(email);
    const stale = await client.patch(`/profiles/${profile.id}`, { proxyId });
    expect(stale.statusCode).toBe(403);
    expect(h.errorOf(stale).code).toBe("reauthentication_required");
    // Other changes don't need it.
    expect((await client.patch(`/profiles/${profile.id}`, { name: "Renamed" })).statusCode).toBe(
      200,
    );
  });
});

/** Reads the container engine directly, to check what the orchestrator made. */
async function fetchDocker(
  path: string,
  allowMissing = false,
): Promise<{
  status: number;
  HostConfig: { NetworkMode: string; CapAdd: string[] | null };
  Config: { Env: string[] };
}> {
  const http = await import("node:http");
  return new Promise((resolve, reject) => {
    const request = http.request(
      { socketPath: h.config.browser.dockerSocket, path: `/v1.44${path}`, method: "GET" },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          if (status === 404 && allowMissing) {
            resolve({ status, HostConfig: { NetworkMode: "", CapAdd: null }, Config: { Env: [] } });
            return;
          }
          if (status >= 400) {
            reject(new Error(`Docker answered ${String(status)}`));
            return;
          }
          resolve({
            status,
            ...(JSON.parse(Buffer.concat(chunks).toString("utf8")) as object),
          } as never);
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

describe("Firefox, the second engine", () => {
  it("browses, types, shows dialogs, downloads, prints, takes Drive files and keeps cookies", async () => {
    const { client, email } = await account("browser-firefox");
    const created = await client.post("/profiles", {
      name: "Fox",
      color: "copper",
      engine: "firefox",
    });
    expect(created.statusCode, created.body).toBe(201);
    const profile = profileSchema.parse(created.json());
    expect(profile.engine).toBe("firefox");
    // The whole catalogue runs on Firefox; the agent installs it at start.
    expect(
      (
        await client.patch(`/profiles/${profile.id}`, {
          extensions: ["ubo-lite", "ublock-origin", "dark-reader"],
        })
      ).statusCode,
    ).toBe(200);
    const upload = await client.upload("/drive/files", {
      name: "notes.txt",
      content: Buffer.from("hello drive"),
    });
    const driveFile = driveFileSchema.parse(upload.json());

    const { session, viewer, tab } = await openSession(client, profile.id);
    expect(session.engine).toBe("firefox");
    const welcome = viewer.messages.find((m) => m.type === "welcome");
    expect(welcome?.type === "welcome" && welcome.engine.name).toBe("firefox");
    expect(welcome?.type === "welcome" && welcome.extensions).toEqual([
      "ubo-lite",
      "ublock-origin",
      "dark-reader",
    ]);

    // HTTP and HTTPS through the proxy, with frames arriving.
    await openPage(viewer, tab.id, "https://testsite.invalid/second", "Second page");
    // A refused connection: Firefox's error page is reported as data, never shown.
    viewer.send({ type: "navigate", tabId: tab.id, url: "https://10.0.0.1/" });
    await viewer.until(
      () => viewer.activeTab()?.error?.code === "BRAWZER_REFUSED_ADDRESS",
      "firefox navigation error",
    );
    await openPage(viewer, tab.id, "http://testsite.invalid/", "Brawzer test site");
    expect(viewer.activeTab()?.error).toBeNull();

    // Sound on Firefox, through the same audio server.
    await openPage(viewer, tab.id, "http://testsite.invalid/sound", "Sound test");
    click(viewer, tab.id, 100, 60);
    await viewer.until(() => viewer.activeTab()?.title === "Playing", "firefox tone started");
    await viewer.until(
      () => viewer.audio.some((chunk) => chunk.loud),
      "firefox audible sound",
      20_000,
    );
    await openPage(viewer, tab.id, "http://testsite.invalid/", "Brawzer test site");

    // Find, zoom and reader view work the same way on Firefox.
    viewer.send({ type: "find", tabId: tab.id, text: "second", forward: true });
    await viewer.until(
      () =>
        viewer.messages.some(
          (m) =>
            m.type === "find-result" && m.text === "second" && m.matches >= 1 && m.active === 1,
        ),
      "firefox find result",
    );
    viewer.send({ type: "copy", tabId: tab.id });
    await viewer.until(
      () => viewer.messages.some((m) => m.type === "clipboard" && m.text === "Second"),
      "firefox selection copied",
    );
    viewer.send({ type: "find-stop", tabId: tab.id });
    viewer.send({ type: "zoom", tabId: tab.id, factor: 1.25 });
    await viewer.until(() => viewer.activeTab()?.zoom === 1.25, "firefox zoom");
    await openPage(viewer, tab.id, "http://testsite.invalid/article", "Aurora forecast");
    viewer.send({ type: "reader", tabId: tab.id, on: true });
    await viewer.until(() => viewer.activeTab()?.reader === true, "firefox reader view");
    viewer.send({ type: "reader", tabId: tab.id, on: false });
    await viewer.until(
      () => viewer.activeTab()?.reader === false && !viewer.activeTab()?.loading,
      "firefox reader view left",
    );
    viewer.send({ type: "zoom", tabId: tab.id, factor: 1 });
    await viewer.until(() => viewer.activeTab()?.zoom === 1, "firefox zoom reset");
    await openPage(viewer, tab.id, "http://testsite.invalid/", "Brawzer test site");
    await viewer.until(() => viewer.frames.length > 0, "a frame");
    expect(viewer.frames[0]).toMatchObject({ tabId: tab.id, width: 800, height: 600 });

    // A click follows a link; typing submits the search form.
    click(viewer, tab.id, 100, 60);
    await viewer.until(() => viewer.activeTab()?.title === "Second page", "clicked link");
    viewer.send({ type: "back", tabId: tab.id });
    await viewer.until(() => viewer.activeTab()?.title === "Brawzer test site", "back");
    click(viewer, tab.id, 100, 220);
    viewer.send({ type: "paste", tabId: tab.id, text: "brown " });
    viewer.send({ type: "text", tabId: tab.id, text: "fox" });
    viewer.send({
      type: "key",
      tabId: tab.id,
      kind: "down",
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    });
    viewer.send({
      type: "key",
      tabId: tab.id,
      kind: "up",
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    });
    await viewer.until(
      () => viewer.activeTab()?.title === "Results for brown fox",
      "search submitted",
    );

    // A dialog, drawn by Brawzer and answered.
    await openPage(viewer, tab.id, "http://testsite.invalid/", "Brawzer test site");
    click(viewer, tab.id, 100, 140);
    await viewer.until(() => viewer.messages.some((m) => m.type === "dialog"), "dialog");
    expect(viewer.messages.find((m) => m.type === "dialog")).toMatchObject({
      kind: "alert",
      message: "Hello from the test site",
    });
    viewer.send({ type: "dialog", tabId: tab.id, accept: true });

    // A download goes to Drive; so does a printed page.
    click(viewer, tab.id, 100, 300);
    await viewer.until(
      () =>
        viewer.messages.some(
          (m) => m.type === "transfer" && m.kind === "download" && m.state === "saved",
        ),
      "download saved",
    );
    viewer.send({ type: "print", tabId: tab.id });
    await viewer.until(
      () =>
        viewer.messages.some(
          (m) => m.type === "transfer" && m.kind === "print" && m.state === "saved",
        ),
      "printed page saved",
    );

    // A file chooser is answered from Drive.
    await openPage(viewer, tab.id, "http://testsite.invalid/upload", "Upload page");
    click(viewer, tab.id, 100, 60);
    await viewer.until(
      () => viewer.messages.some((m) => m.type === "file-chooser"),
      "file chooser",
    );
    const chooser = viewer.messages.find((m) => m.type === "file-chooser");
    viewer.send({
      type: "file-chooser",
      tabId: tab.id,
      chooserId: chooser?.type === "file-chooser" ? chooser.chooserId : "",
      fileIds: [driveFile.id],
    });
    await viewer.until(
      () => viewer.activeTab()?.title === "notes.txt 11",
      "page received the file",
    );

    // A cookie survives into the next session under the profile.
    await openPage(viewer, tab.id, "http://testsite.invalid/set-cookie", "Cookie set");
    await openPage(viewer, tab.id, "http://testsite.invalid/cookie", "Cookie: brawzer_test=kept");
    viewer.close();
    expect((await client.delete(`/browser/sessions/${session.id}`)).statusCode).toBe(204);
    const again = await openSession(client, profile.id);
    await openPage(
      again.viewer,
      again.tab.id,
      "http://testsite.invalid/cookie",
      "Cookie: brawzer_test=kept",
    );
    again.viewer.close();
    await client.delete(`/browser/sessions/${again.session.id}`);

    const files = await h.database.pool.query<{ name: string }>(
      `select f.name from drive_files f join users u on u.id = f.user_id where u.email = $1 order by f.name`,
      [email],
    );
    expect(files.rows.map((row) => row.name)).toEqual([
      "Brawzer test site.pdf",
      "brawzer-test.bin",
      "notes.txt",
    ]);
  }, 180_000);
});

/** The environment Docker started a session's runtime and egress containers with. */
async function containerEnv(sessionId: string): Promise<{ runtime: string[]; egress: string[] }> {
  const row = await h.database.pool.query<{ container_id: string }>(
    "select container_id from browser_sessions where id = $1",
    [sessionId],
  );
  return {
    runtime: (await fetchDocker(`/containers/${row.rows[0]?.container_id ?? ""}/json`)).Config.Env,
    // The egress sidecar is named after the session (no warm pool in these tests).
    egress: (await fetchDocker(`/containers/brawzer-egress-${sessionId}/json`)).Config.Env,
  };
}

describe("Google Chrome, the third engine", () => {
  it("browses, and opens Chrome's own account and password pages only when the profile allows", async () => {
    const { client, email } = await account("browser-chrome");
    const created = await client.post("/profiles", {
      name: "Chrome",
      color: "rose",
      engine: "chrome",
    });
    expect(created.statusCode, created.body).toBe(201);
    const profile = profileSchema.parse(created.json());
    expect(profile).toMatchObject({ engine: "chrome", browserAccount: false });

    const first = await openSession(client, profile.id);
    expect(first.session.engine).toBe("chrome");
    const welcome = first.viewer.messages.find((m) => m.type === "welcome");
    expect(welcome?.type === "welcome" && welcome.engine.name).toBe("chrome");
    // Websites are told it's Chrome, not Bee Browser.
    const chromeAgent = await agentOf(first.viewer, first.tab.id);
    expect(chromeAgent).toMatch(/ Chrome\/\d+[.\d]* Safari\/537\.36 \| /);
    expect(chromeAgent).toMatch(/"Google Chrome";v="\d+"/);
    expect(chromeAgent).not.toContain("Headless");
    expect(chromeAgent).not.toContain("Bee/");
    await openPage(first.viewer, first.tab.id, "https://testsite.invalid/second", "Second page");
    first.viewer.send({ type: "navigate", tabId: first.tab.id, url: "https://10.0.0.1/" });
    await first.viewer.until(
      () => first.viewer.activeTab()?.error?.code === "BRAWZER_REFUSED_ADDRESS",
      "chrome navigation error",
    );
    await openPage(first.viewer, first.tab.id, "http://testsite.invalid/", "Brawzer test site");
    await first.viewer.until(() => first.viewer.frames.length > 0, "a frame");
    click(first.viewer, first.tab.id, 100, 60);
    await first.viewer.until(
      () => first.viewer.activeTab()?.title === "Second page",
      "clicked link",
    );
    const firstEnv = await containerEnv(first.session.id);
    expect(firstEnv.runtime).toContain("BRAWZER_ENGINE=chrome");
    expect(firstEnv.runtime).not.toContain("BRAWZER_BROWSER_ACCOUNT=true");
    expect(firstEnv.egress).not.toContain("EGRESS_ACCOUNT_SYNC=true");

    // With the browser account off, the browser's own pages stay out of reach.
    first.viewer.send({ type: "open-browser-page", page: "passwords" });
    first.viewer.send({ type: "new-tab", url: "http://testsite.invalid/" });
    await first.viewer.until(() => first.viewer.tabs()?.tabs.length === 2, "second tab");
    expect(first.viewer.tabs()?.tabs.map((tab) => tab.url)).not.toContainEqual(
      expect.stringMatching(/^chrome:/),
    );
    first.viewer.close();
    expect((await client.delete(`/browser/sessions/${first.session.id}`)).statusCode).toBe(204);

    // Turning it on is a recent-sign-in change, like a proxy.
    await h.expireConfirmation(email);
    const stale = await client.patch(`/profiles/${profile.id}`, { browserAccount: true });
    expect(stale.statusCode).toBe(403);
    expect(h.errorOf(stale).code).toBe("reauthentication_required");
    expect(
      (await client.post("/auth/reauthenticate", { password: "violet-harbor-lantern" })).statusCode,
    ).toBe(200);
    const on = await client.patch(`/profiles/${profile.id}`, { browserAccount: true });
    expect(on.statusCode, on.body).toBe(200);
    expect(profileSchema.parse(on.json()).browserAccount).toBe(true);

    // Now the session may sign in to Google and show Chrome's saved passwords.
    const second = await openSession(client, profile.id);
    const secondEnv = await containerEnv(second.session.id);
    expect(secondEnv.runtime).toContain("BRAWZER_BROWSER_ACCOUNT=true");
    expect(secondEnv.egress).toContain("EGRESS_ACCOUNT_SYNC=true");
    second.viewer.send({ type: "open-browser-page", page: "passwords" });
    await second.viewer.until(
      () => second.viewer.activeTab()?.url.startsWith("chrome://password-manager/") === true,
      "Chrome's password manager",
      30_000,
    );
    second.viewer.send({ type: "open-browser-page", page: "account" });
    await second.viewer.until(
      () => second.viewer.activeTab()?.url.startsWith("chrome://settings/") === true,
      "Chrome's account settings",
      30_000,
    );
    // Its other pages are still not tabs.
    expect(second.viewer.tabs()?.tabs.map((tab) => tab.url)).not.toContainEqual(
      expect.stringMatching(/^chrome:\/\/(?!password-manager|settings)/),
    );
    second.viewer.close();
    expect((await client.delete(`/browser/sessions/${second.session.id}`)).statusCode).toBe(204);

    // A profile that keeps nothing has no account to keep.
    const forget = await client.patch(`/profiles/${profile.id}`, { keepData: false });
    expect(forget.statusCode, forget.body).toBe(200);
    const third = await client.post("/browser/sessions", { profileId: profile.id });
    expect(third.statusCode, third.body).toBe(201);
    const thirdId = browserSessionSchema.parse(third.json()).id;
    expect((await containerEnv(thirdId)).runtime).not.toContain("BRAWZER_BROWSER_ACCOUNT=true");
    expect((await client.delete(`/browser/sessions/${thirdId}`)).statusCode).toBe(204);
  }, 240_000);
});

/** What the test site's /agent page says the browser told it: user agent | brand hints. */
async function agentOf(viewer: Viewer, tabId: string): Promise<string> {
  viewer.send({ type: "navigate", tabId, url: "https://testsite.invalid/agent" });
  await viewer.until(() => viewer.activeTab()?.title.startsWith("Agent: ") === true, "agent page");
  return viewer.activeTab()?.title ?? "";
}

describe("Chromium and Microsoft Edge", () => {
  it("opens Chromium as Chromium, with nothing of Bee in what websites see", async () => {
    const { client } = await account("browser-chromium");
    const created = await client.post("/profiles", {
      name: "Plain",
      color: "slate",
      engine: "chromium",
    });
    expect(created.statusCode, created.body).toBe(201);
    const profile = profileSchema.parse(created.json());
    const { session, viewer, tab } = await openSession(client, profile.id);
    expect(session.engine).toBe("chromium");
    const welcome = viewer.messages.find((m) => m.type === "welcome");
    expect(welcome?.type === "welcome" && welcome.engine.name).toBe("chromium");
    const agent = await agentOf(viewer, tab.id);
    expect(agent).toMatch(/ Chrome\/\d+[.\d]* Safari\/537\.36 \| /);
    expect(agent).toMatch(/"Chromium";v="\d+"/);
    expect(agent).not.toMatch(/Headless|Bee\/|Google Chrome/);
    await openPage(viewer, tab.id, "http://testsite.invalid/", "Brawzer test site");
    click(viewer, tab.id, 100, 60);
    await viewer.until(() => viewer.activeTab()?.title === "Second page", "clicked link");
    viewer.close();
    expect((await client.delete(`/browser/sessions/${session.id}`)).statusCode).toBe(204);
  }, 90_000);

  it("offers Edge only where the runtime image is x86-64, and browses with it there", async () => {
    const { client } = await account("browser-edge");
    const image = (await fetchDocker(
      `/images/${encodeURIComponent(h.config.browser.image)}/json`,
    )) as unknown as { Architecture?: string };
    const offered = profileListSchema.parse((await client.get("/profiles")).json()).engines;
    if (image.Architecture !== "amd64") {
      // Microsoft ships Edge for x86-64 Linux only: it isn't offered, or made, here.
      expect(offered).not.toContain("edge");
      const refused = await client.post("/profiles", {
        name: "Edge",
        color: "teal",
        engine: "edge",
      });
      expect(refused.statusCode).toBe(400);
      const overview = browserOverviewSchema.parse((await client.get("/browser")).json());
      expect(overview.engines).not.toContain("edge");
      return;
    }

    expect(offered).toContain("edge");
    const created = await client.post("/profiles", { name: "Edge", color: "teal", engine: "edge" });
    expect(created.statusCode, created.body).toBe(201);
    const profile = profileSchema.parse(created.json());
    const on = await client.patch(`/profiles/${profile.id}`, { browserAccount: true });
    expect(on.statusCode, on.body).toBe(200);
    const { session, viewer, tab } = await openSession(client, profile.id);
    expect(session.engine).toBe("edge");
    const welcome = viewer.messages.find((m) => m.type === "welcome");
    expect(welcome?.type === "welcome" && welcome.engine.name).toBe("edge");
    const agent = await agentOf(viewer, tab.id);
    expect(agent).toMatch(/ Edg\/[\d.]+ \| /);
    expect(agent).toMatch(/"Microsoft Edge";v="\d+"/);
    expect(agent).not.toContain("Headless");
    await openPage(viewer, tab.id, "https://testsite.invalid/second", "Second page");
    viewer.send({ type: "navigate", tabId: tab.id, url: "https://10.0.0.1/" });
    await viewer.until(
      () => viewer.activeTab()?.error?.code === "BRAWZER_REFUSED_ADDRESS",
      "edge navigation error",
    );
    // Its passwords, for a profile with its browser account on.
    viewer.send({ type: "open-browser-page", page: "passwords" });
    await viewer.until(
      () => viewer.activeTab()?.url.startsWith("edge://wallet") === true,
      "Edge's passwords",
      30_000,
    );
    viewer.close();
    expect((await client.delete(`/browser/sessions/${session.id}`)).statusCode).toBe(204);
  }, 180_000);
});

describe("extensions on Bee", () => {
  it("loads a profile's catalogue extensions over the pipe and says which", async () => {
    const { client } = await account("browser-extensions");
    const profile = profileListSchema.parse((await client.get("/profiles")).json()).profiles[0]!;
    // uBlock Origin itself is Firefox-only: it is kept on the profile and left out on Bee.
    const set = await client.patch(`/profiles/${profile.id}`, {
      extensions: ["ubo-lite", "ublock-origin", "dark-reader"],
    });
    expect(set.statusCode, set.body).toBe(200);
    const { session, viewer } = await openSession(client, profile.id);
    const welcome = viewer.messages.find((m) => m.type === "welcome");
    expect(welcome?.type === "welcome" && welcome.extensions).toEqual(["ubo-lite", "dark-reader"]);
    const runtime = await h.database.pool.query<{ container_id: string }>(
      "select container_id from browser_sessions where id = $1",
      [session.id],
    );
    const env = (await fetchDocker(`/containers/${runtime.rows[0]?.container_id ?? ""}/json`))
      .Config.Env;
    expect(env).toContain("BRAWZER_EXTENSIONS=ubo-lite,dark-reader");
    viewer.close();
    expect((await client.delete(`/browser/sessions/${session.id}`)).statusCode).toBe(204);
  }, 90_000);
});
