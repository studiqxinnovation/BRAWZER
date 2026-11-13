/**
 * Excel workbooks (.xlsx) in and out of Calc. In: the first sheet's cells
 * within Calc's grid, formulas kept as formulas where the file has their
 * text, values otherwise. Out: one sheet with inline strings, numbers and
 * formulas, which Excel, Numbers and LibreOffice recalculate when opened.
 */
import { COLUMNS, evaluate, ROWS } from "../calc-engine";
import {
  attribute,
  contentTypesXml,
  descendants,
  escapeXml,
  kid,
  PACKAGE_RELS,
  type Parts,
  partXml,
  readParts,
  readRelationships,
  relationshipsXml,
  resolvePart,
  writeParts,
  XML_HEAD,
} from "./package-xml";

export interface XlsxImport {
  cells: Record<string, string>;
  /** Cells outside Calc's grid of 12 columns by 40 rows, left behind. */
  beyond: number;
}

const ADDRESS = /^([A-Z]+)(\d+)$/;

function sharedStrings(parts: Parts): string[] {
  const xml = partXml(parts, "xl/sharedStrings.xml");
  if (!xml) return [];
  return descendants(xml, "si").map((item) =>
    descendants(item, "t")
      .map((t) => t.textContent)
      .join(""),
  );
}

/** The first worksheet's part path. */
function firstSheetPath(parts: Parts): string | null {
  const workbook = partXml(parts, "xl/workbook.xml");
  const first = workbook ? descendants(workbook, "sheet")[0] : undefined;
  const id = first ? attribute(first, "id") : null;
  const relationships = readRelationships(parts, "xl/_rels/workbook.xml.rels");
  const target = id ? relationships.get(id) : undefined;
  const resolved = target ? resolvePart(parts, "xl/", target) : null;
  return resolved ?? ("xl/worksheets/sheet1.xml" in parts ? "xl/worksheets/sheet1.xml" : null);
}

/** Calc's cells from the first sheet, or null when it isn't a workbook. */
export function xlsxToCells(bytes: Uint8Array): XlsxImport | null {
  const parts = readParts(bytes);
  if (!parts) return null;
  const path = firstSheetPath(parts);
  const sheet = path ? partXml(parts, path) : null;
  if (!sheet) return null;
  const strings = sharedStrings(parts);
  const cells: Record<string, string> = {};
  let beyond = 0;
  for (const cell of descendants(sheet, "c")) {
    const address = attribute(cell, "r");
    const match = address ? ADDRESS.exec(address) : null;
    if (!match) continue;
    const column = match[1] ?? "";
    const row = Number(match[2]);
    const type = attribute(cell, "t");
    const formula = kid(cell, "f");
    const value = kid(cell, "v")?.textContent ?? "";
    let raw: string;
    if (formula?.textContent) raw = `=${formula.textContent}`;
    else if (type === "s") raw = strings[Number(value)] ?? "";
    else if (type === "inlineStr") {
      raw = descendants(cell, "t")
        .map((t) => t.textContent)
        .join("");
    } else if (type === "b") raw = value === "1" ? "TRUE" : "FALSE";
    else raw = value;
    if (raw === "") continue;
    if (!COLUMNS.includes(column) || row < 1 || row > ROWS) {
      beyond += 1;
      continue;
    }
    cells[`${column}${String(row)}`] = raw;
  }
  return { cells, beyond };
}

const SHEET_XML = "application/vnd.openxmlformats-officedocument.spreadsheetml";

const STYLES = `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** A workbook with Calc's sheet. */
export function cellsToXlsx(cells: Readonly<Record<string, string>>): Uint8Array<ArrayBuffer> {
  const results = evaluate(cells);
  const rows = new Map<number, string[]>();
  for (const [address, raw] of Object.entries(cells)) {
    if (!raw) continue;
    const match = ADDRESS.exec(address);
    if (!match) continue;
    const row = Number(match[2]);
    let xml: string;
    if (raw.startsWith("=")) {
      const result = results[address];
      const cached =
        typeof result === "number" && Number.isFinite(result)
          ? `<v>${String(result)}</v>`
          : typeof result === "string" && result !== ""
            ? `<v>${escapeXml(result)}</v>`
            : "";
      const stringResult = typeof result === "string" && result !== "" ? ' t="str"' : "";
      xml = `<c r="${address}"${stringResult}><f>${escapeXml(raw.slice(1))}</f>${cached}</c>`;
    } else if (NUMBER.test(raw.trim())) {
      xml = `<c r="${address}"><v>${escapeXml(raw.trim())}</v></c>`;
    } else {
      xml = `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(raw)}</t></is></c>`;
    }
    const list = rows.get(row) ?? [];
    list.push(xml);
    rows.set(row, list);
  }
  const ordered = Array.from(rows.entries()).sort(([a], [b]) => a - b);
  const sheetData = ordered
    .map(([row, list]) => `<row r="${String(row)}">${list.join("")}</row>`)
    .join("");
  const sheet = `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`;
  const workbook = `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><calcPr fullCalcOnLoad="1"/></workbook>`;
  return writeParts({
    "[Content_Types].xml": contentTypesXml(
      {},
      {
        "/xl/workbook.xml": `${SHEET_XML}.sheet.main+xml`,
        "/xl/worksheets/sheet1.xml": `${SHEET_XML}.worksheet+xml`,
        "/xl/styles.xml": `${SHEET_XML}.styles+xml`,
      },
    ),
    "_rels/.rels": PACKAGE_RELS.replace("%MAIN%", "xl/workbook.xml"),
    "xl/workbook.xml": workbook,
    "xl/_rels/workbook.xml.rels": relationshipsXml([
      { id: "rId1", type: "worksheet", target: "worksheets/sheet1.xml" },
      { id: "rId2", type: "styles", target: "styles.xml" },
    ]),
    "xl/worksheets/sheet1.xml": sheet,
    "xl/styles.xml": STYLES,
  });
}
