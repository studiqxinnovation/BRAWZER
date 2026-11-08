import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CdpConnection, CdpError } from "./cdp.ts";

function connection() {
  const toEngine = new PassThrough();
  const fromEngine = new PassThrough();
  const written: string[] = [];
  toEngine.on("data", (chunk: Buffer) => {
    written.push(...chunk.toString("utf8").split("\0").filter(Boolean));
  });
  return { cdp: new CdpConnection(toEngine, fromEngine), fromEngine, written };
}

describe("CdpConnection", () => {
  it("matches replies to commands and delivers events with their session", async () => {
    const { cdp, fromEngine, written } = connection();
    const events: unknown[] = [];
    cdp.on("Page.loadEventFired", (params, sessionId) => events.push({ params, sessionId }));

    const reply = cdp.send<{ product: string }>("Browser.getVersion");
    await new Promise((resolve) => setImmediate(resolve));
    expect(JSON.parse(written[0]!)).toEqual({ id: 1, method: "Browser.getVersion", params: {} });

    // Messages may arrive split across chunks and several per chunk.
    const first = JSON.stringify({ id: 1, result: { product: "Chrome/156" } });
    const event = JSON.stringify({
      method: "Page.loadEventFired",
      params: { timestamp: 1 },
      sessionId: "S1",
    });
    fromEngine.write(first.slice(0, 10));
    fromEngine.write(`${first.slice(10)}\0${event}\0`);

    expect(await reply).toEqual({ product: "Chrome/156" });
    expect(events).toEqual([{ params: { timestamp: 1 }, sessionId: "S1" }]);
  });

  it("turns protocol errors into CdpError and fails everything when the pipe closes", async () => {
    const { cdp, fromEngine } = connection();
    const failing = cdp.send("Page.navigate", { url: "x" }, "S1");
    fromEngine.write(`${JSON.stringify({ id: 1, error: { code: -32000, message: "nope" } })}\0`);
    await expect(failing).rejects.toBeInstanceOf(CdpError);

    const hanging = cdp.send("Page.reload");
    fromEngine.end();
    await expect(hanging).rejects.toThrow("closed");
    expect(cdp.isClosed).toBe(true);
    await expect(cdp.send("Page.reload")).rejects.toThrow("closed");
  });
});
