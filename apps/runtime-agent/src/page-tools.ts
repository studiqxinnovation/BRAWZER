/**
 * Scripts the engines run inside a page for Brawzer's own tools: find in
 * page, zoom and reader view. Both engines evaluate plain JavaScript, so the
 * tools live here once, as source. Each returns a JSON string.
 */

/**
 * Finds `text` in the page's text nodes, selects the match `step` places
 * from the current one (wrapping) and scrolls to it. Keeps its place on
 * `window` between calls for the same text.
 */
export function findScript(text: string, forward: boolean, caseSensitive: boolean): string {
  return `(() => {
    const needle = ${JSON.stringify(text)};
    const fold = (s) => ${caseSensitive ? "s" : "s.toLowerCase()"};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || node.nodeValue.trim() === "") return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const matches = [];
    const key = fold(needle);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const hay = fold(node.nodeValue);
      let from = 0;
      for (;;) {
        const at = hay.indexOf(key, from);
        if (at === -1) break;
        matches.push([node, at]);
        from = at + Math.max(key.length, 1);
      }
    }
    const state = window.__brawzerFind;
    let index = state && state.text === needle ? state.index + (${forward ? "1" : "-1"}) : 0;
    if (matches.length === 0) {
      window.__brawzerFind = { text: needle, index: -1 };
      getSelection()?.removeAllRanges();
      return JSON.stringify({ matches: 0, active: 0 });
    }
    index = ((index % matches.length) + matches.length) % matches.length;
    const [node, at] = matches[index];
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + needle.length);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node.parentElement).scrollIntoView({ block: "center", inline: "nearest" });
    window.__brawzerFind = { text: needle, index };
    return JSON.stringify({ matches: matches.length, active: index + 1 });
  })()`;
}

export const FIND_STOP_SCRIPT = `(() => { delete window.__brawzerFind; getSelection()?.removeAllRanges(); return "ok"; })()`;

/** CSS zoom on the root element: layout zoom, kept per tab by the engine and re-applied on load. */
export function zoomScript(factor: number): string {
  return `(() => { document.documentElement.style.zoom = ${JSON.stringify(factor === 1 ? "" : String(factor))}; return "ok"; })()`;
}

/**
 * Reader view: Mozilla's Readability extracts the article from a copy of the
 * document; the page is then replaced by Brawzer's own reading layout. Scripts,
 * frames and inline handlers never make it across. Leaving reader view reloads
 * the page.
 */
export function readerScript(readabilitySource: string): string {
  return `(() => {
    if (document.documentElement.dataset.brawzerReader === "on") return JSON.stringify({ ok: true });
    var module = { exports: {} };
    ${readabilitySource}
    const ReadabilityCtor = module.exports;
    let article;
    try {
      article = new ReadabilityCtor(document.cloneNode(true), { keepClasses: false }).parse();
    } catch {
      article = null;
    }
    if (!article || !article.content || (article.textContent || "").trim().length < 200) {
      return JSON.stringify({ ok: false });
    }
    const parsed = new DOMParser().parseFromString(article.content, "text/html");
    for (const bad of parsed.querySelectorAll("script, iframe, object, embed, form, input, button, link, meta, style, svg, video, audio, canvas")) bad.remove();
    for (const element of parsed.querySelectorAll("*")) {
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith("on") || name === "style" || name === "srcdoc") element.removeAttribute(attribute.name);
        if ((name === "href" || name === "src") && /^\\s*(javascript|data):/i.test(attribute.value)) element.removeAttribute(attribute.name);
      }
    }
    const escape = (value) => String(value).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
    const title = article.title || document.title || "";
    const byline = article.byline || "";
    const site = article.siteName || location.hostname;
    // document.open() empties the document, so what the layout needs is read first.
    const lang = document.documentElement.lang || "en";
    document.open();
    document.write("<!doctype html><html lang=\\"" + escape(lang) + "\\" data-brawzer-reader=\\"on\\"><head><meta charset=\\"utf-8\\"><title>" + escape(title) + "</title>"
      + "<style>:root{color-scheme:light dark}body{margin:0;background:#f6f5f2;color:#1c1b19;font:19px/1.65 Georgia,'Times New Roman',serif}"
      + "@media (prefers-color-scheme:dark){body{background:#17161a;color:#ece9e3}a{color:#9fb6ff}}"
      + "main{max-width:40rem;margin:0 auto;padding:56px 24px 96px}header{margin-bottom:32px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}"
      + "h1{font-size:2rem;line-height:1.2;margin:0 0 12px;letter-spacing:-.01em}.meta{color:#6b6963;font-size:.95rem}"
      + "article img{max-width:100%;height:auto;border-radius:8px}article pre{overflow:auto;padding:12px;background:rgba(127,127,127,.12);border-radius:8px;font-size:.9rem}"
      + "article figure{margin:24px 0}article h2,article h3{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.3;margin-top:1.6em}article a{color:#2b5cd9}"
      + "article table{border-collapse:collapse;font-size:.95rem}article td,article th{border:1px solid rgba(127,127,127,.3);padding:6px 10px}</style></head>"
      + "<body><main><header><h1>" + escape(title) + "</h1><p class=\\"meta\\">" + escape([byline, site].filter(Boolean).join(" · ")) + "</p></header><article></article></main></body></html>");
    document.close();
    document.querySelector("article").append(...parsed.body.childNodes);
    document.documentElement.dataset.brawzerReader = "on";
    return JSON.stringify({ ok: true });
  })()`;
}
