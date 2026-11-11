"use client";

import { cn } from "@brawzer/ui/lib/cn";
import { useMemo, useSyncExternalStore } from "react";
import { composite, contrastRatio, parseCssColor, type Rgba, toHex } from "@/lib/color";
import { readAccent, resolveTheme, subscribeToAppearance } from "@/lib/theme";
import { Section, SubHeading } from "./section";

type Check =
  | { kind: "none" }
  /** Text drawn in this colour, on every main background. */
  | { kind: "text"; minimum: number }
  /** A control boundary in this colour, against every main background. */
  | { kind: "boundary"; minimum: number }
  /** A fill with text on top of it. */
  | { kind: "fill"; text: string; minimum: number }
  /** A translucent tint with text on top of it. */
  | { kind: "tint"; text: string; minimum: number };

interface TokenRow {
  token: string;
  name: string;
  usage: string;
  check: Check;
}

const none: Check = { kind: "none" };
const aaText: Check = { kind: "text", minimum: 4.5 };

const groups: { title: string; rows: TokenRow[] }[] = [
  {
    title: "Surfaces and lines",
    rows: [
      { token: "--bw-canvas", name: "Canvas", usage: "Page background", check: none },
      {
        token: "--bw-canvas-subtle",
        name: "Canvas subtle",
        usage: "Sidebars and bands",
        check: none,
      },
      { token: "--bw-surface", name: "Surface", usage: "Cards and inputs", check: none },
      {
        token: "--bw-surface-raised",
        name: "Surface raised",
        usage: "Menus and dialogs",
        check: none,
      },
      {
        token: "--bw-surface-sunken",
        name: "Surface sunken",
        usage: "Wells and code",
        check: none,
      },
      { token: "--bw-line", name: "Line", usage: "Hairline dividers", check: none },
      { token: "--bw-line-strong", name: "Line strong", usage: "Container borders", check: none },
      {
        token: "--bw-line-control",
        name: "Line control",
        usage: "Form control borders",
        check: { kind: "boundary", minimum: 3 },
      },
    ],
  },
  {
    title: "Text",
    rows: [
      { token: "--bw-ink", name: "Ink", usage: "Primary text", check: aaText },
      {
        token: "--bw-ink-secondary",
        name: "Ink secondary",
        usage: "Supporting text",
        check: aaText,
      },
      {
        token: "--bw-ink-tertiary",
        name: "Ink tertiary",
        usage: "Hints and placeholders",
        check: aaText,
      },
      {
        token: "--bw-ink-disabled",
        name: "Ink disabled",
        usage: "Disabled text (exempt)",
        check: none,
      },
    ],
  },
  {
    title: "Accent",
    rows: [
      {
        token: "--bw-accent",
        name: "Accent",
        usage: "Primary actions",
        check: { kind: "fill", text: "--bw-on-accent", minimum: 4.5 },
      },
      {
        token: "--bw-accent-hover",
        name: "Accent hover",
        usage: "Pressed and hovered actions",
        check: { kind: "fill", text: "--bw-on-accent", minimum: 4.5 },
      },
      {
        token: "--bw-accent-ink",
        name: "Accent ink",
        usage: "Links and focus rings",
        check: aaText,
      },
      {
        token: "--bw-accent-soft",
        name: "Accent soft",
        usage: "Selected and highlighted backgrounds",
        check: { kind: "tint", text: "--bw-accent-ink", minimum: 4.5 },
      },
    ],
  },
  {
    title: "Status",
    rows: [
      { token: "--bw-success", name: "Success", usage: "Protected, connected", check: aaText },
      { token: "--bw-warning", name: "Warning", usage: "Needs attention", check: aaText },
      { token: "--bw-danger", name: "Danger", usage: "Errors", check: aaText },
      {
        token: "--bw-danger-fill",
        name: "Danger fill",
        usage: "Destructive buttons",
        check: { kind: "fill", text: "--bw-on-accent", minimum: 4.5 },
      },
      {
        token: "--bw-success-soft",
        name: "Success soft",
        usage: "Success badges",
        check: { kind: "tint", text: "--bw-success", minimum: 4.5 },
      },
      {
        token: "--bw-warning-soft",
        name: "Warning soft",
        usage: "Warnings, development notes",
        check: { kind: "tint", text: "--bw-warning", minimum: 4.5 },
      },
      {
        token: "--bw-danger-soft",
        name: "Danger soft",
        usage: "Error banners",
        check: { kind: "tint", text: "--bw-danger", minimum: 4.5 },
      },
    ],
  },
];

