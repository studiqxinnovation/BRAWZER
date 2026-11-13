import { describe, expect, it } from "vitest";
import { parseDesktopRequest } from "./desktop-context";

describe("parseDesktopRequest", () => {
  it("reads the desktop's volume, clamped to 0 to 100, and refuses anything else", () => {
    expect(parseDesktopRequest({ type: "brawzer:volume", volume: 35 })).toEqual({
      type: "brawzer:volume",
      volume: 35,
    });
    expect(parseDesktopRequest({ type: "brawzer:volume", volume: 140 })).toEqual({
      type: "brawzer:volume",
      volume: 100,
    });
    expect(parseDesktopRequest({ type: "brawzer:volume", volume: -3 })).toEqual({
      type: "brawzer:volume",
      volume: 0,
    });
    expect(parseDesktopRequest({ type: "brawzer:volume", volume: "loud" })).toBeNull();
    expect(parseDesktopRequest({ type: "brawzer:volume" })).toBeNull();
  });

  it("still reads the other requests", () => {
    expect(parseDesktopRequest({ type: "brawzer:screenshot" })).toEqual({
      type: "brawzer:screenshot",
    });
    expect(parseDesktopRequest("nope")).toBeNull();
    expect(parseDesktopRequest({ type: "brawzer:nothing" })).toBeNull();
  });
});
