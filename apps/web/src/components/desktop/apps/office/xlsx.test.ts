import { describe, expect, it } from "vitest";
import { strFromU8 } from "fflate";
import { readParts, writeParts } from "./package-xml";
import { cellsToXlsx, xlsxToCells } from "./xlsx";

describe("Excel workbooks", () => {
  it("writes a sheet that reads back with its formulas", () => {
    const cells = {
      A1: "Item",
      B1: "Cost",
      A2: "Pens",
      B2: "3.5",
      A3: "Total",
      B3: "=SUM(B2:B2)*2",
      C4: 'a,b "q"',
    };
    const bytes = cellsToXlsx(cells);
    const parts = readParts(bytes);
    const sheet = strFromU8(parts?.["xl/worksheets/sheet1.xml"] ?? new Uint8Array());
    expect(sheet).toContain('<c r="B3"><f>SUM(B2:B2)*2</f><v>7</v></c>');
    expect(sheet).toContain('<c r="B2"><v>3.5</v></c>');
    expect(sheet).toContain('t="inlineStr"');
    expect(xlsxToCells(bytes)).toEqual({ cells, beyond: 0 });
  });

  it("reads shared strings, cached values and leaves cells beyond the grid", () => {
    const bytes = cellsToXlsx({ A1: "x" });
    const parts = { ...(readParts(bytes) ?? {}) };
    const encode = (text: string) => new TextEncoder().encode(text);
    parts["xl/sharedStrings.xml"] = encode(
      '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Shared</t></si><si><r><t>Two </t></r><r><t>parts</t></r></si></sst>',
    );
    parts["xl/worksheets/sheet1.xml"] = encode(
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><f t="shared" si="0"/><v>9</v></c><c r="D1" t="b"><v>1</v></c><c r="Z1"><v>1</v></c><c r="A99"><v>2</v></c></row></sheetData></worksheet>',
    );
    expect(xlsxToCells(writeParts(parts))).toEqual({
      cells: { A1: "Shared", B1: "Two parts", C1: "9", D1: "TRUE" },
      beyond: 2,
    });
  });

  it("says when bytes aren't a workbook", () => {
    expect(xlsxToCells(new TextEncoder().encode("nope"))).toBeNull();
  });
});
