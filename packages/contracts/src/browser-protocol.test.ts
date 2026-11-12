import { describe, expect, it } from "vitest";
import {
  agentMessageSchema,
  binaryKind,
  browserUrlSchema,
  clientMessageSchema,
  decodeFrame,
  decodeTransferChunk,
  encodeFrame,
  encodeTransferChunk,
  TRANSFER_CHUNK_BYTES,
} from "./browser-protocol.ts";

describe("browser URLs", () => {
  it("accepts only http and https", () => {
    expect(browserUrlSchema.safeParse("https://example.com/a?b=c").success).toBe(true);
    expect(browserUrlSchema.safeParse("http://example.com").success).toBe(true);
    for (const bad of [
      "file:///etc/passwd",
      "chrome://settings",
      "javascript:alert(1)",
      "data:text/html,hi",
      "about:blank",
      "example.com",
      "",
    ]) {
      expect(browserUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("client messages", () => {
  it("fills in defaults for mouse events", () => {
    const parsed = clientMessageSchema.parse({
      type: "mouse",
      tabId: "t",
      kind: "move",
      x: 1,
      y: 2,
    });
    expect(parsed).toMatchObject({ button: "none", buttons: 0, clickCount: 0, modifiers: 0 });
  });

  it("rejects unknown types and out-of-range input", () => {
    expect(clientMessageSchema.safeParse({ type: "eval", code: "1" }).success).toBe(false);
    expect(
      clientMessageSchema.safeParse({ type: "mouse", tabId: "t", kind: "move", x: -1, y: 0 })
        .success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({ type: "hello", viewport: { width: 10, height: 10 } }).success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        type: "hello",
        viewport: { width: 1280, height: 800, scale: 3 },
      }).success,
    ).toBe(false);
  });

  it("a viewport without a scale asks for none", () => {
    const parsed = clientMessageSchema.parse({
      type: "resize",
      viewport: { width: 1280, height: 800 },
    });
    expect(parsed).toMatchObject({ viewport: { width: 1280, height: 800, scale: 1 } });
    expect(
      clientMessageSchema.parse({
        type: "resize",
        viewport: { width: 1280, height: 800, scale: 2 },
      }),
    ).toMatchObject({ viewport: { scale: 2 } });
  });
});

describe("agent messages", () => {
  it("validates a tabs snapshot", () => {
    const parsed = agentMessageSchema.safeParse({
      type: "tabs",
      activeTabId: "a",
      tabs: [
        {
          id: "a",
          url: "https://example.com/",
          title: "Example",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          security: "secure",
          error: null,
          zoom: 1,
          reader: false,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("frames", () => {
  it("round-trips a header and image", () => {
    const image = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const bytes = encodeFrame(
      { tabId: "tab-1", frameId: 7, width: 1280, height: 800, scale: 1 },
      image,
    );
    const decoded = decodeFrame(bytes);
    expect(decoded?.header).toEqual({
      tabId: "tab-1",
      frameId: 7,
      width: 1280,
      height: 800,
      scale: 1,
    });
    expect(Array.from(decoded?.image ?? [])).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it("carries a sharp frame of a still page, twice the size on screen", () => {
    const image = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const sharp = decodeFrame(
      encodeFrame({ tabId: "tab-1", frameId: 8, width: 3840, height: 2160, scale: 2 }, image),
    );
    expect(sharp?.header).toMatchObject({ width: 3840, height: 2160, scale: 2 });
    expect(
      decodeFrame(
        encodeFrame({ tabId: "tab-1", frameId: 9, width: 3841, height: 2160, scale: 2 }, image),
      ),
    ).toBeNull();
  });

  it("refuses malformed frames", () => {
    expect(decodeFrame(new Uint8Array([0x42]))).toBeNull();
    expect(decodeFrame(new Uint8Array([0x41, 1, 0, 0, 0, 0]))).toBeNull();
    expect(decodeFrame(new Uint8Array([0x42, 1, 0xff, 0xff, 0xff, 0xff]))).toBeNull();
    const badHeader = new Uint8Array([0x42, 1, 0, 0, 0, 2, 0x7b, 0x7d]);
    expect(decodeFrame(badHeader)).toBeNull();
  });
});

describe("transfer chunks", () => {
  it("round-trips a chunk and tells the two binary kinds apart", () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const bytes = encodeTransferChunk({ transferId: "dl-1", seq: 3, last: true }, data);
    expect(binaryKind(bytes)).toBe("transfer");
    expect(decodeFrame(bytes)).toBeNull();
    const decoded = decodeTransferChunk(bytes);
    expect(decoded?.header).toEqual({ transferId: "dl-1", seq: 3, last: true });
    expect(Array.from(decoded?.data ?? [])).toEqual([1, 2, 3, 4]);

    const frame = encodeFrame({ tabId: "t", frameId: 1, width: 10, height: 10, scale: 1 }, data);
    expect(binaryKind(frame)).toBe("frame");
    expect(decodeTransferChunk(frame)).toBeNull();
    expect(binaryKind(new Uint8Array([0x58, 1, 0, 0, 0, 0]))).toBeNull();
  });

  it("refuses oversized chunks and bad headers", () => {
    const big = encodeTransferChunk(
      { transferId: "x", seq: 0, last: false },
      new Uint8Array(TRANSFER_CHUNK_BYTES + 1),
    );
    expect(decodeTransferChunk(big)).toBeNull();
    const badHeader = encodeTransferChunk(
      { transferId: "", seq: -1, last: false },
      new Uint8Array(1),
    );
    expect(decodeTransferChunk(badHeader)).toBeNull();
  });
});

describe("transfer and file chooser messages", () => {
  it("validates the agent's transfer states and the page's chooser answer", () => {
    expect(
      agentMessageSchema.safeParse({
        type: "transfer",
        transferId: "dl-1",
        tabId: "t",
        kind: "download",
        filename: "report.pdf",
        state: "saved",
        bytes: 10,
        fileId: "019a0b1c-0000-7000-8000-000000000000",
      }).success,
    ).toBe(true);
    expect(
      agentMessageSchema.safeParse({
        type: "transfer",
        transferId: "dl-1",
        tabId: "t",
        kind: "download",
        filename: "report.pdf",
        state: "exploded",
      }).success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        type: "file-chooser",
        tabId: "t",
        chooserId: "c1",
        fileIds: ["019a0b1c-0000-7000-8000-000000000000"],
      }).success,
    ).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        type: "file-chooser",
        tabId: "t",
        chooserId: "c1",
        fileIds: ["nope"],
      }).success,
    ).toBe(false);
    expect(clientMessageSchema.safeParse({ type: "print", tabId: "t" }).success).toBe(true);
  });
});

describe("audio chunks", () => {
  it("round-trip, keep a whole number of samples and tell their kind", async () => {
    const { encodeAudioChunk, decodeAudioChunk, binaryKind } =
      await import("./browser-protocol.ts");
    const samples = new Uint8Array([0, 1, 2, 3]);
    const bytes = encodeAudioChunk({ seq: 7, sampleRate: 24_000, channels: 1 }, samples);
    expect(binaryKind(bytes)).toBe("audio");
    expect(decodeAudioChunk(bytes)).toEqual({
      header: { seq: 7, sampleRate: 24_000, channels: 1 },
      samples,
    });
    expect(
      decodeAudioChunk(
        encodeAudioChunk({ seq: 0, sampleRate: 24_000, channels: 2 }, samples.subarray(0, 2)),
      ),
    ).toBeNull();
  });
});
