import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  looksLikeText,
  numberedName,
  responseContentType,
  sanitizeFilename,
  sniffContentType,
} from "./content-type.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");

describe("sniffContentType", () => {
  it("recognises signatures regardless of the claimed name", async () => {
    expect(await sniffContentType(PNG)).toBe("image/png");
    expect(await sniffContentType(PDF)).toBe("application/pdf");
    expect(await sniffContentType(Buffer.from("PK\x03\x04" + "\0".repeat(40)))).toBe(
      "application/zip",
    );
  });

  it("calls readable UTF-8 plain text, including HTML and SVG", async () => {
    expect(await sniffContentType(Buffer.from("Hello, Drive!\nLine two.\r\n\tTabbed."))).toBe(
      "text/plain",
    );
    expect(await sniffContentType(Buffer.from("<!doctype html><script>alert(1)</script>"))).toBe(
      "text/plain",
    );
    expect(await sniffContentType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(
      "text/plain",
    );
    expect(await sniffContentType(Buffer.from("Grüße aus Köln – ünïcödé ✓"))).toBe("text/plain");
  });

  it("treats everything else as opaque bytes", async () => {
    expect(await sniffContentType(Buffer.alloc(0))).toBe("application/octet-stream");
    expect(await sniffContentType(Buffer.from([0x00, 0x01, 0x02, 0x41]))).toBe(
      "application/octet-stream",
    );
    expect(await sniffContentType(Buffer.from([0xff, 0xfe, 0x41, 0x00]))).toBe(
      "application/octet-stream",
    );
  });
});

describe("looksLikeText", () => {
  it("accepts a sample cut in the middle of a multi-byte character", () => {
    const whole = Buffer.from("abc€");
    expect(looksLikeText(whole.subarray(0, whole.length - 1))).toBe(true);
  });

  it("rejects control characters and invalid UTF-8", () => {
    expect(looksLikeText(Buffer.from("abc\x07"))).toBe(false);
    expect(looksLikeText(Buffer.from([0x61, 0xc3, 0x28]))).toBe(false);
  });
});

describe("responseContentType", () => {
  it("adds the charset to text only", () => {
    expect(responseContentType("text/plain")).toBe("text/plain; charset=utf-8");
    expect(responseContentType("image/png")).toBe("image/png");
  });
});

describe("contentDisposition", () => {
  it("gives an ASCII fallback and the encoded real name", () => {
    expect(contentDisposition("attachment", 'Résumé "final" (1).pdf')).toBe(
      "attachment; filename=\"R_sum_ _final_ (1).pdf\"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22%20%281%29.pdf",
    );
  });

  it("never lets a name break out of the header", () => {
    const header = contentDisposition("inline", 'a"\r\nX-Injected: yes');
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
    expect(header.startsWith('inline; filename="a_')).toBe(true);
  });
});

describe("sanitizeFilename", () => {
  it("keeps only the last path segment and strips control characters", () => {
    expect(sanitizeFilename("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("bad\u0000name\u202e.txt")).toBe("badname.txt");
    expect(sanitizeFilename("  spaced   out  .txt ")).toBe("spaced out .txt");
  });

  it("never returns an empty or dot name", () => {
    expect(sanitizeFilename("")).toBe("Untitled");
    expect(sanitizeFilename("..")).toBe("Untitled");
    expect(sanitizeFilename("/")).toBe("Untitled");
  });

  it("shortens long names but keeps the extension", () => {
    const long = `${"a".repeat(300)}.pdf`;
    const result = sanitizeFilename(long);
    expect(result.length).toBe(255);
    expect(result.endsWith(".pdf")).toBe(true);
  });
});

describe("numberedName", () => {
  it("puts the number before the extension", () => {
    expect(numberedName("report.pdf", 2)).toBe("report (2).pdf");
    expect(numberedName("README", 3)).toBe("README (3)");
    expect(numberedName(".bashrc", 2)).toBe(".bashrc (2)");
  });

  it("stays within 255 characters", () => {
    expect(numberedName(`${"b".repeat(250)}.txt`, 12).length).toBeLessThanOrEqual(255);
  });
});
