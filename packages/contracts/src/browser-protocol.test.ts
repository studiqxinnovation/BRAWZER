import { describe, expect, it } from "vitest";
import {
  agentMessageSchema,
  browserUrlSchema,
  clientMessageSchema,
  decodeFrame,
  encodeFrame,
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
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("frames", () => {
  it("round-trips a header and image", () => {
    const image = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const bytes = encodeFrame({ tabId: "tab-1", frameId: 7, width: 1280, height: 800 }, image);
    const decoded = decodeFrame(bytes);
    expect(decoded?.header).toEqual({ tabId: "tab-1", frameId: 7, width: 1280, height: 800 });
    expect(Array.from(decoded?.image ?? [])).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it("refuses malformed frames", () => {
    expect(decodeFrame(new Uint8Array([0x42]))).toBeNull();
    expect(decodeFrame(new Uint8Array([0x41, 1, 0, 0, 0, 0]))).toBeNull();
    expect(decodeFrame(new Uint8Array([0x42, 1, 0xff, 0xff, 0xff, 0xff]))).toBeNull();
    const badHeader = new Uint8Array([0x42, 1, 0, 0, 0, 2, 0x7b, 0x7d]);
    expect(decodeFrame(badHeader)).toBeNull();
  });
});