const backgrounds = ["--bw-canvas", "--bw-canvas-subtle", "--bw-surface", "--bw-surface-sunken"];

let probe: HTMLSpanElement | undefined;

/** Resolves a token to the colour the browser actually renders. */
function resolve(token: string): Rgba | null {
  if (!probe) {
    probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    // No transition: with reduced motion the site shortens transitions rather than removing
    // them, and a colour read mid-transition is the old one.
    probe.style.cssText =
      "position:absolute;visibility:hidden;pointer-events:none;transition:none !important";
    document.body.append(probe);
  }
  probe.style.color = `var(${token})`;
  return parseCssColor(getComputedStyle(probe).color);
}

interface Measurement {
  value: string;
  result?: { ratio: number; pass: boolean; label: string };
}

function measure(row: TokenRow): Measurement {
  const color = resolve(row.token);
  if (!color) return { value: "—" };
  const canvas = resolve("--bw-canvas");
  const value = color.a < 1 ? `${toHex(color)} · ${Math.round(color.a * 100)}%` : toHex(color);
  const { check } = row;

  if (check.kind === "none" || !canvas) return { value };

  if (check.kind === "text" || check.kind === "boundary") {
    const ratio = Math.min(
      ...backgrounds.map((background) => {
        const bg = resolve(background);
        return bg ? contrastRatio(composite(color, bg), bg) : Number.POSITIVE_INFINITY;
      }),
    );
    const label = check.kind === "text" ? "lowest on any background" : "boundary, lowest";
    return { value, result: { ratio, pass: ratio >= check.minimum, label } };
  }

  const text = resolve(check.text);
  if (!text) return { value };
  const surface = check.kind === "tint" ? composite(color, canvas) : color;
  const ratio = contrastRatio(composite(text, surface), surface);
  return { value, result: { ratio, pass: ratio >= check.minimum, label: "text on top" } };
}

/** Changes whenever the rendered theme or accent changes; "server" before hydration. */
function useAppearanceKey(): string {
  return useSyncExternalStore(
    subscribeToAppearance,
    () => `${resolveTheme()}:${readAccent()}`,
    () => "server",
  );
}

function ContrastChip({ result }: { result: NonNullable<Measurement["result"]> }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 font-mono text-caption",
        result.pass ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
      )}
      title={result.label}
    >
      {result.ratio.toFixed(1)}:1 {result.pass ? "pass" : "fail"}
    </span>
  );
}

export function ColorSection() {
  const key = useAppearanceKey();
  const measurements = useMemo(
    () =>
      key === "server"
        ? null
        : new Map(
            groups.flatMap((group) => group.rows.map((row) => [row.token, measure(row)] as const)),
          ),
    [key],
  );

  return (
    <Section
      id="colour"
      index="02"
      title="Colour"
      description={
        <>
          Warm graphite neutrals, one accent, and status colours kept separate from it so green,
          amber and red always mean something. The values and contrast ratios below are measured
          live from the page, so they follow the theme and accent you pick above. Text must reach
          4.5:1 and control borders 3:1 (WCAG 2.2 AA).
        </>
      }
    >
      <div className="grid gap-10 xl:grid-cols-2">
        {groups.map((group) => (
          <div key={group.title} className="min-w-0">
            <SubHeading>{group.title}</SubHeading>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {group.rows.map((row) => {
                const measurement = measurements?.get(row.token);
                return (
                  <li key={row.token} className="flex items-center gap-4 px-4 py-3">
                    <span
                      aria-hidden="true"
                      className="size-9 shrink-0 rounded-md shadow-[inset_0_0_0_1px_var(--bw-line)]"
                      style={{ backgroundColor: `var(${row.token})` }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-callout font-medium text-ink">{row.name}</p>
                      <p className="truncate text-footnote text-ink-tertiary">{row.usage}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <code className="text-footnote text-ink-secondary">
                        {measurement?.value ?? "—"}
                      </code>
                      {measurement?.result && <ContrastChip result={measurement.result} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}
