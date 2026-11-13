import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("keeps paths on this site, with their query and fragment", () => {
    expect(safeNextPath("/app")).toBe("/app");
    expect(safeNextPath("/app/profiles?tab=work#top")).toBe("/app/profiles?tab=work#top");
  });

  it("falls back to /app when nothing usable is given", () => {
    expect(safeNextPath(null)).toBe("/app");
    expect(safeNextPath(undefined)).toBe("/app");
    expect(safeNextPath("")).toBe("/app");
    expect(safeNextPath("app")).toBe("/app");
  });

  it.each([
    "https://evil.example/app",
    "//evil.example/app",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "/%2F%2Fevil.example",
  ])("refuses to leave the site: %s", (value) => {
    const result = safeNextPath(value);
    expect(result.startsWith("/")).toBe(true);
    expect(result.startsWith("//")).toBe(false);
    expect(new URL(result, "https://brawzer.example").origin).toBe("https://brawzer.example");
  });

  it("never sends someone back into the sign-in flow", () => {
    expect(safeNextPath("/sign-in?next=/app")).toBe("/app");
    expect(safeNextPath("/reset-password")).toBe("/app");
    expect(safeNextPath("/confirm-email-change")).toBe("/app");
    expect(safeNextPath("/undo-email-change#token=x")).toBe("/app");
  });
});
