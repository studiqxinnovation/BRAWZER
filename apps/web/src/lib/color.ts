/** sRGB colour with 0–255 channels and 0–1 alpha. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Parses computed CSS colours as browsers report them:
 * `rgb(28, 27, 25)`, `rgba(28, 27, 25, 0.5)`, `rgb(28 27 25 / 50%)` and
 * `color(srgb 0.11 0.1 0.09 / 0.5)` (what color-mix() computes to).
 */
export function parseCssColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();

  const srgb =
    /^color\(srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)(?:\s*\/\s*([\d.e+-]+%?))?\s*\)$/.exec(
      text,
    );
  if (srgb) {
    const [, r = "0", g = "0", b = "0", alpha] = srgb;
    return {
      r: clamp(Number(r) * 255, 0, 255),
      g: clamp(Number(g) * 255, 0, 255),
      b: clamp(Number(b) * 255, 0, 255),
      a: parseAlpha(alpha),
    };
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
    text,
  );
  if (rgb) {
    const [, r = "0", g = "0", b = "0", alpha] = rgb;
    return { r: Number(r), g: Number(g), b: Number(b), a: parseAlpha(alpha) };
  }

  return null;
}

function parseAlpha(alpha: string | undefined): number {
  if (alpha === undefined) return 1;
  return clamp(alpha.endsWith("%") ? Number(alpha.slice(0, -1)) / 100 : Number(alpha), 0, 1);
}

/** Flattens a translucent colour onto an opaque background. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio between two opaque colours, from 1 to 21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

export function toHex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
