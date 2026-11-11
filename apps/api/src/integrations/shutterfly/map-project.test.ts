import { readFileSync } from "node:fs";

import { createBookSpreads, type PageLayer } from "@zakka/editor-core";
import { describe, expect, it } from "vitest";

import {
  collectShutterflyProjectReferences,
  mapShutterflyProject,
  type ShutterflyMappingResolvers,
} from "./map-project.js";
import { shutterflyProjectSchema } from "./schemas.js";

const readFixture = (name: string) =>
  shutterflyProjectSchema.parse(
    JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8")),
  );

const project = readFixture("layflat-project.json");
const hardcoverProject = readFixture("hardcover-project.json");

const resolvers: ShutterflyMappingResolvers = {
  photoAssetId: (mediaId) => `asset_${mediaId}`,
  stickerId: (designAssetId) => `custom:custom_sticker_${designAssetId.toLowerCase()}`,
  background: (designAssetId) =>
    designAssetId === "DA_1058"
      ? { kind: "color", color: "#000000" }
      : { kind: "color", color: "#ffffff" },
  fontFamily: (designAssetId) =>
    designAssetId === "DA_46646"
      ? { family: "Inter, sans-serif", matched: false }
      : { family: "Helvetica Neue", matched: true },
};

const findPage = (book: ReturnType<typeof mapShutterflyProject>, title: string) => {
  const page = book.pages.find((candidate) => candidate.title === title);

  if (!page) {
    throw new Error(`Missing page ${title}`);
  }

  return page;
};

const layerOfKind = <Kind extends PageLayer["kind"]>(
  layers: PageLayer[],
  kind: Kind,
): Extract<PageLayer, { kind: Kind }> => {
  const layer = layers.find((candidate) => candidate.kind === kind);

  if (!layer) {
    throw new Error(`Missing ${kind} layer`);
  }

  return layer as Extract<PageLayer, { kind: Kind }>;
};

describe("collectShutterflyProjectReferences", () => {
  it("lists placed photos, fonts for non-empty text, and stickers", () => {
    expect(collectShutterflyProjectReferences(project)).toEqual({
      photos: [{ mediaId: "9000000000000001", imageId: "img-cover" }],
      fontAssetIds: ["DA_46646"],
      stickerAssetIds: ["DA_22741", "DA_893"],
      backgroundAssetIds: [],
    });
  });
});

