/**
 * Word documents (.docx) in and out of Writer. In: paragraphs, headings,
 * quotes, lists, bold, italic, underline, strikethrough, line breaks,
 * alignment and links become Writer's HTML; tables become one line per
 * row; pictures are counted and left out. Out: Writer's HTML becomes a
 * document Word, Pages and LibreOffice open, with real heading and list
 * styles.
 */
import {
  attribute,
  contentTypesXml,
  descendants,
  escapeXml,
  kid,
  kids,
  PACKAGE_RELS,
  type Parts,
  partXml,
  readParts,
  readRelationships,
  relationshipsXml,
  writeParts,
  XML_HEAD,
} from "./package-xml";

export interface DocxImport {
  html: string;
  /** Pictures in the document, which Writer can't keep. */
  pictures: number;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Block =
  | { kind: "p"; tag: "p" | "h1" | "h2" | "h3" | "blockquote"; align: string | null; html: string }
  | { kind: "li"; list: "ul" | "ol"; align: string | null; html: string };

/** Which kind of list each numbering id draws: bullets or numbers. */
function listKinds(parts: Parts): Map<string, "ul" | "ol"> {
  const kinds = new Map<string, "ul" | "ol">();
  const numbering = partXml(parts, "word/numbering.xml");
  if (!numbering) return kinds;
  const formats = new Map<string, "ul" | "ol">();
  for (const abstract of descendants(numbering, "abstractNum")) {
    const id = attribute(abstract, "abstractNumId");
    const level = kids(abstract, "lvl").find((lvl) => attribute(lvl, "ilvl") === "0");
    const format = level ? kid(level, "numFmt") : undefined;
    const value = format ? attribute(format, "val") : null;
    if (id) formats.set(id, value === "bullet" || value === null ? "ul" : "ol");
  }
  for (const num of descendants(numbering, "num")) {
    const id = attribute(num, "numId");
    const abstract = kid(num, "abstractNumId");
    const abstractId = abstract ? attribute(abstract, "val") : null;
    if (id && abstractId) kinds.set(id, formats.get(abstractId) ?? "ul");
  }
  return kinds;
}

/** A paragraph's style name, such as Heading1, from its properties. */
function styleOf(paragraph: Element): string {
  const properties = kid(paragraph, "pPr");
  const style = properties ? kid(properties, "pStyle") : undefined;
  return style ? (attribute(style, "val") ?? "") : "";
}

function alignmentOf(paragraph: Element): string | null {
  const properties = kid(paragraph, "pPr");
  const jc = properties ? kid(properties, "jc") : undefined;
  const value = jc ? attribute(jc, "val") : null;
  if (value === "center") return "center";
  if (value === "right" || value === "end") return "right";
  if (value === "both" || value === "distribute") return "justify";
  return null;
}

function tagFor(style: string): "p" | "h1" | "h2" | "h3" | "blockquote" {
  const name = style.toLowerCase();
  if (name === "title" || name === "heading1" || name === "heading") return "h1";
  if (name === "heading2" || name === "subtitle") return "h2";
  if (name === "heading3" || name === "heading4") return "h3";
  if (name.includes("quote")) return "blockquote";
  return "p";
}

interface RunsOut {
  html: string;
  pictures: number;
}

/** The runs of a paragraph as inline HTML. */
function runsOf(paragraph: Element, links: Map<string, string>): RunsOut {
  let html = "";
  let pictures = 0;
  const run = (element: Element) => {
    const properties = kid(element, "rPr");
    const on = (name: string) => {
      const mark = properties ? kid(properties, name) : undefined;
      if (!mark) return false;
      const value = attribute(mark, "val");
      return value !== "0" && value !== "false" && value !== "none";
    };
    let text = "";
    for (const child of Array.from(element.children)) {
      if (child.localName === "t") text += escapeHtml(child.textContent);
      else if (child.localName === "tab") text += " ";
      else if (child.localName === "br") text += "<br>";
      else if (child.localName === "drawing" || child.localName === "pict") pictures += 1;
      else if (child.localName === "sym") text += " ";
    }
    if (!text) return "";
    if (on("b")) text = `<b>${text}</b>`;
    if (on("i")) text = `<i>${text}</i>`;
    if (on("u")) text = `<u>${text}</u>`;
    if (on("strike") || on("dstrike")) text = `<s>${text}</s>`;
    return text;
  };
  for (const child of Array.from(paragraph.children)) {
    if (child.localName === "r") html += run(child);
    else if (child.localName === "hyperlink") {
      const id = attribute(child, "id");
      const target = id ? links.get(id) : undefined;
      const inner = kids(child, "r").map(run).join("");
      html +=
        target && /^https?:\/\//i.test(target)
          ? `<a href="${escapeHtml(target)}">${inner}</a>`
          : inner;
    } else if (
      child.localName === "ins" ||
      child.localName === "smartTag" ||
      child.localName === "sdt"
    ) {
      // Tracked insertions and smart tags wrap ordinary runs.
      const inner = runsOf(child, links);
      html += inner.html;
      pictures += inner.pictures;
    }
  }
  return { html, pictures };
}

/** Writer's HTML from a Word document, or null when it isn't one. */
export function docxToHtml(bytes: Uint8Array): DocxImport | null {
  const parts = readParts(bytes);
  if (!parts) return null;
  const document = partXml(parts, "word/document.xml");
  if (!document) return null;
  const body = descendants(document, "body")[0];
  if (!body) return null;
  const kinds = listKinds(parts);
  const links = readRelationships(parts, "word/_rels/document.xml.rels");
  let pictures = 0;
  const blocks: Block[] = [];

  const paragraph = (element: Element) => {
    const runs = runsOf(element, links);
    pictures += runs.pictures;
    const properties = kid(element, "pPr");
    const numbering = properties ? kid(properties, "numPr") : undefined;
    const numId = numbering ? kid(numbering, "numId") : undefined;
    const listId = numId ? attribute(numId, "val") : null;
    const style = styleOf(element);
    const align = alignmentOf(element);
    if (listId && listId !== "0") {
      blocks.push({ kind: "li", list: kinds.get(listId) ?? "ul", align, html: runs.html });
      return;
    }
    const listStyle = /^list(bullet|number)/i.exec(style);
    if (listStyle) {
      const list = listStyle[1]?.toLowerCase() === "number" ? "ol" : "ul";
      blocks.push({ kind: "li", list, align, html: runs.html });
      return;
    }
    blocks.push({ kind: "p", tag: tagFor(style), align, html: runs.html });
  };

  const walk = (container: Element) => {
    for (const child of Array.from(container.children)) {
      if (child.localName === "p") paragraph(child);
      else if (child.localName === "tbl") {
        for (const row of kids(child, "tr")) {
          const cells = kids(row, "tc").map((cell) => {
            const lines = kids(cell, "p").map((p) => {
              const runs = runsOf(p, links);
              pictures += runs.pictures;
              return runs.html;
            });
            return lines.filter(Boolean).join(" ");
          });
          blocks.push({ kind: "p", tag: "p", align: null, html: cells.join(" | ") });
        }
      } else if (child.localName === "sdt" || child.localName === "sdtContent") walk(child);
    }
  };
  walk(body);

  let html = "";
  let openList: "ul" | "ol" | null = null;
  const styleAttribute = (align: string | null) => (align ? ` style="text-align: ${align}"` : "");
  for (const block of blocks) {
    if (block.kind === "li") {
      if (openList !== block.list) {
        if (openList) html += `</${openList}>`;
        html += `<${block.list}>`;
        openList = block.list;
      }
      html += `<li${styleAttribute(block.align)}>${block.html || "<br>"}</li>`;
      continue;
    }
    if (openList) {
      html += `</${openList}>`;
      openList = null;
    }
    html += `<${block.tag}${styleAttribute(block.align)}>${block.html || "<br>"}</${block.tag}>`;
  }
  if (openList) html += `</${openList}>`;
  return { html: html || "<p><br></p>", pictures };
}

/* ---------- Writing ---------- */

interface Marks {
  b: boolean;
  i: boolean;
  u: boolean;
  s: boolean;
}

interface Hyperlink {
  id: string;
  target: string;
}

/** A paragraph's runs from Writer's inline HTML. */
function runsXml(node: Node, marks: Marks, links: Hyperlink[]): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (!text) return "";
    const properties =
      (marks.b ? "<w:b/>" : "") +
      (marks.i ? "<w:i/>" : "") +
      (marks.u ? '<w:u w:val="single"/>' : "") +
      (marks.s ? "<w:strike/>" : "");
    return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  }
  if (!(node instanceof Element)) return "";
  const tag = node.tagName;
  if (tag === "BR") return "<w:r><w:br/></w:r>";
  const next: Marks = {
    b: marks.b || tag === "B" || tag === "STRONG",
    i: marks.i || tag === "I" || tag === "EM",
    u: marks.u || tag === "U",
    s: marks.s || tag === "S" || tag === "STRIKE" || tag === "DEL",
  };
  const inner = Array.from(node.childNodes)
    .map((child) => runsXml(child, next, links))
    .join("");
  if (tag === "A") {
    const href = node.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      const id = `rId${String(100 + links.length)}`;
      links.push({ id, target: href });
      return `<w:hyperlink r:id="${id}">${inner}</w:hyperlink>`;
    }
  }
  return inner;
}

