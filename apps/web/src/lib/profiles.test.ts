import { profileColors } from "@brawzer/contracts";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseCssColor } from "./color";
import { initialOf, profileColorShades } from "./profiles";

describe("profile colours", () => {
  it("cover every colour the API accepts", () => {
    expect(Object.keys(profileColorShades).sort()).toEqual([...profileColors].sort());
  });

  it("keep a white initial readable (4.5:1 or better)", () => {
    // parseCssColor reads computed colours, so give it rgb() rather than hex.
    const rgb = (hex: string) =>
      `rgb(${[1, 3, 5].map((start) => String(parseInt(hex.slice(start, start + 2), 16))).join(", ")})`;
    const white = parseCssColor("rgb(255, 255, 255)");
    if (!white) throw new Error("unparseable");
    for (const [name, { hex }] of Object.entries(profileColorShades)) {
      const shade = parseCssColor(rgb(hex));
      if (!shade) throw new Error(`unparseable ${hex}`);
      expect(contrastRatio(shade, white), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("initialOf", () => {
  it("takes the first visible character, whole", () => {
    expect(initialOf("work")).toBe("W");
    expect(initialOf("  école ")).toBe("É");
    expect(initialOf("👩‍💻 Dev")).toBe("👩‍💻");
    expect(initialOf("研究")).toBe("研");
    expect(initialOf("   ")).toBe("?");
  });
});
