import { describe, expect, it } from "vitest";
import { displayUrl, fitViewport, keyMessage, modifiersOf, resolveTyped, textOf } from "./input";

describe("resolveTyped", () => {
  it("opens addresses and hosts, searches everything else", () => {
    expect(resolveTyped("https://example.com/a")).toBe("https://example.com/a");
    expect(resolveTyped("http://example.com")).toBe("http://example.com");
    expect(resolveTyped("example.com")).toBe("https://example.com");
    expect(resolveTyped("news.example.org/path?x=1")).toBe("https://news.example.org/path?x=1");
    expect(resolveTyped("localhost:3000")).toBe("https://localhost:3000");
    expect(resolveTyped("how to tie a knot")).toBe(
      "https://www.google.com/search?q=how+to+tie+a+knot",
    );
    expect(resolveTyped("brawzer")).toBe("https://www.google.com/search?q=brawzer");
    expect(resolveTyped("")).toBe("about:blank");
  });

  it("never opens other schemes", () => {
    expect(resolveTyped("javascript:alert(1)")).toBe(
      "https://www.google.com/search?q=javascript%3Aalert%281%29",
    );
    expect(resolveTyped("file:///etc/passwd")).toMatch(/^https:\/\/www\.google\.com\/search\?/);
  });
});

describe("input helpers", () => {
  it("packs modifiers and finds the inserted text", () => {
    expect(modifiersOf({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: true })).toBe(9);
    expect(textOf({ key: "a", ctrlKey: false, metaKey: false })).toBe("a");
    expect(textOf({ key: "é", ctrlKey: false, metaKey: false })).toBe("é");
    expect(textOf({ key: "Enter", ctrlKey: false, metaKey: false })).toBeUndefined();
    expect(textOf({ key: "c", ctrlKey: true, metaKey: false })).toBeUndefined();
  });

  it("builds key messages", () => {
    expect(
      keyMessage("t", "down", {
        key: "Backspace",
        code: "Backspace",
        keyCode: 8,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toEqual({
      type: "key",
      tabId: "t",
      kind: "down",
      key: "Backspace",
      code: "Backspace",
      keyCode: 8,
      modifiers: 0,
    });
  });

  it("clamps the viewport to what the engine streams", () => {
    expect(fitViewport(3000, 2000)).toEqual({ width: 1920, height: 1080, scale: 1 });
    expect(fitViewport(100.7, 100)).toEqual({ width: 320, height: 240, scale: 1 });
    expect(fitViewport(1280.9, 800.2)).toEqual({ width: 1280, height: 800, scale: 1 });
  });

  it("asks for a still page as sharp as the screen, within the limit and the pixel budget", () => {
    expect(fitViewport(1280, 800, 2)).toEqual({ width: 1280, height: 800, scale: 2 });
    expect(fitViewport(1280, 800, 3)).toEqual({ width: 1280, height: 800, scale: 2 });
    expect(fitViewport(1280, 800, 1.5)).toEqual({ width: 1280, height: 800, scale: 1.5 });
    expect(fitViewport(1280, 800, 0.8)).toEqual({ width: 1280, height: 800, scale: 1 });
    expect(fitViewport(1280, 800, Number.NaN)).toEqual({ width: 1280, height: 800, scale: 1 });
    // 1920 × 1080 at 2 would be 8.3 million pixels: the budget allows 1.7.
    expect(fitViewport(1920, 1080, 2)).toEqual({ width: 1920, height: 1080, scale: 1.7 });
  });

  it("shortens addresses for display", () => {
    expect(displayUrl("https://example.com/x")).toBe("example.com/x");
    expect(displayUrl("http://example.com")).toBe("http://example.com");
    expect(displayUrl("about:blank")).toBe("");
  });
});
