import { describe, expect, it } from "vitest";
import { videoRates, videoSize } from "./video.ts";

describe("the size a moving page is encoded at", () => {
  it("is the viewer's own pixel ratio, so moving looks like still", () => {
    expect(videoSize({ width: 1180, height: 596, scale: 2 }, false)).toEqual({
      width: 2360,
      height: 1192,
    });
    expect(videoSize({ width: 1016, height: 512, scale: 1 }, false)).toEqual({
      width: 1016,
      height: 512,
    });
  });

  it("stops at what the encoder keeps up with, and never goes under the page's own size", () => {
    const big = videoSize({ width: 1920, height: 1080, scale: 3 }, false);
    expect(big.width * big.height).toBeLessThanOrEqual(2560 * 1440 + 2560);
    expect(big.width / big.height).toBeCloseTo(1920 / 1080, 2);
    expect(videoSize({ width: 3840, height: 2160, scale: 2 }, false)).toEqual({
      width: 3840,
      height: 2160,
    });
  });

  it("is the page's own size for a connection that fell behind", () => {
    expect(videoSize({ width: 1180, height: 596, scale: 2 }, true)).toEqual({
      width: 1180,
      height: 596,
    });
  });
});

describe("what the encoder may spend", () => {
  it("grows with the picture, within bounds, and is small when light", () => {
    expect(videoRates(1016, 512, false).bitrate).toBe(2_500_000);
    expect(videoRates(2360, 1192, false).bitrate).toBe(Math.round(2360 * 1192 * 2.5));
    expect(videoRates(3840, 2160, false).bitrate).toBe(8_000_000);
    expect(videoRates(2360, 1192, true).bitrate).toBe(1_600_000);
    const rates = videoRates(2360, 1192, false);
    expect(rates.ceiling).toBeGreaterThan(rates.bitrate);
  });
});
