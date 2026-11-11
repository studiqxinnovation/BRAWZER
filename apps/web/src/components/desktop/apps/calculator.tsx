"use client";

import { type KeyboardEvent, useState } from "react";

type Operator = "+" | "−" | "×" | "÷";

interface State {
  /** What the display shows, as typed. */
  entry: string;
  /** The value waiting for the second number, and its operator. */
  pending: { value: number; operator: Operator } | null;
  /** The next digit starts a new number (after an operator or =). */
  fresh: boolean;
  error: boolean;
}

const START: State = { entry: "0", pending: null, fresh: false, error: false };

/** 0.1 + 0.2 shows 0.3: twelve significant digits, no trailing zeros. */
export function tidy(value: number): string {
  if (!Number.isFinite(value)) return "Error";
  const rounded = Number.parseFloat(value.toPrecision(12));
  const text = String(rounded);
  return text.length > 14 ? rounded.toExponential(6).replace(/\.?0+e/, "e") : text;
}

export function apply(left: number, operator: Operator, right: number): number {
  switch (operator) {
    case "+":
      return left + right;
    case "−":
      return left - right;
    case "×":
      return left * right;
    case "÷":
      return right === 0 ? Number.NaN : left / right;
  }
}

const OPERATOR_NAMES: Record<Operator, string> = {
  "+": "Add",
  "−": "Subtract",
  "×": "Multiply",
  "÷": "Divide",
};

/** A calculator, by pointer or keyboard (digits, + - * /, Enter, Backspace, Escape, %). */
export default function CalculatorApp() {
  const [state, setState] = useState<State>(START);

  function digit(d: string) {
    setState((s) => {
      if (s.error) return { ...START, entry: d === "." ? "0." : d };
      if (s.fresh) return { ...s, entry: d === "." ? "0." : d, fresh: false };
      if (d === "." && s.entry.includes(".")) return s;
      if (s.entry.replace(/[-.]/g, "").length >= 14) return s;
      return { ...s, entry: s.entry === "0" && d !== "." ? d : s.entry + d };
    });
  }

  function operate(operator: Operator) {
    setState((s) => {
      if (s.error) return s;
      const current = Number.parseFloat(s.entry);
      if (s.pending && !s.fresh) {
        const result = apply(s.pending.value, s.pending.operator, current);
        if (!Number.isFinite(result)) return { ...s, entry: "Error", error: true, pending: null };
        return { ...s, entry: tidy(result), pending: { value: result, operator }, fresh: true };
      }
      return { ...s, pending: { value: current, operator }, fresh: true };
    });
  }

  function equals() {
    setState((s) => {
      if (!s.pending || s.error) return { ...s, fresh: true };
      const result = apply(s.pending.value, s.pending.operator, Number.parseFloat(s.entry));
      if (!Number.isFinite(result)) return { ...s, entry: "Error", error: true, pending: null };
      return { ...s, entry: tidy(result), pending: null, fresh: true };
    });
  }

  function clear() {
    setState((s) => (s.entry !== "0" && !s.fresh ? { ...s, entry: "0" } : START));
  }

  function backspace() {
    setState((s) => {
      if (s.fresh || s.error) return s;
      const next = s.entry.slice(0, -1);
      return { ...s, entry: next === "" || next === "-" ? "0" : next };
    });
  }

  function negate() {
    setState((s) =>
      s.error || s.entry === "0"
        ? s
        : { ...s, entry: s.entry.startsWith("-") ? s.entry.slice(1) : `-${s.entry}` },
    );
  }

  function percent() {
    setState((s) => {
      if (s.error) return s;
      const current = Number.parseFloat(s.entry);
      // 200 + 10 % is 200 + 20, as calculators do; on its own, 10 % is 0.1.
      const result =
        s.pending && (s.pending.operator === "+" || s.pending.operator === "−")
          ? (s.pending.value * current) / 100
          : current / 100;
      return { ...s, entry: tidy(result), fresh: false };
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    const handled = (run: () => void) => {
      event.preventDefault();
      run();
    };
    if (/^[0-9]$/.test(key) || key === ".") handled(() => digit(key));
    else if (key === "+") handled(() => operate("+"));
    else if (key === "-") handled(() => operate("−"));
    else if (key === "*" || key === "x") handled(() => operate("×"));
    else if (key === "/") handled(() => operate("÷"));
    else if (key === "Enter" || key === "=") handled(equals);
    else if (key === "Backspace") handled(backspace);
    else if (key === "Escape" || key === "Delete") handled(clear);
    else if (key === "%") handled(percent);
  }

  const shown = state.entry;
  const allClear = state.entry === "0" || state.fresh;
  const key = (
    label: string,
    run: () => void,
    kind: "num" | "fn" | "op" = "num",
    extra: { name?: string; pressed?: boolean; wide?: boolean } = {},
  ) => (
    <button
      type="button"
      className="ap-calc-key"
      data-kind={kind}
      data-wide={extra.wide === true ? true : undefined}
      aria-label={extra.name}
      aria-pressed={extra.pressed}
      onClick={run}
    >
      {label}
    </button>
  );
  const op = (operator: Operator) =>
    key(operator, () => operate(operator), "op", {
      name: OPERATOR_NAMES[operator],
      pressed: state.pending?.operator === operator && state.fresh,
    });

  return (
    // Typing works anywhere in the calculator, as on a desktop.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="ap-calc" onKeyDown={onKeyDown}>
      <div className="ap-calc-display">
        <span className="ap-calc-memory" aria-hidden="true">
          {state.pending
            ? `${tidy(state.pending.value).replace("-", "−")} ${state.pending.operator}`
            : ""}
        </span>
        <output className="ap-calc-value" aria-live="polite" aria-label="Result">
          {shown.replace("-", "−")}
        </output>
      </div>
      <div className="ap-calc-keys">
        {key(allClear ? "AC" : "C", clear, "fn", { name: allClear ? "All clear" : "Clear" })}
        {key("±", negate, "fn", { name: "Change sign" })}
        {key("%", percent, "fn", { name: "Percent" })}
        {op("÷")}
        {key("7", () => digit("7"))}
        {key("8", () => digit("8"))}
        {key("9", () => digit("9"))}
        {op("×")}
        {key("4", () => digit("4"))}
        {key("5", () => digit("5"))}
        {key("6", () => digit("6"))}
        {op("−")}
        {key("1", () => digit("1"))}
        {key("2", () => digit("2"))}
        {key("3", () => digit("3"))}
        {op("+")}
        {key("0", () => digit("0"), "num", { wide: true })}
        {key(".", () => digit("."), "num", { name: "Decimal point" })}
        {key("=", equals, "op", { name: "Equals" })}
      </div>
    </div>
  );
}
