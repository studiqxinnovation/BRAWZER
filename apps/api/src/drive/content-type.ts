import { fileTypeFromBuffer } from "file-type";

/** Enough of a file to recognise every type file-type knows. */
export const SNIFF_BYTES = 4100;

/** Printable UTF-8: no control characters other than tab, newline and carriage return. */
export function looksLikeText(sample: Buffer): boolean {
  if (sample.length === 0) return false;
  for (const byte of sample) {
    if (byte === 0x7f || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)) {
      return false;
    }
  }
  try {
    // Streaming mode: a multi-byte character cut off by the sample's end is
    // held back rather than rejected, while a malformed one still throws.
    new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * The content type of a file from its first bytes, never from the client.
 * Anything with a recognisable signature gets that type; readable text is
 * `text/plain`; everything else is an opaque `application/octet-stream`.
 */
export async function sniffContentType(sample: Buffer): Promise<string> {
  const detected = await fileTypeFromBuffer(sample);
  if (detected) return detected.mime;
  return looksLikeText(sample) ? "text/plain" : "application/octet-stream";
}

/** What the response says the content is; text always carries its charset. */
export function responseContentType(contentType: string): string {
  return contentType === "text/plain" ? "text/plain; charset=utf-8" : contentType;
}

/**
 * A Content-Disposition header with the name in both the ASCII fallback and
 * the RFC 8187 form, so every browser saves the file under its real name.
 */
export function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Turns whatever a browser sent as the filename into a Drive name: one path
 * segment without control or direction-override characters, never empty,
 * at most 255 characters with the extension kept.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[/\\]/).at(-1) ?? "";
  let name = base
    .replace(/[\p{Cc}‪-‮⁦-⁩]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name === "" || name === "." || name === "..") name = "Untitled";
  if (name.length > 255) {
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : "";
    name = `${name.slice(0, 255 - extension.length).trimEnd()}${extension}`;
  }
  return name;
}

/** "report.pdf" with `n` 2 is "report (2).pdf". */
export function numberedName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  const suffix = ` (${String(n)})`;
  const room = 255 - extension.length - suffix.length;
  return `${stem.slice(0, Math.max(1, room)).trimEnd()}${suffix}${extension}`;
}