function alignmentXml(element: Element): string {
  const style = element.getAttribute("style") ?? "";
  const match = /text-align\s*:\s*(center|right|justify)/i.exec(style);
  if (!match) return "";
  const value = match[1]?.toLowerCase();
  return `<w:jc w:val="${value === "justify" ? "both" : value === "right" ? "right" : "center"}"/>`;
}

/** One block element as a Word paragraph. */
function paragraphXml(
  element: Element,
  style: string | null,
  list: { numId: number; level: number } | null,
  links: Hyperlink[],
): string {
  const properties =
    (style ? `<w:pStyle w:val="${style}"/>` : "") +
    (list
      ? `<w:numPr><w:ilvl w:val="${String(list.level)}"/><w:numId w:val="${String(list.numId)}"/></w:numPr>`
      : "") +
    alignmentXml(element);
  const runs = Array.from(element.childNodes)
    .map((child) => runsXml(child, { b: false, i: false, u: false, s: false }, links))
    .join("");
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}${runs}</w:p>`;
}

const STYLE_OF: Readonly<Record<string, string>> = {
  H1: "Heading1",
  H2: "Heading2",
  H3: "Heading3",
  BLOCKQUOTE: "Quote",
};

/** The body's blocks as paragraphs; lists become numbered paragraphs. */
function bodyXml(root: Element, links: Hyperlink[]): string {
  let xml = "";
  const walk = (container: Element, level: number) => {
    for (const child of Array.from(container.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent?.trim() ?? "";
        if (text) {
          xml += `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
        }
        continue;
      }
      if (!(child instanceof Element)) continue;
      const tag = child.tagName;
      if (tag === "UL" || tag === "OL") {
        const numId = tag === "OL" ? 2 : 1;
        for (const item of Array.from(child.children)) {
          if (item.tagName !== "LI") continue;
          // The item's own text, then any nested list after it.
          const own = item.cloneNode(true) as Element;
          const nested = Array.from(own.children).filter(
            (grandchild) => grandchild.tagName === "UL" || grandchild.tagName === "OL",
          );
          for (const sub of nested) sub.remove();
          xml += paragraphXml(own, null, { numId, level: Math.min(level, 8) }, links);
          for (const sub of Array.from(item.children)) {
            if (sub.tagName === "UL" || sub.tagName === "OL") walk(item, level + 1);
          }
        }
        continue;
      }
      if (tag === "HR") {
        xml +=
          '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>';
        continue;
      }
      if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE" || tag === "BODY") {
        walk(child, level);
        continue;
      }
      xml += paragraphXml(child, STYLE_OF[tag] ?? null, null, links);
    }
  };
  walk(root, 0);
  return xml || "<w:p/>";
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const STYLES = `${XML_HEAD}<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

const level = (index: number, format: string, text: string) =>
  `<w:lvl w:ilvl="${String(index)}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${String(720 * (index + 1))}" w:hanging="360"/></w:pPr>${format === "bullet" ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>' : ""}</w:lvl>`;

const NUMBERING = `${XML_HEAD}<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, index) => level(index, "bullet", "")).join("")}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, index) => level(index, "decimal", `%${String(index + 1)}.`)).join("")}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

/** A Word document from Writer's HTML (already sanitised). */
export function htmlToDocx(html: string): Uint8Array<ArrayBuffer> {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const links: Hyperlink[] = [];
  const body = bodyXml(parsed.body, links);
  const document = `${XML_HEAD}<w:document ${W} ${R}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const documentRels = relationshipsXml([
    { id: "rId1", type: "styles", target: "styles.xml" },
    { id: "rId2", type: "numbering", target: "numbering.xml" },
    ...links.map((link) => ({
      id: link.id,
      type: "hyperlink",
      target: link.target,
      external: true,
    })),
  ]);
  return writeParts({
    "[Content_Types].xml": contentTypesXml(
      {},
      {
        "/word/document.xml":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        "/word/styles.xml":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
        "/word/numbering.xml":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
      },
    ),
    "_rels/.rels": PACKAGE_RELS.replace("%MAIN%", "word/document.xml"),
    "word/document.xml": document,
    "word/_rels/document.xml.rels": documentRels,
    "word/styles.xml": STYLES,
    "word/numbering.xml": NUMBERING,
  });
}
