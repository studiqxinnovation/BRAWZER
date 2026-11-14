import { PICTURES_KEPT } from "@brawzer/contracts";
import { describe, expect, it } from "vitest";
import { KeptPictures } from "./kept-pictures";

const header = (frameId: number, more: { keep?: boolean; again?: number } = {}) => ({
  tabId: "tab",
  frameId,
  width: 2,
  height: 2,
  scale: 2,
  ...more,
});
const image = (byte: number) => new Uint8Array([byte]);
const none = new Uint8Array(0);

describe("the pictures a viewer keeps", () => {
  it("shows a kept picture again when told to, without its image being sent", () => {
    const pictures = new KeptPictures();
    expect(pictures.take(header(1, { keep: true }), image(1))).toEqual(image(1));
    expect(pictures.take(header(2, { keep: true }), image(2))).toEqual(image(2));
    // A cursor blinking: the two take turns.
    expect(pictures.take(header(3, { again: 1 }), none)).toEqual(image(1));
    expect(pictures.take(header(4, { again: 2 }), none)).toEqual(image(2));
  });

  it("keeps only what it was asked to, and only the newest", () => {
    const pictures = new KeptPictures();
    expect(pictures.take(header(1), image(1))).toEqual(image(1));
    expect(pictures.take(header(2, { again: 1 }), none)).toBeNull();
    for (let id = 10; id < 10 + PICTURES_KEPT + 1; id += 1) {
      pictures.take(header(id, { keep: true }), image(id));
    }
    expect(pictures.take(header(30, { again: 10 }), none)).toBeNull();
    expect(pictures.take(header(31, { again: 11 }), none)).toEqual(image(11));
    expect(pictures.take(header(32, { again: 10 + PICTURES_KEPT }), none)).toEqual(
      image(10 + PICTURES_KEPT),
    );
  });

  it("has nothing once cleared: a new connection starts over", () => {
    const pictures = new KeptPictures();
    pictures.take(header(1, { keep: true }), image(1));
    pictures.clear();
    expect(pictures.take(header(2, { again: 1 }), none)).toBeNull();
  });
});
