import { describe, expect, it } from "vitest";
import {
  encoderThreads,
  frameSize,
  framesAreFull,
  jpegSize,
  pictureScale,
  startScale,
  videoRates,
  videoSize,
} from "./video.ts";

describe("the size a moving page is encoded at", () => {
  it("is the page's own, whatever the viewer's pixel ratio", () => {
    expect(videoSize({ width: 1180, height: 596 })).toEqual({ width: 1180, height: 596 });
    expect(videoSize({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 });
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

describe("the encoder's threads", () => {
  it("follow the container's processors, four at most, two when unsaid", () => {
    expect(encoderThreads(undefined)).toEqual({ threads: 2, slices: 1 });
    expect(encoderThreads("1")).toEqual({ threads: 1, slices: 1 });
    expect(encoderThreads("2")).toEqual({ threads: 2, slices: 1 });
    expect(encoderThreads("4")).toEqual({ threads: 4, slices: 4 });
    expect(encoderThreads("16")).toEqual({ threads: 4, slices: 4 });
    expect(encoderThreads("many")).toEqual({ threads: 2, slices: 1 });
  });
});

describe("the engine's frames of the page", () => {
  it("are as dense as the viewer's screen, up to a bound", () => {
    expect(frameSize({ width: 1440, height: 800, scale: 2 })).toEqual({
      width: 2880,
      height: 1600,
    });
    expect(framesAreFull({ width: 1440, height: 800, scale: 2 }, 2)).toBe(true);
    expect(framesAreFull({ width: 1016, height: 512, scale: 1 }, 1)).toBe(true);
    const big = frameSize({ width: 2560, height: 1440, scale: 2 });
    expect(big.width * big.height).toBeLessThanOrEqual(6_000_000 + 4_000);
    expect(framesAreFull({ width: 2560, height: 1440, scale: 2 }, 2)).toBe(false);
    // Never under the page's own size.
    expect(frameSize({ width: 3840, height: 2160, scale: 1 })).toEqual({
      width: 3840,
      height: 2160,
    });
    expect(framesAreFull({ width: 3840, height: 2160, scale: 1 }, 1)).toBe(true);
  });

  it("carry no more pixels than the engine was started to draw", () => {
    const dense = { width: 1440, height: 800, scale: 2 };
    // Started for a plain screen, watched on a dense one: the frames are not its picture.
    expect(framesAreFull(dense, 1)).toBe(false);
    expect(framesAreFull(dense, 1.5)).toBe(false);
    // Started for a dense screen, watched on a plainer one: more than enough.
    expect(framesAreFull({ width: 1440, height: 800, scale: 1 }, 2)).toBe(true);
    expect(framesAreFull({ width: 1440, height: 800, scale: 1.5 }, 2)).toBe(true);
    // The same ratio, rounded on its way here.
    expect(framesAreFull({ width: 1440, height: 800, scale: 1.75 }, 1.74)).toBe(true);
    expect(framesAreFull({ width: 1440, height: 800, scale: 1.75 }, 1.7)).toBe(false);
  });
});

describe("the pixel ratio the engine is started at", () => {
  it("is the one the start request names, within what the stream carries", () => {
    expect(startScale('{"scale":2}')).toBe(2);
    expect(startScale('{"scale":1.5}')).toBe(1.5);
    expect(startScale('{"scale":1.3333333}')).toBe(1.33);
    expect(startScale('{"scale":3}')).toBe(2);
    expect(startScale('{"scale":0.5}')).toBe(1);
  });

  it("is 1 when the request names none, or nothing that is one", () => {
    expect(startScale("")).toBe(1);
    expect(startScale("{}")).toBe(1);
    expect(startScale("null")).toBe(1);
    expect(startScale("not json")).toBe(1);
    expect(startScale('{"scale":"2"}')).toBe(1);
    expect(startScale('{"scale":null}')).toBe(1);
    expect(startScale('{"scale":1e999}')).toBe(1);
  });
});

describe("a picture's size", () => {
  const jpeg = (width: number, height: number): Buffer =>
    Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      // An application segment, then a table, before the frame header.
      Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
      Buffer.from([0xff, 0xc4, 0x00, 0x03, 0x00]),
      Buffer.from([
        0xff,
        0xc0,
        0x00,
        0x0b,
        0x08,
        height >> 8,
        height & 255,
        width >> 8,
        width & 255,
      ]),
      Buffer.from([0x03, 0x01, 0x22, 0x00]),
    ]);

  it("is read from the JPEG itself", () => {
    expect(jpegSize(jpeg(2560, 1600))).toEqual({ width: 2560, height: 1600 });
    expect(jpegSize(jpeg(1, 65_535))).toEqual({ width: 1, height: 65_535 });
    expect(jpegSize(Buffer.from("not a picture"))).toBeNull();
    expect(jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });

  it("comes with the scale that gives the page's size back exactly", () => {
    expect(pictureScale({ width: 2560, height: 1600 }, { width: 1280, height: 800 })).toBe(2);
    expect(pictureScale({ width: 1280, height: 800 }, { width: 1280, height: 800 })).toBe(1);
    // The engine rounded one side down: the size on screen is still the page's.
    for (const picture of [
      { width: 2161, height: 1349 },
      { width: 2160, height: 1349 },
      { width: 2161, height: 1350 },
    ]) {
      const scale = pictureScale(picture, { width: 1283, height: 801 });
      expect(Math.round(picture.width / scale)).toBe(1283);
      expect(Math.round(picture.height / scale)).toBe(801);
    }
    // Never under 1, whatever arrives.
    expect(pictureScale({ width: 640, height: 400 }, { width: 1280, height: 800 })).toBe(1);
  });
});
