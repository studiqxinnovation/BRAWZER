import { describe, expect, it } from "vitest";
import {
  deriveHistoryKeys,
  isRecordable,
  newHistoryKey,
  openValue,
  sealValue,
  urlDigest,
} from "./history-crypto.js";

describe("history encryption", () => {
  const keys = deriveHistoryKeys(newHistoryKey());

  it("seals values bound to their context", () => {
    const sealed = sealValue(keys, "history:p:1", { u: "https://example.com/", t: "Example" });
    expect(sealed).not.toContain("example");
    expect(openValue(keys, "history:p:1", sealed)).toEqual({
      u: "https://example.com/",
      t: "Example",
    });
    // Moved to another row, or opened with another profile's key, it doesn't open.
    expect(() => openValue(keys, "history:p:2", sealed)).toThrow();
    expect(() => openValue(deriveHistoryKeys(newHistoryKey()), "history:p:1", sealed)).toThrow();
  });

  it("digests an address the same way for one key only", () => {
    expect(urlDigest(keys, "https://example.com/")).toBe(urlDigest(keys, "https://example.com/"));
    expect(urlDigest(keys, "https://example.com/")).not.toBe(
      urlDigest(keys, "https://example.org/"),
    );
    expect(urlDigest(deriveHistoryKeys(newHistoryKey()), "https://example.com/")).not.toBe(
      urlDigest(keys, "https://example.com/"),
    );
  });

  it("records real pages only", () => {
    expect(isRecordable("https://example.com/a?b=c")).toBe(true);
    expect(isRecordable("http://testsite.invalid/")).toBe(true);
    for (const url of [
      "",
      "about:blank",
      "https://bee.invalid/",
      "chrome://settings",
      "file:///etc/passwd",
      "data:text/html,x",
      `https://e.com/${"a".repeat(2050)}`,
    ]) {
      expect(isRecordable(url), url).toBe(false);
    }
  });
});
