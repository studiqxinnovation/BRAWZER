/**
 * Calc's sheets: cells by address ("B4"), each a value or a formula
 * ("=SUM(B1:B3)*2"). Formulas know + - * / ^, brackets, cell references,
 * ranges in functions, and SUM, AVERAGE, MIN, MAX, COUNT, ROUND and ABS.
 * Errors read as a spreadsheet's do: #DIV/0!, #REF!, #NAME?, #CYCLE!, #ERROR!.
 */

export type Cells = Readonly<Record<string, string>>;
export type Value = number | string;

export const COLUMNS = "ABCDEFGHIJKL".split("");
export const ROWS = 40;

const isError = (value: Value) => typeof value === "string" && value.startsWith("#");

class FormulaError extends Error {}

type Token =
  | { kind: "number"; value: number }
  | { kind: "ref"; value: string }
  | { kind: "name"; value: string }
  | { kind: "op"; value: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const space = /^\s+/.exec(rest);
    if (space) {
      index += space[0].length;
      continue;
    }
    const number = /^\d+(\.\d+)?|^\.\d+/.exec(rest);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const ref = /^\$?([A-Za-z])\$?(\d+)(?![A-Za-z(])/.exec(rest);
    if (ref?.[1] && ref[2]) {
      tokens.push({ kind: "ref", value: `${ref[1].toUpperCase()}${ref[2]}` });
      index += ref[0].length;
      continue;
    }
    const name = /^[A-Za-z]+/.exec(rest);
    if (name) {
      tokens.push({ kind: "name", value: name[0].toUpperCase() });
      index += name[0].length;
      continue;
    }
    const character = rest.charAt(0);
    if ("+-*/^(),:".includes(character)) {
      tokens.push({ kind: "op", value: character });
      index += 1;
      continue;
    }
    throw new FormulaError("#ERROR!");
  }
  return tokens;
}

const FUNCTIONS: Record<string, (values: number[]) => number> = {
  SUM: (values) => values.reduce((total, value) => total + value, 0),
  AVERAGE: (values) => {
    if (values.length === 0) throw new FormulaError("#DIV/0!");
    return values.reduce((total, value) => total + value, 0) / values.length;
  },
  MIN: (values) => (values.length ? Math.min(...values) : 0),
  MAX: (values) => (values.length ? Math.max(...values) : 0),
  COUNT: (values) => values.length,
  ROUND: (values) => {
    const [value = 0, places = 0] = values;
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  },
  ABS: (values) => Math.abs(values[0] ?? 0),
};

function cellsInRange(from: string, to: string): string[] {
  const parse = (address: string) => ({
    column: COLUMNS.indexOf(address.charAt(0)),
    row: Number(address.slice(1)),
  });
  const a = parse(from);
  const b = parse(to);
  if (a.column < 0 || b.column < 0) throw new FormulaError("#REF!");
  const addresses: string[] = [];
  for (
    let column = Math.min(a.column, b.column);
    column <= Math.max(a.column, b.column);
    column += 1
  ) {
    for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row += 1) {
      addresses.push(`${COLUMNS[column] ?? ""}${String(row)}`);
    }
  }
  return addresses;
}

