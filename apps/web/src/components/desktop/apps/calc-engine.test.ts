import { describe, expect, it } from "vitest";
import { display, evaluate, fromCsv, toCsv } from "./calc-engine";

describe("calc", () => {
  it("works out formulas with references, ranges and functions", () => {
    const results = evaluate({
      A1: "10",
      A2: "20",
      A3: "1,000",
      B1: "=SUM(A1:A3)",
      B2: "=AVERAGE(A1:A2) * 2",
      B3: "=(A1 + A2) / 4 - 2^3",
      B4: "=ROUND(10/3, 2)",
      B5: "=MAX(A1:A3, 5000) - MIN(A1, A2)",
      B6: "=COUNT(A1:A9)",
      B7: "=-A1 + ABS(-3)",
      C1: "Total",
    });
    expect(results.B1).toBe(1030);
    expect(results.B2).toBe(30);
    expect(results.B3).toBe(-0.5);
    expect(results.B4).toBe(3.33);
    expect(results.B5).toBe(4990);
    expect(results.B6).toBe(3);
    expect(results.B7).toBe(-7);
    expect(results.C1).toBe("Total");
  });

  it("names errors as spreadsheets do", () => {
    const results = evaluate({
      A1: "=1/0",
      A2: "=A3",
      A3: "=A2",
      A4: "=NOPE(1)",
      A5: "=Z9",
      A6: "=1 +",
      A7: "=A1 + 1",
      A8: "=B1 * 2",
      B1: "words",
    });
    expect(results.A1).toBe("#DIV/0!");
    expect(results.A2).toBe("#CYCLE!");
    expect(results.A4).toBe("#NAME?");
    expect(results.A5).toBe("#REF!");
    expect(results.A6).toBe("#ERROR!");
    expect(results.A7).toBe("#DIV/0!");
    expect(results.A8).toBe("#ERROR!");
    expect(display(0.1 + 0.2)).toBe("0.3");
    expect(display(1234567.5)).toBe("1,234,567.5");
  });

  it("goes to CSV and back, formulas and quotes kept", () => {
    const cells = { A1: "Name", B1: "Amount", A2: 'Café, "best"', B2: "12.5", B3: "=SUM(B2:B2)" };
    const csv = toCsv(cells);
    expect(csv).toBe('Name,Amount\r\n"Café, ""best""",12.5\r\n,=SUM(B2:B2)');
    expect(fromCsv(csv)).toEqual(cells);
  });
});
