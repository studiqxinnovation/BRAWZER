import { describe, expect, it } from "vitest";
import { base64Of, screenshotName } from "./picture";

describe("screenshot names", () => {
  it("name the host and the local time, with nothing Drive would change", () => {
    const at = new Date(2026, 10, 8, 7, 5, 3);
    expect(screenshotName("shop.example", at)).toBe(
      "Screenshot of shop.example, 2026-11-08 at 07.05.03.png",
    );
    expect(screenshotName("", at)).toBe("Screenshot of a page, 2026-11-08 at 07.05.03.png");
    expect(screenshotName("a/b:c", at)).toBe("Screenshot of abc, 2026-11-08 at 07.05.03.png");
  });
});

describe("base64Of", () => {
  it("encodes a blob's bytes, large ones too", async () => {
    const bytes = new Uint8Array(100_000).map((_, index) => index % 251);
    const encoded = await base64Of(new Blob([bytes]));
    expect(Buffer.from(encoded, "base64").equals(Buffer.from(bytes))).toBe(true);
  });
});
