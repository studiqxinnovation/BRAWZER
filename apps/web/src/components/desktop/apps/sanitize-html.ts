/**
 * What a document opened in Writer may hold: paragraphs, headings, lists,
 * quotes, bold, italic, underline, strikethrough, line breaks, rules and
 * web links, with left, centre or right alignment. Everything else is
 * unwrapped to its text, and scripts, styles and embedded things are
 * dropped, so a document from anywhere can't run anything here.
 */

const KEEP = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "BR",
  "HR",
  "A",
]);
const DROP = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "TEMPLATE",
  "NOSCRIPT",
  "SVG",
  "MATH",
  "LINK",
  "META",
  "TITLE",
  "HEAD",
]);
const ALIGNABLE = new Set(["P", "H1", "H2", "H3", "LI", "BLOCKQUOTE"]);
const ALIGN = /(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\s*(?:;|$)/i;

function safeHref(href: string | null): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, "https://invalid.example");
    return ["http:", "https:", "mailto:"].includes(url.protocol) && !href.startsWith("/")
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function copyInto(source: Node, target: Node, doc: Document) {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === 3) {
      target.appendChild(doc.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    const tag = element.tagName.toUpperCase();
    if (DROP.has(tag)) continue;
    if (tag === "DIV") {
      // A div is a paragraph, as editors make them.
      const paragraph = doc.createElement("p");
      copyInto(element, paragraph, doc);
      target.appendChild(paragraph);
      continue;
    }
    if (!KEEP.has(tag)) {
      copyInto(element, target, doc);
      continue;
    }
    const clean = doc.createElement(tag.toLowerCase());
    if (tag === "A") {
      const href = safeHref(element.getAttribute("href"));
      if (href) {
        clean.setAttribute("href", href);
        clean.setAttribute("rel", "noopener noreferrer");
      }
    }
    const style = element.getAttribute("style");
    const align = style ? ALIGN.exec(style) : null;
    if (align?.[1] && ALIGNABLE.has(tag))
      clean.setAttribute("style", `text-align: ${align[1].toLowerCase()}`);
    copyInto(element, clean, doc);
    target.appendChild(clean);
  }
}

/** The document's body, cleaned, as HTML. */
export function sanitizeHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const out = document.implementation.createHTMLDocument("");
  const container = out.createElement("div");
  copyInto(parsed.body, container, out);
  return container.innerHTML.trim();
}

/** A whole HTML file around the document, as Writer saves it. */
export function htmlDocument(title: string, body: string): string {
  const escaped = title.replace(/[&<>"]/g, (character) => `&#${String(character.charCodeAt(0))};`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escaped}</title>
<style>body{font:16px/1.6 Georgia,serif;max-width:42rem;margin:3rem auto;padding:0 1rem;color:#111}h1,h2,h3{font-family:system-ui,sans-serif}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:1rem;color:#444}</style>
</head>
<body>
${body}
</body>
</html>
`;
}
