import { describe, expect, it } from "vitest";
import { strFromU8 } from "fflate";
import type { SlideDeck } from "../templates";
import { readParts } from "./package-xml";
import { deckToPptx, pptxToSlides } from "./pptx";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);

describe("PowerPoint presentations", () => {
  it("writes a deck that reads back slide by slide, pictures included", async () => {
    const deck: SlideDeck = {
      version: 1,
      theme: "ocean",
      slides: [
        { id: "1", layout: "title", title: "Seed round", body: "Our bet" },
        { id: "2", layout: "bullets", title: "Why now", body: "Faster\nCheaper\n\nSafer" },
        { id: "3", layout: "picture", title: "The product", body: "Caption", imageId: "img" },
        { id: "4", layout: "picture", title: "Gone", body: "", imageId: "missing" },
      ],
    };
    const bytes = await deckToPptx(deck, (id) =>
      Promise.resolve(
        id === "img" ? { bytes: PNG, type: "image/png", width: 400, height: 300 } : null,
      ),
    );
    const parts = readParts(bytes);
    expect(Object.keys(parts ?? {})[0]).toBe("[Content_Types].xml");
    expect(parts?.["ppt/media/image3.png"]).toEqual(PNG);
    const slide2 = strFromU8(parts?.["ppt/slides/slide2.xml"] ?? new Uint8Array());
    expect(slide2).toContain("<a:buChar");
    expect(slide2).toContain("<a:t>Cheaper</a:t>");
    const types = strFromU8(parts?.["[Content_Types].xml"] ?? new Uint8Array());
    expect(types).toContain('Extension="png"');
    expect(pptxToSlides(bytes)).toEqual([
      { layout: "title", title: "Seed round", body: "Our bet" },
      { layout: "bullets", title: "Why now", body: "Faster\nCheaper\nSafer" },
      {
        layout: "picture",
        title: "The product",
        body: "Caption",
        picture: { bytes: PNG, type: "image/png", name: "image3.png" },
      },
      { layout: "title", title: "Gone", body: "" },
    ]);
  });

  it("says when bytes aren't a presentation", () => {
    expect(pptxToSlides(new TextEncoder().encode("nope"))).toBeNull();
  });
});
