import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const tokensCss = readFileSync(path.join(import.meta.dirname, "tokens.css"), "utf8");
const themeCss = readFileSync(path.join(import.meta.dirname, "theme.css"), "utf8");

/** Returns the body of the first rule whose selector ends with `selector`. */
function ruleBody(css: string, selector: string): string {
  const open = css.indexOf(`${selector} {`);
  if (open === -1) throw new Error(`Rule not found: ${selector}`);
  const start = css.indexOf("{", open);
  let depth = 0;
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start + 1, index);
    }
  }
  throw new Error(`Unbalanced braces after ${selector}`);
}

function declarations(body: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) result.set(name, value.replace(/\s+/g, " ").trim());
  }
  return result;
}

const light = declarations(ruleBody(tokensCss, '[data-theme="light"]'));
const forcedDark = declarations(ruleBody(tokensCss, '[data-theme="dark"]'));
const systemDark = declarations(ruleBody(tokensCss, ':root:not([data-theme="light"])'));

describe("design tokens", () => {
  it("keeps the forced and the system dark themes identical", () => {
    expect(systemDark).toEqual(forcedDark);
  });

  it("declares every token in both the light and the dark theme", () => {
    expect([...forcedDark.keys()].sort()).toEqual([...light.keys()].sort());
  });

  it("defines every token that the Tailwind theme refers to", () => {
    const defined = new Set(
      Array.from(tokensCss.matchAll(/(--bw-[\w-]+)\s*:/g), (match) => match[1]),
    );
    const referenced = new Set(
      Array.from(themeCss.matchAll(/var\((--bw-[\w-]+)\)/g), (match) => match[1]),
    );
    expect([...referenced].filter((name) => !defined.has(name))).toEqual([]);
  });

  it("gives every accent palette a value for each theme", () => {
    for (const accent of ["copper", "glacier"]) {
      const palette = declarations(ruleBody(tokensCss, `[data-accent="${accent}"]`));
      expect([...palette.keys()].sort()).toEqual([
        "--bw-accent-dark",
        "--bw-accent-dark-hover",
        "--bw-accent-dark-ink",
        "--bw-accent-light",
        "--bw-accent-light-hover",
        "--bw-accent-light-ink",
      ]);
    }
  });
});
