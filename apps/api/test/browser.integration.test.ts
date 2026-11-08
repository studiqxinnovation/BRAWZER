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
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";

// Requires the local services (`pnpm infra:up`), the Docker engine and the
// runtime image (`pnpm runtime:build`). Each test starts a real container.
let h: Harness;
let baseUrl: string;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.69.0", env: { BROWSER_TEST_SITE: "true" } });
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
          `Timed out waiting for ${label} (close code ${String(this.closeCode)}, ${String(this.messages.length)} messages, ${String(this.frames.length)} frames, last: ${last ? JSON.stringify(last).slice(0, 200) : "none"})`,
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
    await viewer.until(
      () => viewer.messages.some((m) => m.type === "refused" && m.action === "download"),
      "download refusal",
    );

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
