import { describe, expect, it } from "vitest";
import { htmlDocument, sanitizeHtml } from "./sanitize-html";

describe("sanitizeHtml", () => {
  it("keeps a document's structure and drops anything that could run", () => {
    const dirty = `<h1 onclick="steal()">Title</h1><script>alert(1)</script>
      <p style="text-align:center;color:red">Hi <b>there</b> <img src=x onerror="alert(2)"><span>friend</span></p>
      <div>As a div</div><a href="javascript:alert(3)">bad</a> <a href="https://example.com/a">good</a>
      <iframe src="https://evil.example"></iframe><ul><li>One</li></ul>`;
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/script|onclick|onerror|iframe|javascript|color|<img|<span/);
    expect(clean).toContain("<h1>Title</h1>");
    expect(clean).toContain('<p style="text-align: center">Hi <b>there</b> friend</p>');
    expect(clean).toContain("<p>As a div</p>");
    expect(clean).toContain("<a>bad</a>");
    expect(clean).toContain('<a href="https://example.com/a" rel="noopener noreferrer">good</a>');
    expect(clean).toContain("<ul><li>One</li></ul>");
  });

  it("reads back what Writer saves", () => {
    const body = "<h2>Plan</h2><p>Step <i>one</i></p>";
    expect(sanitizeHtml(htmlDocument('Q3 "plan" & <notes>', body))).toBe(body);
  });
});
