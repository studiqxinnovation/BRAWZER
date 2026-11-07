import { describe, expect, it } from "vitest";
import { composite, contrastRatio, parseCssColor, toHex } from "./color";

const white = { r: 255, g: 255, b: 255, a: 1 };
const black = { r: 0, g: 0, b: 0, a: 1 };

describe("parseCssColor", () => {
  it("reads the formats browsers compute", () => {
    expect(parseCssColor("rgb(28, 27, 25)")).toEqual({ r: 28, g: 27, b: 25, a: 1 });
    expect(parseCssColor("rgba(28, 27, 25, 0.5)")).toEqual({ r: 28, g: 27, b: 25, a: 0.5 });
    expect(parseCssColor("rgb(28 27 25 / 50%)")).toEqual({ r: 28, g: 27, b: 25, a: 0.5 });
    const mixed = parseCssColor("color(srgb 1 0.5 0 / 0.11)");
    expect(mixed?.a).toBeCloseTo(0.11);
    expect(mixed?.g).toBeCloseTo(127.5);
  });

  it("returns null for anything else", () => {
    expect(parseCssColor("oklch(0.5 0.1 200)")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    // #767676 on white is the classic 4.54:1 AA threshold example.
    expect(contrastRatio({ r: 118, g: 118, b: 118, a: 1 }, white)).toBeCloseTo(4.54, 2);
  });

  it("is symmetric", () => {
    const grey = { r: 94, g: 91, b: 86, a: 1 };
    expect(contrastRatio(grey, white)).toBe(contrastRatio(white, grey));
  });
});

describe("composite", () => {
  it("flattens translucent colours onto a background", () => {
    expect(composite({ ...black, a: 0.5 }, white)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });
});

describe("toHex", () => {
  it("formats upper-case hex", () => {
    expect(toHex({ r: 43, g: 91, b: 224, a: 1 })).toBe("#2B5BE0");
  });
});
