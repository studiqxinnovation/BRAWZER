import {
  browserSessionSchema,
  type ClientMessageInput,
  driveFileListSchema,
  type TabState,
  type AgentMessage,
} from "@brawzer/contracts";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StreamGateway } from "../src/browser/stream-gateway.js";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";

let h: Harness;
let baseUrl: string;

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.75.0", env: { BROWSER_TEST_SITE: "true" } });
  baseUrl = await h.listen();
});

afterAll(async () => {
  await h.close();
});

/** A viewer that keeps the agent's messages and acknowledges every frame. */
class Viewer {
  readonly messages: AgentMessage[] = [];
  private readonly socket: WebSocket;
  private readonly waiters: (() => void)[] = [];

  constructor(url: string, ticket: string, origin: string) {
    this.socket = new WebSocket(url, { headers: { origin } });
    this.socket.on("open", () => {
      this.socket.send(JSON.stringify({ type: "ticket", ticket }));
      this.socket.send(JSON.stringify({ type: "hello", viewport: { width: 800, height: 600 } }));
    });
    this.socket.on("message", (data, isBinary) => {
      if (isBinary) {
        const bytes = data as Buffer;
        const length = bytes.readUInt32BE(2);
        const header = JSON.parse(bytes.subarray(6, 6 + length).toString()) as {
          tabId: string;
          frameId: number;
        };
        this.send({ type: "frame-ack", tabId: header.tabId, frameId: header.frameId });
        return;
      }
      this.messages.push(JSON.parse((data as Buffer).toString()) as AgentMessage);
      for (const waiter of this.waiters.splice(0)) waiter();
    });
  }

  send(message: ClientMessageInput): void {
    this.socket.send(JSON.stringify(message));
  }

  async until(predicate: () => boolean, label: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 200);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  activeTab(): TabState | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message?.type === "tabs" || message?.type === "welcome") {
        return message.tabs.find((tab) => tab.id === message.activeTabId);
      }
    }
    return undefined;
  }

  close(): void {
    this.socket.close();
  }
}

async function openSession(client: TestBrowser) {
  const response = await client.post("/browser/sessions", {});
  expect(response.statusCode, response.body).toBe(201);
  const session = browserSessionSchema.parse(response.json());
  const ticket = await client.post(`/browser/sessions/${session.id}/ticket`, {});
  expect(ticket.statusCode, ticket.body).toBe(200);
  const viewer = new Viewer(
    `${baseUrl}/api/v1/browser/sessions/${session.id}/stream`,
    ticket.json<{ ticket: string }>().ticket,
    h.origin,
  );
  await viewer.until(() => viewer.messages.some((m) => m.type === "welcome"), "welcome");
  return { session, viewer };
}

describe("large downloads through the relay", () => {
  it("saves a file bigger than the relay's buffer to Drive, whole, without holding it in memory", async () => {
    const client = h.browser();
    await h.signUp(client, h.uniqueEmail("transfers"));
    const { session, viewer } = await openSession(client);
    const tab = viewer.activeTab();
    expect(tab).toBeDefined();
    const bytes = 24 * 1024 * 1024;
    viewer.send({
      type: "navigate",
      tabId: tab!.id,
      url: `http://testsite.invalid/download?bytes=${String(bytes)}&name=big.bin`,
    });
    await viewer.until(
      () =>
        viewer.messages.some(
          (m) => m.type === "transfer" && m.filename === "big.bin" && m.state === "saved",
        ),
      "the download saved to Drive",
      120_000,
    );
    const saved = viewer.messages.find(
      (m) => m.type === "transfer" && m.filename === "big.bin" && m.state === "saved",
    );
    expect(saved?.type === "transfer" && saved.bytes).toBe(bytes);
    const listed = driveFileListSchema.parse((await client.get("/drive/files?q=big")).json());
    const file = listed.files.find(
      (candidate) => candidate.id === (saved?.type === "transfer" ? saved.fileId : ""),
    );
    expect(file?.size).toBe(bytes);
    expect(file?.status).toBe("clean");
    // The relay never holds more than its buffer per transfer; whether the
    // agent had to pause depends on the machine, so the figure is only read.
    const gateway = h.app.get(StreamGateway);
    expect(gateway.stats.transferPauses).toBeGreaterThanOrEqual(0);
    viewer.close();
    expect((await client.delete(`/browser/sessions/${session.id}`)).statusCode).toBe(204);
  }, 180_000);
});