describe("mapShutterflyProject", () => {
  it("orders covers, inside-cover blanks, and pages so Shutterfly spreads stay paired", () => {
    const book = mapShutterflyProject(project, resolvers);
    const titles = book.pages.map((page) => page.title);

    expect(book).toMatchObject({
      title: "Fixture Layflat Book",
      pageWidth: 2385,
      pageHeight: 2385,
    });
    expect(titles).toHaveLength(34);
    expect(titles.slice(0, 4)).toEqual(["Front cover", "Inside front cover", "Page 1", "Page 2"]);
    expect(titles.slice(-3)).toEqual(["Page 30", "Inside back cover", "Back cover"]);

    const spreads = createBookSpreads(
      book.pages.map((page, sortOrder) => ({ pageId: page.title, sortOrder })),
    );

    expect(spreads.find((spread) => spread.pageIds.includes("Page 2"))?.pageIds).toEqual([
      "Page 2",
      "Page 3",
    ]);
    expect(spreads.find((spread) => spread.pageIds.includes("Page 1"))?.pageIds).toEqual([
      "Inside front cover",
      "Page 1",
    ]);
  });

  it("splits layflat spread photos across both pages with one shared layer id and the crop", () => {
    const book = mapShutterflyProject(project, resolvers);
    const left = layerOfKind(findPage(book, "Page 2").document.layers, "photo");
    const right = layerOfKind(findPage(book, "Page 3").document.layers, "photo");

    expect(left.id).toBe(right.id);
    expect(left.assetId).toBe("asset_9000000000000001");
    expect(left.width).toBeCloseTo(4770, 0);
    expect(right.x).toBeCloseTo(left.x - 2385, 1);
    expect(left.crop.x).toBe(0);
    expect(left.crop.width).toBe(1);
    expect(left.crop.y).toBeCloseTo(1119.3248 / 4710, 4);
    expect(left.crop.height).toBeCloseTo(2385 / 4710, 4);
  });

  it("maps text position, size, color, alignment, and font, and stickers on inside pages", () => {
    const book = mapShutterflyProject(project, resolvers);
    const layers = findPage(book, "Page 1").document.layers;
    const text = layerOfKind(layers, "text");
    const sticker = layerOfKind(layers, "sticker");
    const fontPixels = (46 * 300) / 72;

    expect(text).toMatchObject({
      text: "Test test box",
      color: "#cb2585",
      align: "center",
      fontFamily: "Inter, sans-serif",
    });
    expect(text.fontSize).toBeCloseTo(fontPixels, 0);
    expect(text.x).toBeCloseTo(715.5, 1);
    expect(text.y).toBeCloseTo(445.95 + (302.133 - fontPixels), 0);
    expect(sticker).toMatchObject({ stickerId: "custom:custom_sticker_da_893" });
    expect(sticker.width).toBeCloseTo(1444.6, 1);
  });

  it("maps the front cover with its bordered photo and keeps spine content off the pages", () => {
    const book = mapShutterflyProject(project, resolvers);
    const frontLayers = findPage(book, "Front cover").document.layers;
    const backLayers = findPage(book, "Back cover").document.layers;
    const photo = layerOfKind(frontLayers, "photo");

    expect(photo.border).toMatchObject({ width: 40, color: "#231f20" });
    expect(photo.x).toBeGreaterThan(0);
    expect(photo.x + photo.width).toBeLessThanOrEqual(2385);
    expect(backLayers.some((layer) => layer.kind === "photo")).toBe(false);
    expect(findPage(book, "Front cover").document.canvas.backgroundColor).toBe("#ffffff");
  });

  it("skips empty photo placeholders and reports elements it could not import", () => {
    const book = mapShutterflyProject(project, {
      ...resolvers,
      photoAssetId: () => null,
      stickerId: () => null,
    });

    expect(findPage(book, "Page 20").document.layers).toEqual([]);
    expect(book.warnings).toEqual(
      expect.arrayContaining([
        "Skipped photos that could not be downloaded (2)",
        expect.stringContaining("Skipped stickers that could not be downloaded"),
        "Replaced Shutterfly fonts that have no Zakka equivalent with the default font",
      ]),
    );
  });

  it("maps separate front and back cover surfaces and keeps the first page on the right", () => {
    const book = mapShutterflyProject(hardcoverProject, resolvers);
    const titles = book.pages.map((page) => page.title);
    const frontLayers = findPage(book, "Front cover").document.layers;
    const coverPhoto = layerOfKind(frontLayers, "photo");

    expect(book).toMatchObject({ pageWidth: 2985, pageHeight: 2985 });
    expect(titles.slice(0, 3)).toEqual(["Front cover", "Inside front cover", "Page 1"]);
    expect(titles.slice(-3)).toEqual(["Page 20", "Inside back cover", "Back cover"]);
    expect(coverPhoto.assetId).toBe("asset_8000000000000645");
    // The 3105 x 3510 cover surface (including board wrap) is center-cropped to the page.
    expect(coverPhoto.x).toBeCloseTo(454.22 - 60, 1);
    expect(coverPhoto.y).toBeCloseTo(811.08 - 262.5, 1);
    expect(findPage(book, "Back cover").document.layers).toEqual([]);
  });

  it("uses flat-color design backgrounds as page colors instead of image layers", () => {
    const book = mapShutterflyProject(hardcoverProject, resolvers);
    const pageOne = findPage(book, "Page 1").document;

    expect(pageOne.canvas.backgroundColor).toBe("#ffffff");
    expect(pageOne.layers.map((layer) => layer.kind).sort()).toEqual(["photo", "sticker", "text"]);
    expect(layerOfKind(pageOne.layers, "text")).toMatchObject({ text: "HI MOM", align: "center" });
    expect(layerOfKind(pageOne.layers, "sticker").rotation).toBeCloseTo(17.1, 1);
  });

  it("places image backgrounds as locked photo layers below the page content", () => {
    const book = mapShutterflyProject(hardcoverProject, {
      ...resolvers,
      background: () => ({ kind: "image", assetId: "asset_background" }),
    });
    const [background] = findPage(book, "Front cover").document.layers;

    expect(background).toMatchObject({ kind: "photo", assetId: "asset_background", locked: true });
    // The 3510 px square background image is centered on the 3105 px wide cover surface.
    expect(background?.kind === "photo" ? background.crop.x : -1).toBeCloseTo(202.5 / 3510, 4);
  });
});