/** Works out every cell. */
export function evaluate(cells: Cells): Record<string, Value> {
  const results: Record<string, Value> = {};
  const visiting = new Set<string>();

  function valueOf(address: string): Value {
    if (address in results) return results[address] ?? "";
    if (
      !COLUMNS.includes(address.charAt(0)) ||
      Number(address.slice(1)) < 1 ||
      Number(address.slice(1)) > ROWS
    ) {
      return "#REF!";
    }
    if (visiting.has(address)) return "#CYCLE!";
    visiting.add(address);
    const raw = (cells[address] ?? "").trim();
    let result: Value;
    if (raw.startsWith("=")) {
      try {
        result = formula(raw.slice(1));
        if (typeof result === "number" && !Number.isFinite(result)) result = "#DIV/0!";
      } catch (error) {
        result = error instanceof FormulaError ? error.message : "#ERROR!";
      }
    } else if (raw !== "" && Number.isFinite(Number(raw.replace(/,/g, "")))) {
      result = Number(raw.replace(/,/g, ""));
    } else {
      result = raw;
    }
    visiting.delete(address);
    results[address] = result;
    return result;
  }

  function number(address: string): number {
    const value = valueOf(address);
    if (typeof value === "number") return value;
    if (isError(value)) throw new FormulaError(value);
    if (value === "") return 0;
    throw new FormulaError("#ERROR!");
  }

  function formula(text: string): number {
    const tokens = tokenize(text);
    let position = 0;
    const peek = () => tokens[position];
    const take = () => tokens[position++];
    const expect = (value: string) => {
      const token = take();
      if (token?.kind !== "op" || token.value !== value) throw new FormulaError("#ERROR!");
    };

    function primary(): number {
      const token = take();
      if (!token) throw new FormulaError("#ERROR!");
      if (token.kind === "number") return token.value;
      if (token.kind === "ref") return number(token.value);
      if (token.kind === "op" && token.value === "(") {
        const value = sum();
        expect(")");
        return value;
      }
      if (token.kind === "op" && token.value === "-") return -power();
      if (token.kind === "op" && token.value === "+") return power();
      if (token.kind === "name") {
        const run = FUNCTIONS[token.value];
        if (!run) throw new FormulaError("#NAME?");
        expect("(");
        const values: number[] = [];
        if (!(peek()?.kind === "op" && peek()?.value === ")")) {
          for (;;) {
            const start = peek();
            const next = tokens[position + 1];
            if (start?.kind === "ref" && next?.kind === "op" && next.value === ":") {
              position += 2;
              const end = take();
              if (end?.kind !== "ref") throw new FormulaError("#REF!");
              for (const address of cellsInRange(start.value, end.value)) {
                const value = valueOf(address);
                if (typeof value === "number") values.push(value);
                else if (isError(value)) throw new FormulaError(value);
              }
            } else {
              values.push(sum());
            }
            const separator = peek();
            if (separator?.kind === "op" && separator.value === ",") {
              position += 1;
              continue;
            }
            break;
          }
        }
        expect(")");
        return run(values);
      }
      throw new FormulaError("#ERROR!");
    }

    function power(): number {
      const base = primary();
      const next = peek();
      if (next?.kind === "op" && next.value === "^") {
        position += 1;
        return base ** power();
      }
      return base;
    }

    function product(): number {
      let value = power();
      for (;;) {
        const next = peek();
        if (next?.kind !== "op" || (next.value !== "*" && next.value !== "/")) return value;
        position += 1;
        const right = power();
        if (next.value === "/" && right === 0) throw new FormulaError("#DIV/0!");
        value = next.value === "*" ? value * right : value / right;
      }
    }

    function sum(): number {
      let value = product();
      for (;;) {
        const next = peek();
        if (next?.kind !== "op" || (next.value !== "+" && next.value !== "-")) return value;
        position += 1;
        const right = product();
        value = next.value === "+" ? value + right : value - right;
      }
    }

    const value = sum();
    if (position < tokens.length) throw new FormulaError("#ERROR!");
    return value;
  }

  for (const address of Object.keys(cells)) valueOf(address);
  return results;
}

/** 1234.5 as "1,234.5"; up to ten decimal places, no float noise. */
export function display(value: Value | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return Number.parseFloat(value.toPrecision(12)).toLocaleString("en-GB", {
    maximumFractionDigits: 10,
  });
}

/** The sheet as CSV, formulas kept as written, so spreadsheet apps open them as formulas. */
export function toCsv(cells: Cells): string {
  let lastRow = 0;
  let lastColumn = 0;
  for (const [address, raw] of Object.entries(cells)) {
    if (!raw) continue;
    lastRow = Math.max(lastRow, Number(address.slice(1)));
    lastColumn = Math.max(lastColumn, COLUMNS.indexOf(address.charAt(0)) + 1);
  }
  const lines: string[] = [];
  for (let row = 1; row <= lastRow; row += 1) {
    const line = COLUMNS.slice(0, lastColumn).map((column) => {
      const raw = cells[`${column}${String(row)}`] ?? "";
      return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
    });
    lines.push(line.join(","));
  }
  return lines.join("\r\n");
}

/** CSV into cells, from A1. */
export function fromCsv(text: string): Record<string, string> {
  const cells: Record<string, string> = {};
  let row = 1;
  let column = 0;
  let field = "";
  let quoted = false;
  const commit = () => {
    if (field !== "" && column < COLUMNS.length && row <= ROWS) {
      cells[`${COLUMNS[column] ?? "A"}${String(row)}`] = field;
    }
    field = "";
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (quoted) {
      if (character === '"' && text.charAt(index + 1) === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      commit();
      column += 1;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text.charAt(index + 1) === "\n") index += 1;
      commit();
      row += 1;
      column = 0;
    } else field += character;
  }
  commit();
  return cells;
}
