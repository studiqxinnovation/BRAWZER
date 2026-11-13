/**
 * The bits every Office file shares: a zip of XML parts. Read with the
 * browser's own XML parser, written with escaped strings, never trusting
 * anything inside beyond its text.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type Parts = Readonly<Record<string, Uint8Array>>;

/** The parts of an Office file by path, or nothing if it isn't a zip. */
export function readParts(bytes: Uint8Array): Parts | null {
  try {
    return unzipSync(bytes);
  } catch {
    return null;
  }
}

/** A zip of parts: XML as strings, media as bytes. The first part stays first, as Office expects. */
export function writeParts(
  parts: Readonly<Record<string, string | Uint8Array>>,
): Uint8Array<ArrayBuffer> {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(parts)) {
    // Copied into this realm's Uint8Array: fflate tells files from folders by it.
    entries[path] = new Uint8Array(typeof content === "string" ? strToU8(content) : content);
  }
  // Its own buffer, so it can go straight into a File.
  return new Uint8Array(zipSync(entries, { level: 6 }));
}

/** A part as XML, or null when it's missing or not XML. */
export function partXml(parts: Parts, path: string): Document | null {
  const bytes = parts[path];
  if (!bytes) return null;
  const parsed = new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
  return parsed.getElementsByTagName("parsererror").length ? null : parsed;
}

/** The first part at any of these paths: Office writers differ about leading slashes. */
export function resolvePart(parts: Parts, base: string, target: string): string | null {
  const absolute = target.startsWith("/") ? target.slice(1) : `${base}${target}`;
  const segments: string[] = [];
  for (const segment of absolute.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment !== "." && segment !== "") segments.push(segment);
  }
  const path = segments.join("/");
  return path in parts ? path : null;
}

/** A part's relationships: id to target. */
export function readRelationships(parts: Parts, relsPath: string): Map<string, string> {
  const map = new Map<string, string>();
  const xml = partXml(parts, relsPath);
  if (!xml) return map;
  for (const relationship of Array.from(xml.getElementsByTagName("Relationship"))) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");
    if (id && target) map.set(id, target);
  }
  return map;
}

/** Child elements with this local name, whatever the prefix. */
export function kids(node: Element, localName: string): Element[] {
  return Array.from(node.children).filter((child) => child.localName === localName);
}

/** The first child element with this local name. */
export const kid = (node: Element, localName: string): Element | undefined =>
  kids(node, localName)[0];

/** Every descendant element with this local name, in document order. */
export function descendants(node: Element | Document, localName: string): Element[] {
  return Array.from(node.getElementsByTagName("*")).filter(
    (element) => element.localName === localName,
  );
}

/** An attribute by local name, whatever its prefix. */
export function attribute(node: Element, localName: string): string | null {
  for (const candidate of Array.from(node.attributes)) {
    if (candidate.localName === localName) return candidate.value;
  }
  return null;
}

/** Text safe inside an XML element or attribute. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\p{Cc}]/gu, (character) => ("\t\n\r".includes(character) ? character : ""));
}

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** The package's content types part, from the overrides each format needs. */
export function contentTypesXml(
  defaults: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, string>>,
): string {
  const entries = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    ...Object.entries(defaults).map(
      ([extension, type]) => `<Default Extension="${extension}" ContentType="${type}"/>`,
    ),
    ...Object.entries(overrides).map(
      ([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`,
    ),
  ];
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${entries.join("")}</Types>`;
}

/** A relationships part. */
export function relationshipsXml(
  relationships: readonly { id: string; type: string; target: string; external?: boolean }[],
): string {
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships
    .map(
      (relationship) =>
        `<Relationship Id="${relationship.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${relationship.type}" Target="${escapeXml(relationship.target)}"${relationship.external ? ' TargetMode="External"' : ""}/>`,
    )
    .join("")}</Relationships>`;
}

export const PACKAGE_RELS = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="%MAIN%"/></Relationships>`;
