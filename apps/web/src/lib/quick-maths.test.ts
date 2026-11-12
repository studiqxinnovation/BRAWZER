import { describe, expect, it } from "vitest";
import { formatAnswer, quickMaths } from "./quick-maths";

describe("quickMaths", () => {
  it("works out sums with precedence, brackets, powers and percentages", () => {
    expect(quickMaths("2+2")).toBe(4);
    expect(quickMaths("2 + 3 * 4")).toBe(14);
    expect(quickMaths("(2 + 3) * 4")).toBe(20);
    expect(quickMaths("2^10")).toBe(1024);
    expect(quickMaths("10 / 4")).toBe(2.5);
    expect(quickMaths("15% * 200")).toBe(30);
    expect(quickMaths("-3 + 5")).toBe(2);
    expect(quickMaths("sqrt(16) + 1")).toBe(5);
    expect(quickMaths("1,000 × 3")).toBe(3000);
    expect(quickMaths("2 * pi")).toBeCloseTo(Math.PI * 2);
  });

  it("is not fooled by words, lone numbers or broken sums", () => {
    expect(quickMaths("notes")).toBeNull();
    expect(quickMaths("42")).toBeNull();
    expect(quickMaths("2 +")).toBeNull();
    expect(quickMaths("1 / 0")).toBeNull();
    expect(quickMaths("alert(1)")).toBeNull();
    expect(quickMaths("(2 + 3")).toBeNull();
    expect(quickMaths("")).toBeNull();
  });

  it("formats answers plainly", () => {
    expect(formatAnswer(4)).toBe("4");
    expect(formatAnswer(1_000_000)).toBe("1,000,000");
    expect(formatAnswer(1 / 3)).toBe("0.3333333333");
  });
});
