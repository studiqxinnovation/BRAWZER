/**
 * Sums typed into Search, worked out on the spot as Spotlight does: numbers,
 * + − × ÷, %, ^, brackets and a few functions. Nothing is evaluated as code;
 * this is a small parser of its own, so "2+2" is 4 and anything else is not
 * a sum.
 */

const FUNCTIONS: Record<string, (value: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log10,
  ln: Math.log,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Token =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "op"; value: string };

function tokenise(input: string): Token[] | null {
  const text = input.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/,/g, "");
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at] ?? "";
    if (/\s/.test(char)) {
      at += 1;
      continue;
    }
    const number = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(text.slice(at));
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      at += number[0].length;
      continue;
    }
    const name = /^[a-z]+/i.exec(text.slice(at));
    if (name) {
      tokens.push({ kind: "name", value: name[0].toLowerCase() });
      at += name[0].length;
      continue;
    }
    if ("+-*/^%()".includes(char)) {
      tokens.push({ kind: "op", value: char });
      at += 1;
      continue;
    }
    return null;
  }
  return tokens;
}

/** The value of what was typed, or null if it isn't a sum (or divides by zero). */
export function quickMaths(input: string): number | null {
  const trimmed = input.trim();
  // A lone number, a word or an empty line is not a sum worth answering.
  if (trimmed === "" || /^[\d.,\s]*$/.test(trimmed) || !/[\d)]/.test(trimmed)) return null;
  if (!/[+\-*/^%×÷−(]/.test(trimmed) && !/^[a-z]+\s*\(/i.test(trimmed)) return null;
  const tokens = tokenise(trimmed);
  if (!tokens || tokens.length === 0) return null;
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];

  function primary(): number | null {
    const token = take();
    if (!token) return null;
    if (token.kind === "number") return token.value;
    if (token.kind === "name") {
      const next = peek();
      const fn = FUNCTIONS[token.value];
      if (fn && next?.kind === "op" && next.value === "(") {
        take();
        const inner = expression();
        const close = take();
        if (inner === null || close?.kind !== "op" || close.value !== ")") return null;
        return fn(inner);
      }
      const constant = CONSTANTS[token.value];
      return constant ?? null;
    }
    if (token.value === "(") {
      const inner = expression();
      const close = take();
      if (inner === null || close?.kind !== "op" || close.value !== ")") return null;
      return inner;
    }
    if (token.value === "-") {
      const inner = unary();
      return inner === null ? null : -inner;
    }
    if (token.value === "+") return unary();
    return null;
  }

  function postfix(): number | null {
    let value = primary();
    while (value !== null) {
      const next = peek();
      if (next?.kind === "op" && next.value === "%") {
        take();
        value /= 100;
      } else break;
    }
    return value;
  }

  function unary(): number | null {
    return power();
  }

  function power(): number | null {
    const base = postfix();
    if (base === null) return null;
    const next = peek();
    if (next?.kind === "op" && next.value === "^") {
      take();
      const exponent = unary();
      return exponent === null ? null : base ** exponent;
    }
    return base;
  }

  function term(): number | null {
    let value = unary();
    while (value !== null) {
      const next = peek();
      if (next?.kind !== "op" || (next.value !== "*" && next.value !== "/")) break;
      take();
      const right = unary();
      if (right === null) return null;
      if (next.value === "/" && right === 0) return null;
      value = next.value === "*" ? value * right : value / right;
    }
    return value;
  }

  function expression(): number | null {
    let value = term();
    while (value !== null) {
      const next = peek();
      if (next?.kind !== "op" || (next.value !== "+" && next.value !== "-")) break;
      take();
      const right = term();
      if (right === null) return null;
      value = next.value === "+" ? value + right : value - right;
    }
    return value;
  }

  const result = expression();
  if (result === null || at !== tokens.length || !Number.isFinite(result)) return null;
  return result;
}

/** The answer as Search shows it: up to 10 significant figures, no trailing zeros. */
export function formatAnswer(value: number): string {
  const fixed = Number(value.toPrecision(10));
  return Number.isInteger(fixed) ? fixed.toLocaleString() : String(fixed);
}
