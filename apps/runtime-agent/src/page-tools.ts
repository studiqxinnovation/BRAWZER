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

/** The page's selected text: a field's selection when a field has focus, else the document's. */
export function selectionScript(maxChars: number): string {
  return `(() => {
    const active = document.activeElement;
    let text = "";
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA") && typeof active.selectionStart === "number") {
      text = active.value.slice(active.selectionStart, active.selectionEnd);
    }
    if (!text) text = String(getSelection() || "");
    return text.slice(0, ${String(maxChars)});
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

/**
 * What the pointer is over at (`x`, `y`): the cursor the page asks for, with
 * the browser's own choice worked out where it says `auto`, and whether
 * anything under the pointer scrolls sideways. Same-origin frames are
 * looked into; others count as the page. Returns JSON.
 */
export function pointerScript(x: number, y: number): string {
  return `(() => {
    let x = ${String(x)}, y = ${String(y)};
    let doc = document;
    let el = doc.elementFromPoint(x, y);
    for (let depth = 0; el && depth < 4; depth++) {
      const tag = el.tagName;
      if (tag !== "IFRAME" && tag !== "FRAME") break;
      let inner = null;
      try { inner = el.contentDocument; } catch { inner = null; }
      if (!inner) break;
      const r = el.getBoundingClientRect();
      x -= r.left; y -= r.top; doc = inner;
      el = inner.elementFromPoint(x, y);
    }
    if (!el) return JSON.stringify({ cursor: "default", hscroll: false });
    const view = doc.defaultView || window;
    let cursor = view.getComputedStyle(el).cursor || "auto";
    if (cursor === "auto") {
      const tag = el.tagName;
      const type = (el.getAttribute("type") || "text").toLowerCase();
      const editable = el.isContentEditable || tag === "TEXTAREA" ||
        (tag === "INPUT" && !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/.test(type));
      const clickable = el.closest("a[href],button,[role=button],[role=link],summary,label,select,input[type=checkbox],input[type=radio],input[type=submit],input[type=button]");
      const overText = !clickable && !editable && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.nodeValue.trim() !== "");
      cursor = editable || overText ? "text" : clickable ? "pointer" : "default";
    }
    let hscroll = false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.scrollWidth > n.clientWidth + 1) {
        const o = view.getComputedStyle(n).overflowX;
        const root = n === doc.documentElement || n === doc.body;
        if (root ? o !== "hidden" : (o === "auto" || o === "scroll")) { hscroll = true; break; }
      }
    }
    const anchor = el.closest("a[href]");
    let link = null;
    try { if (anchor && /^https?:/.test(anchor.href)) link = anchor.href.slice(0, 2048); } catch {}
    let image = null;
    const img = el.closest("img, picture img") || (el.tagName === "PICTURE" ? el.querySelector("img") : null);
    if (img && img.currentSrc && /^https?:/.test(img.currentSrc)) image = img.currentSrc.slice(0, 2048);
    else {
      const bg = view.getComputedStyle(el).backgroundImage;
      const m = /url\\(["']?(https?:[^"')]+)["']?\\)/.exec(bg || "");
      if (m) image = m[1].slice(0, 2048);
    }
    const sel = view.getSelection();
    const selected = !!sel && !sel.isCollapsed && sel.toString().trim() !== "";
    return JSON.stringify({ cursor, hscroll, link, image, selected });
  })()`;
}

/**
 * What has focus, as a screen reader would say it: its role (the page's own
 * or the tag's) and its name (label, aria-label, text, alt, placeholder or
 * title), and a field's value, never a password's. Returns JSON.
 */
export const FOCUS_SCRIPT = `(() => {
  let el = document.activeElement;
  for (let depth = 0; el && depth < 4; depth++) {
    const tag = el.tagName;
    if (tag !== "IFRAME" && tag !== "FRAME") break;
    let inner = null;
    try { inner = el.contentDocument; } catch { inner = null; }
    if (!inner || !inner.activeElement) break;
    el = inner.activeElement;
  }
  if (!el || el === document.body || el === document.documentElement) return JSON.stringify({ role: "document", name: document.title || "", value: null });
  const text = (node) => (node ? (node.textContent || "").replace(/\\s+/g, " ").trim() : "");
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "text").toLowerCase();
  let role = el.getAttribute("role") || "";
  if (!role) {
    role = tag === "a" && el.hasAttribute("href") ? "link"
      : tag === "button" || (tag === "input" && /^(button|submit|reset|image)$/.test(type)) ? "button"
      : tag === "input" && type === "checkbox" ? "checkbox"
      : tag === "input" && type === "radio" ? "radio"
      : tag === "input" && type === "range" ? "slider"
      : tag === "input" || tag === "textarea" ? "text field"
      : tag === "select" ? "list box"
      : /^h[1-6]$/.test(tag) ? "heading"
      : el.isContentEditable ? "text field"
      : tag;
  }
  let name = el.getAttribute("aria-label") || "";
  if (!name) {
    const by = el.getAttribute("aria-labelledby");
    if (by) name = by.split(/\\s+/).map((id) => text(el.ownerDocument.getElementById(id))).filter(Boolean).join(" ");
  }
  if (!name && el.labels && el.labels.length) name = text(el.labels[0]);
  if (!name && el.id) { const l = el.ownerDocument.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) name = text(l); }
  if (!name) name = el.getAttribute("alt") || el.getAttribute("placeholder") || el.getAttribute("title") || "";
  if (!name && !(tag === "input" || tag === "textarea" || tag === "select")) name = text(el).slice(0, 200);
  let value = null;
  if (tag === "input" && type === "password") value = "\u2022\u2022\u2022";
  else if (tag === "input" && (type === "checkbox" || type === "radio")) value = el.checked ? "checked" : "not checked";
  else if (tag === "input" || tag === "textarea") value = String(el.value || "").slice(0, 200);
  else if (tag === "select") value = text(el.options[el.selectedIndex]);
  else if (el.isContentEditable) value = text(el).slice(0, 200);
  return JSON.stringify({ role: role.slice(0, 64), name: name.slice(0, 512), value });
})()`;

/**
 * Fetches an image as the page itself could (its cookies apply), returning
 * its bytes as base64 with its type, or null if the page may not read it
 * (another origin without CORS) or it is too large. Returns a promise.
 */
export function fetchImageScript(url: string, maxBytes: number): string {
  return `(async () => {
    try {
      const res = await fetch(${JSON.stringify(url)}, { credentials: "include", mode: "cors" });
      if (!res.ok) return null;
      const type = (res.headers.get("content-type") || "").split(";")[0].trim();
      if (!/^image\\//.test(type)) return null;
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > ${String(maxBytes)}) return null;
      const bytes = new Uint8Array(buf);
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return JSON.stringify({ type, data: btoa(s) });
    } catch { return null; }
  })()`;
}

/** The address of the page's site icon: its best `<link rel=icon>`, or `/favicon.ico`. */
export const ICON_SCRIPT = `(() => {
  const links = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]'));
  const score = (link) => {
    const sizes = (link.getAttribute("sizes") || "").toLowerCase();
    const px = Number(sizes.split("x")[0]) || 0;
    const type = (link.getAttribute("type") || "").toLowerCase();
    let s = 0;
    if (px >= 24 && px <= 64) s += 3; else if (px > 64) s += 1; else if (px === 0) s += 2;
    if (type.includes("png")) s += 1;
    if (type.includes("svg")) s -= 1;
    if (link.rel === "apple-touch-icon") s -= 2;
    return s;
  };
  const best = links.map((link) => [score(link), link.href]).filter(([, href]) => href).sort((a, b) => b[0] - a[0])[0];
  return best ? best[1] : new URL("/favicon.ico", location.href).href;
})()`;
