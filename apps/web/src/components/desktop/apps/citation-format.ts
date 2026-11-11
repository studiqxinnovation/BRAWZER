/**
 * References in three styles, as university guides set them out: Harvard
 * (Cite Them Right), APA 7th edition and MLA 9th edition. A reference is a
 * list of pieces, some in italics, so it can be shown and copied as text.
 */

export type SourceKind = "website" | "book" | "journal";
export type CitationStyle = "harvard" | "apa" | "mla";

export interface Source {
  kind: SourceKind;
  /** "Smith, Jane; Lee, Ann": family name, given names; people separated by semicolons. */
  authors: string;
  year: string;
  title: string;
  /** Website name, publisher, or journal. */
  container: string;
  url: string;
  /** yyyy-mm-dd, for websites. */
  accessed: string;
  volume: string;
  issue: string;
  pages: string;
}

export interface Piece {
  text: string;
  italic?: boolean;
}

interface Person {
  family: string;
  given: string[];
}

export function parseAuthors(authors: string): Person[] {
  return authors
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [family = "", given = ""] = entry.includes(",")
        ? entry.split(",", 2).map((part) => part.trim())
        : [entry.split(/\s+/).at(-1) ?? entry, entry.split(/\s+/).slice(0, -1).join(" ")];
      return { family, given: given.split(/[\s.]+/).filter(Boolean) };
    });
}

const initials = (given: string[], spaced: boolean) =>
  given.map((name) => `${name.charAt(0).toUpperCase()}.`).join(spaced ? " " : "");

/** Smith, J., Lee, A. and Patel, R. */
function harvardNames(people: Person[]): string {
  const names = people.map(
    (p) => `${p.family}${p.given.length ? `, ${initials(p.given, false)}` : ""}`,
  );
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > 3) return `${names[0] ?? ""} et al.`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/** Smith, J. A., Lee, A., & Patel, R. */
function apaNames(people: Person[]): string {
  const names = people.map(
    (p) => `${p.family}${p.given.length ? `, ${initials(p.given, true)}` : ""}`,
  );
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > 20) return `${names.slice(0, 19).join(", ")}, … ${names.at(-1) ?? ""}`;
  return `${names.slice(0, -1).join(", ")}, & ${names.at(-1) ?? ""}`;
}

/** Smith, Jane, and Ann Lee. / Smith, Jane, et al. */
function mlaNames(people: Person[]): string {
  const [first, second] = people;
  if (!first) return "";
  const lead = `${first.family}${first.given.length ? `, ${first.given.join(" ")}` : ""}`;
  if (people.length === 1) return lead;
  if (people.length === 2 && second) {
    return `${lead}, and ${[...second.given, second.family].join(" ")}`;
  }
  return `${lead}, et al.`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MLA_MONTHS = [
  "Jan.",
  "Feb.",
  "Mar.",
  "Apr.",
  "May",
  "June",
  "July",
  "Aug.",
  "Sept.",
  "Oct.",
  "Nov.",
  "Dec.",
];

function dateParts(date: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

const end = (text: string) => (/[.?!]$/.test(text) ? text : `${text}.`);

export function formatCitation(source: Source, style: CitationStyle): Piece[] {
  const people = parseAuthors(source.authors);
  const year = source.year.trim() || "n.d.";
  const title = source.title.trim() || "Untitled";
  const container = source.container.trim();
  const url = source.url.trim();
  const accessed = dateParts(source.accessed);
  const pieces: Piece[] = [];
  const add = (text: string, italic = false) => {
    if (text) pieces.push(italic ? { text, italic } : { text });
  };

  if (style === "harvard") {
    const author = harvardNames(people) || container || title;
    add(`${author} (${year}) `);
    if (source.kind === "journal") {
      add(`‘${title}’, `);
      add(container, true);
      add(
        `${source.volume ? `, ${source.volume}` : ""}${source.issue ? `(${source.issue})` : ""}${
          source.pages ? `, pp. ${source.pages}` : ""
        }.`,
      );
      if (url) add(` Available at: ${url}`);
    } else {
      add(title, true);
      add(". ");
      if (source.kind === "book" && container) add(`${end(container)} `);
      if (url) add(`Available at: ${url} `);
    }
    if (accessed && (source.kind === "website" || url)) {
      add(
        `(Accessed: ${String(accessed[2])} ${MONTHS[accessed[1] - 1] ?? ""} ${String(accessed[0])}).`,
      );
    }
  } else if (style === "apa") {
    const author = apaNames(people);
    add(author ? `${end(author)} (${year}). ` : `${title}. (${year}). `);
    if (source.kind === "journal") {
      if (author) add(`${end(title)} `);
      add(container, true);
      if (source.volume) {
        add(", ");
        add(source.volume, true);
      }
      add(`${source.issue ? `(${source.issue})` : ""}${source.pages ? `, ${source.pages}` : ""}. `);
    } else {
      if (author) {
        add(title, true);
        add(". ");
      }
      if (container && !(source.kind === "website" && container === author))
        add(`${end(container)} `);
    }
    if (url) add(url);
  } else {
    const author = mlaNames(people);
    if (author) add(`${end(author)} `);
    if (source.kind === "book") {
      add(title, true);
      add(". ");
      add(`${container ? `${container}, ` : ""}${year}.`);
    } else {
      add(`“${end(title)}” `);
      add(container, true);
      if (source.kind === "journal") {
        add(
          `${source.volume ? `, vol. ${source.volume}` : ""}${source.issue ? `, no. ${source.issue}` : ""}, ${year}${
            source.pages ? `, pp. ${source.pages}` : ""
          }.`,
        );
      } else {
        add(`${container ? ", " : ""}${year}${url ? `, ${url.replace(/^https?:\/\//, "")}` : ""}.`);
        if (accessed) {
          add(
            ` Accessed ${String(accessed[2])} ${MLA_MONTHS[accessed[1] - 1] ?? ""} ${String(accessed[0])}.`,
          );
        }
      }
    }
  }
  return pieces
    .map((piece) => ({ ...piece, text: piece.text.replace(/\s+/g, " ") }))
    .filter((p) => p.text.trim() !== "" || p.text === " ");
}

export const plainText = (pieces: readonly Piece[]) =>
  pieces
    .map((piece) => piece.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** The key a reference list is sorted by: its first author, or its title. */
export const sortKey = (source: Source) =>
  (parseAuthors(source.authors)[0]?.family ?? source.title).toLowerCase();
