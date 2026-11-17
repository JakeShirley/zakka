import { describe, expect, it } from "vitest";

import { createPageDocument, createPhotoLayer } from "./index.js";
import { applySharedBackground, getSpreadPages, syncLayerAcrossSpread } from "./spreads.js";

const blankPage = (width = 600, height = 400) => createPageDocument({ canvas: { width, height } });

describe("spreads", () => {
  it("copies a layer crossing the gutter onto the facing page, shifted into its coordinates", () => {
    const photo = createPhotoLayer({ assetId: "asset", id: "photo", x: 500, y: 50, width: 160 });
    const documents = new Map([
      ["left", createPageDocument({ canvas: { width: 600, height: 400 }, layers: [photo] })],
      ["right", blankPage()],
    ]);

    const result = syncLayerAcrossSpread({
      documents,
      removeNonOverlappingSource: false,
      sourceLayer: photo,
      sourcePageId: "left",
      spreadPageIds: ["left", "right"],
    });

    expect(result.changedPageIds).toEqual(["left", "right"]);
    expect(result.containingPageId).toBe("left");
    expect(result.documents.get("left")?.layers[0]).toMatchObject({ id: "photo", x: 500 });
    expect(result.documents.get("right")?.layers).toEqual([{ ...photo, x: -100 }]);
    expect(documents.get("right")?.layers).toEqual([]);
  });

  it("spans a shared background frame across the spread pages", () => {
    const pages = getSpreadPages(
      new Map([
        ["left", blankPage(600, 400)],
        ["right", blankPage(500, 420)],
      ]),
      ["left", "right"],
    );

    const documents = applySharedBackground(pages, "zakka:hearts");

    expect(documents.get("left")?.canvas.background).toMatchObject({
      height: 420,
      width: 1100,
      x: 0,
    });
    expect(documents.get("right")?.canvas.background).toMatchObject({
      height: 420,
      width: 1100,
      x: -600,
    });
  });
});
