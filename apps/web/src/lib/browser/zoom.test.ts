import { describe, expect, it } from "vitest";
import { nextZoom, zoomLabel } from "./zoom";

describe("zoom steps", () => {
  it("steps along the scale and stops at its ends", () => {
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(3, 1)).toBe(3);
    expect(nextZoom(0.5, -1)).toBe(0.5);
    expect(nextZoom(1.3, 1)).toBe(1.5);
    expect(nextZoom(1.3, -1)).toBe(1.25);
  });
  it("labels as a percentage", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(0.67)).toBe("67%");
  });
});
