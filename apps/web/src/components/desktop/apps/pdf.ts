/**
 * A small PDF writer for what the apps print: text in Helvetica (regular and
 * bold), lines and filled boxes on A4 pages. Text uses the PDF's own
 * WinAnsi encoding, which covers English and western European letters, £
 * and €; anything else is written as "?".
 */

export const A4 = { width: 595.28, height: 841.89 };

type Colour = readonly [number, number, number];

export interface PdfPage {
  texts: { x: number; y: number; size: number; text: string; bold?: boolean; colour?: Colour }[];
  lines: { x1: number; y1: number; x2: number; y2: number; width?: number; colour?: Colour }[];
  boxes: { x: number; y: number; width: number; height: number; fill: Colour }[];
}

// Advance widths (per 1000 units) of characters 32 to 126, from the fonts' metrics.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

const WIN_ANSI: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  "„": 0x84,
  "…": 0x85,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "™": 0x99,
};

/** The text as WinAnsi bytes, one character per byte. */
function encode(text: string): string {
  let out = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 63;
    if (code >= 32 && code <= 126) out += character;
    else if (code >= 160 && code <= 255) out += String.fromCharCode(code);
    else out += String.fromCharCode(WIN_ANSI[character] ?? 63);
  }
  return out;
}

/** How wide the text is at this size, in points. */
export function textWidth(text: string, size: number, bold = false): number {
  const widths = bold ? HELVETICA_BOLD : HELVETICA;
  let total = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 63;
    total += code >= 32 && code <= 126 ? (widths[code - 32] ?? 556) : 556;
  }
  return (total * size) / 1000;
}

/** Splits text into lines no wider than `width`. */
export function wrap(text: string, size: number, width: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, bold) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

const escape = (text: string) => encode(text).replace(/[\\()]/g, (match) => `\\${match}`);
const num = (value: number) => (Math.round(value * 100) / 100).toString();
const rgb = (colour: Colour) => colour.map((part) => num(part / 255)).join(" ");

function contentOf(page: PdfPage): string {
  const parts: string[] = [];
  for (const box of page.boxes) {
    parts.push(
      `${rgb(box.fill)} rg ${num(box.x)} ${num(box.y)} ${num(box.width)} ${num(box.height)} re f`,
    );
  }
  for (const line of page.lines) {
    parts.push(
      `${num(line.width ?? 0.75)} w ${rgb(line.colour ?? [210, 214, 220])} RG ${num(line.x1)} ${num(line.y1)} m ${num(line.x2)} ${num(line.y2)} l S`,
    );
  }
  for (const text of page.texts) {
    parts.push(
      `BT /${text.bold ? "F2" : "F1"} ${num(text.size)} Tf ${rgb(text.colour ?? [17, 24, 39])} rg ${num(text.x)} ${num(text.y)} Td (${escape(text.text)}) Tj ET`,
    );
  }
  return parts.join("\n");
}

/** The document's bytes. */
export function makePdf(pages: readonly PdfPage[], title: string): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(" ")}] /Count ${String(pages.length)} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((page, index) => {
    const pageId = 5 + index * 2;
    const content = contentOf(page);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(A4.width)} ${num(A4.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${String(pageId + 1)} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`;
  });
  const infoId = objects.length;
  objects[infoId] = `<< /Title (${escape(title)}) /Producer (Brawzer) >>`;

  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = out.length;
    out += `${String(id)} 0 obj\n${objects[id] ?? "null"}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${String(objects.length)}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    out += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${String(objects.length)} /Root 1 0 R /Info ${String(infoId)} 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let index = 0; index < out.length; index += 1) bytes[index] = out.charCodeAt(index) & 0xff;
  return bytes;
}
