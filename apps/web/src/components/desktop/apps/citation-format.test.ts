import { describe, expect, it } from "vitest";
import { formatCitation, plainText, type Source } from "./citation-format";

const base: Source = {
  kind: "book",
  authors: "Smith, Jane Anne",
  year: "2021",
  title: "Learning to learn",
  container: "Oxford University Press",
  url: "",
  accessed: "",
  volume: "",
  issue: "",
  pages: "",
};

const text = (source: Source, style: "harvard" | "apa" | "mla") =>
  plainText(formatCitation(source, style));

describe("citations", () => {
  it("formats a book in each style", () => {
    expect(text(base, "harvard")).toBe(
      "Smith, J.A. (2021) Learning to learn. Oxford University Press.",
    );
    expect(text(base, "apa")).toBe(
      "Smith, J. A. (2021). Learning to learn. Oxford University Press.",
    );
    expect(text(base, "mla")).toBe(
      "Smith, Jane Anne. Learning to learn. Oxford University Press, 2021.",
    );
    expect(formatCitation(base, "harvard").find((piece) => piece.italic)?.text).toBe(
      "Learning to learn",
    );
  });

  it("formats a journal article with two and with many authors", () => {
    const article: Source = {
      ...base,
      kind: "journal",
      authors: "Lee, Ann; Patel, Ravi",
      title: "Sleep and memory",
      container: "Journal of Study",
      volume: "12",
      issue: "3",
      pages: "45-67",
    };
    expect(text(article, "harvard")).toBe(
      "Lee, A. and Patel, R. (2021) ‘Sleep and memory’, Journal of Study, 12(3), pp. 45-67.",
    );
    expect(text(article, "apa")).toBe(
      "Lee, A., & Patel, R. (2021). Sleep and memory. Journal of Study, 12(3), 45-67.",
    );
    expect(text(article, "mla")).toBe(
      "Lee, Ann, and Ravi Patel. “Sleep and memory.” Journal of Study, vol. 12, no. 3, 2021, pp. 45-67.",
    );
    expect(text({ ...article, authors: "A, B; C, D; E, F; G, H" }, "harvard")).toMatch(
      /^A, B\. et al\. \(2021\)/,
    );
  });

  it("formats a web page with its address and the day it was read", () => {
    const page: Source = {
      ...base,
      kind: "website",
      authors: "",
      year: "",
      title: "How to revise",
      container: "Study Hub",
      url: "https://studyhub.example/revise",
      accessed: "2026-11-10",
    };
    expect(text(page, "harvard")).toBe(
      "Study Hub (n.d.) How to revise. Available at: https://studyhub.example/revise (Accessed: 10 November 2026).",
    );
    expect(text(page, "apa")).toBe(
      "How to revise. (n.d.). Study Hub. https://studyhub.example/revise",
    );
    expect(text(page, "mla")).toBe(
      "“How to revise.” Study Hub, n.d., studyhub.example/revise. Accessed 10 Nov. 2026.",
    );
  });
});
