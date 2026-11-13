import { describe, expect, it } from "vitest";
import { docxToHtml, htmlToDocx } from "./docx";
import { readParts, writeParts } from "./package-xml";
import { strFromU8 } from "fflate";

describe("Word documents", () => {
  it("writes a document Writer's HTML round-trips through", () => {
    const html =
      "<h1>Term paper</h1><p>Plain <b>bold</b>, <i>italic</i>, <u>under</u> and <s>gone</s>.</p>" +
      "<h2>Reading</h2><ul><li>First</li><li>Second</li></ul><ol><li>One</li><li>Two</li></ol>" +
      '<blockquote>A quote</blockquote><p style="text-align: center">Centred</p>' +
      '<p>See <a href="https://example.org/">the site</a>.</p><p><br></p>';
    const bytes = htmlToDocx(html);
    const parts = readParts(bytes);
    expect(parts).not.toBeNull();
    expect(Object.keys(parts ?? {})[0]).toBe("[Content_Types].xml");
    const document = strFromU8(parts?.["word/document.xml"] ?? new Uint8Array());
    expect(document).toContain('<w:pStyle w:val="Heading1"/>');
    expect(document).toContain("<w:b/>");
    expect(document).toContain('<w:numId w:val="2"/>');
    expect(document).toContain('<w:jc w:val="center"/>');
    expect(document).toContain("<w:hyperlink");
    const back = docxToHtml(bytes);
    expect(back?.pictures).toBe(0);
    expect(back?.html).toContain("<h1>Term paper</h1>");
    expect(back?.html).toContain("<b>bold</b>");
    expect(back?.html).toContain("<i>italic</i>");
    expect(back?.html).toContain("<u>under</u>");
    expect(back?.html).toContain("<s>gone</s>");
    expect(back?.html).toContain("<ul><li>First</li><li>Second</li></ul>");
    expect(back?.html).toContain("<ol><li>One</li><li>Two</li></ol>");
    expect(back?.html).toContain("<blockquote>A quote</blockquote>");
    expect(back?.html).toContain('<p style="text-align: center">Centred</p>');
    expect(back?.html).toContain('<a href="https://example.org/">the site</a>');
  });

  it("reads Word's own shapes: heading styles, list styles, tables and pictures", () => {
    const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const document = `<?xml version="1.0"?><w:document ${w}><w:body>
      <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Hello</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t>Bullet</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t xml:space="preserve">not bold </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:drawing/></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:r><w:t>&lt;script&gt;</w:t></w:r></w:p>
    </w:body></w:document>`;
    const bytes = htmlToDocx("<p>x</p>");
    const parts = { ...(readParts(bytes) ?? {}) };
    parts["word/document.xml"] = new TextEncoder().encode(document);
    const back = docxToHtml(writeParts(parts));
    expect(back?.pictures).toBe(1);
    expect(back?.html).toContain("<h1>Hello</h1>");
    expect(back?.html).toContain("<ul><li>Bullet</li></ul>");
    expect(back?.html).toContain("not bold <b>bold</b>");
    expect(back?.html).toContain("<p>A | B</p>");
    expect(back?.html).toContain("&lt;script&gt;");
  });

  it("says when bytes aren't a Word document", () => {
    expect(docxToHtml(new TextEncoder().encode("hello"))).toBeNull();
  });
});
