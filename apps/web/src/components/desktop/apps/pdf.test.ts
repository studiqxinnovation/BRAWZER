import { describe, expect, it } from "vitest";
import { makePdf, textWidth, wrap } from "./pdf";

const latin1 = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

describe("pdf", () => {
  it("writes a document whose cross-reference table points at each object", () => {
    const bytes = makePdf(
      [
        {
          texts: [{ x: 50, y: 800, size: 12, text: "Invoice (draft) £12.50 – café" }],
          lines: [],
          boxes: [],
        },
      ],
      "INV-0001",
    );
    const text = latin1(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // Parentheses are escaped, £ and é are single WinAnsi bytes, the dash is 0x96.
    expect(text).toContain("(Invoice \\(draft\\) £12.50 \u0096 café) Tj");
    const xref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(xref).startsWith("xref")).toBe(true);
    const entries = text
      .slice(xref)
      .split("\n")
      .slice(3)
      .filter((line) => line.endsWith(" n "));
    entries.forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset).startsWith(`${String(index + 1)} 0 obj`)).toBe(true);
    });
  });

  it("measures and wraps text", () => {
    expect(textWidth("Hello", 10)).toBeCloseTo(22.78, 1);
    expect(wrap("one two three four", 10, 40)).toEqual(["one two", "three", "four"]);
  });
});
