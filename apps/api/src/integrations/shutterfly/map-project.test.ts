import { readFileSync } from "node:fs";

import { createBookSpreads, type PageLayer, parseRichText } from "@zakka/editor-core";
import { describe, expect, it } from "vitest";

import {
  collectShutterflyProjectReferences,
  escapeShutterflyText,
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

  const withTextBackground = (rotation = 0) => {
    const withBackground = structuredClone(project);

    for (const category of withBackground.surfaceCategories) {
      for (const surface of category.surfaces) {
        for (const item of surface.surfaceData.layeredItems) {
          if (item.type === "text" && item.content.userData.assetId === "DA_46646") {
            item.content.userData.backgroundColor = "#818053";
            item.content.userData.backgroundOpacity = 0.51;
            item.container.rot = rotation;
          }
        }
      }
    }

    const [background, text] = findPage(
      mapShutterflyProject(withBackground, resolvers),
      "Page 1",
    ).document.layers.filter(
      (layer): layer is Extract<PageLayer, { kind: "text" }> => layer.kind === "text",
    );

    if (!background || !text) {
      throw new Error("Missing text layers");
    }

    return { background, text };
  };
  const topInset = 302.133 - (46 * 300) / 72;

  it("imports a Shutterfly text background as its own layer at the source box", () => {
    const { background, text } = withTextBackground();

    expect(background).toMatchObject({
      id: `${text.id}_background`,
      text: "",
      background: { enabled: true, color: "#818053", opacity: 0.51, padding: 0, radius: 0 },
    });
    expect(background.x).toBeCloseTo(715.5, 0);
    expect(background.y).toBeCloseTo(445.95, 0);
    expect(background.width).toBeCloseTo(954, 0);
    expect(background.height).toBeCloseTo(477, 0);
    expect(text).toMatchObject({ text: "Test test box", background: { enabled: false } });
    expect(text.y).toBeCloseTo(445.95 + topInset, 0);
    expect(text.y + text.height).toBeCloseTo(445.95 + 477, 0);
  });

  it("keeps rotated text inside its rotated Shutterfly box", () => {
    const { background, text } = withTextBackground(90);
    const boxCenter = { x: 715.5 + 954 / 2, y: 445.95 + 477 / 2 };

    expect(background.rotation).toBe(90);
    expect(background.x + background.width / 2).toBeCloseTo(boxCenter.x, 0);
    expect(background.y + background.height / 2).toBeCloseTo(boxCenter.y, 0);
    expect(text.rotation).toBe(90);
    expect(text.height).toBeCloseTo(477 - topInset, 0);
    // Rotating 90 degrees turns the box's downward axis to the left, so the text center moves left.
    expect(text.x + text.width / 2).toBeCloseTo(boxCenter.x - topInset / 2, 0);
    expect(text.y + text.height / 2).toBeCloseTo(boxCenter.y, 0);
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

  it("imports empty photo wells as placeholders and reports elements it could not import", () => {
    const book = mapShutterflyProject(project, {
      ...resolvers,
      photoAssetId: () => null,
      stickerId: () => null,
    });
    const placeholders = book.pages.flatMap((page) =>
      page.document.layers.filter((layer) => layer.kind === "photo"),
    );
    const emptyWell = layerOfKind(findPage(book, "Page 20").document.layers, "photo");

    expect(placeholders.length).toBeGreaterThan(0);
    expect(placeholders.every((layer) => layer.assetId === undefined)).toBe(true);
    expect(emptyWell).toMatchObject({ x: 0, y: 0, width: 2385, height: 2385 });
    expect(emptyWell.crop).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
    expect(book.warnings).toEqual(
      expect.arrayContaining([
        "Left empty photo placeholders for photos that could not be downloaded (2)",
        expect.stringContaining("Skipped stickers that could not be downloaded"),
        "Replaced Shutterfly fonts that have no Zakka equivalent with the default font",
      ]),
    );
    expect(book.warnings.some((warning) => warning.startsWith("Skipped photos"))).toBe(false);
  });

  it("keeps empty photo wells as placeholders without a warning", () => {
    const book = mapShutterflyProject(project, resolvers);
    const emptyWell = layerOfKind(findPage(book, "Page 20").document.layers, "photo");

    expect(emptyWell.assetId).toBeUndefined();
    expect(book.warnings.some((warning) => warning.includes("photo placeholders"))).toBe(false);
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

  it("sets image backgrounds as the page background instead of a layer", () => {
    const book = mapShutterflyProject(hardcoverProject, {
      ...resolvers,
      background: () => ({ kind: "image", backgroundId: "custom:custom_background_cover" }),
    });
    const cover = findPage(book, "Front cover").document;

    expect(cover.layers.some((layer) => layer.kind === "photo" && layer.locked)).toBe(false);
    expect(cover.canvas.background?.backgroundId).toBe("custom:custom_background_cover");
    // The 3510 px square background image is centered on the 3105 px wide cover surface, so the
    // frame keeps its full size and extends past the page on both sides.
    expect(cover.canvas.background?.width).toBeCloseTo(cover.canvas.background?.height ?? 0, 0);
    expect(cover.canvas.background?.x).toBeLessThan(0);
  });

  it("spans spread backgrounds across both pages with the spread frame offset", () => {
    const withBackground = structuredClone(project);
    const spread = withBackground.surfaceCategories
      .find((category) => category.categoryName === "inside")
      ?.surfaces.find((surface) => surface.surfaceNumber === "1");

    if (!spread) {
      throw new Error("Missing spread surface");
    }

    const { width, height } = spread.surfaceData.pageDetails;

    spread.surfaceData.layeredItems.unshift({
      ...spread.surfaceData.layeredItems[0],
      type: "background",
      container: { x: 0, y: 0, w: width, h: height, rot: 0 },
      content: {
        contentType: "Background",
        userData: { assetId: "DA_spread", x: 0, y: 0, w: width, h: height },
      },
      layerMetadata: [],
    } as (typeof spread.surfaceData.layeredItems)[number]);

    const book = mapShutterflyProject(withBackground, {
      ...resolvers,
      background: () => ({ kind: "image", backgroundId: "custom:custom_background_spread" }),
    });
    const left = findPage(book, "Page 2").document.canvas.background;
    const right = findPage(book, "Page 3").document.canvas.background;

    expect(left).toMatchObject({ backgroundId: "custom:custom_background_spread", x: 0 });
    expect(left?.width).toBeCloseTo(book.pageWidth * 2, 0);
    expect(right?.x).toBeCloseTo(-book.pageWidth, 0);
    expect(right?.width).toBeCloseTo(left?.width ?? 0, 0);
  });

  it("chooses one frame for both halves of a spread background", () => {
    const withBackground = structuredClone(project);
    const spread = withBackground.surfaceCategories
      .find((category) => category.categoryName === "inside")
      ?.surfaces.find((surface) => surface.surfaceNumber === "1");

    if (!spread) {
      throw new Error("Missing spread surface");
    }

    const { width, height } = spread.surfaceData.pageDetails;

    // The zoomed image covers the whole spread, but its container stops partway into the right
    // page, so only the left page could keep the zoomed frame on its own.
    spread.surfaceData.layeredItems.unshift({
      ...spread.surfaceData.layeredItems[0],
      type: "background",
      container: { x: 0, y: 0, w: width * 0.75, h: height, rot: 0 },
      content: {
        contentType: "Background",
        userData: { assetId: "DA_spread", x: -width * 0.1, y: 0, w: width * 1.2, h: height },
      },
      layerMetadata: [],
    } as (typeof spread.surfaceData.layeredItems)[number]);

    const book = mapShutterflyProject(withBackground, {
      ...resolvers,
      background: () => ({ kind: "image", backgroundId: "custom:custom_background_spread" }),
    });
    const left = findPage(book, "Page 2").document.canvas.background;
    const right = findPage(book, "Page 3").document.canvas.background;

    expect(left?.x).toBeCloseTo(0, 0);
    expect(left?.width).toBeCloseTo(book.pageWidth * 2 * 0.75, 0);
    expect(right?.x).toBeCloseTo(-book.pageWidth, 0);
    expect(right?.width).toBeCloseTo(left?.width ?? 0, 0);
  });

  it("keeps rotated spread elements on both pages when their rotated bounds cross the gutter", () => {
    const rotated = structuredClone(project);
    const spread = rotated.surfaceCategories
      .find((category) => category.categoryName === "inside")
      ?.surfaces.find((surface) => surface.surfaceNumber === "1");

    spread?.surfaceData.layeredItems.push({
      ...spread.surfaceData.layeredItems[0],
      type: "embellishment",
      container: { x: 2050, y: 800, w: 300, h: 700, rot: 90 },
      content: { contentType: "Embellishment", userData: { assetId: "DA_893" } },
      layerMetadata: [],
    } as (typeof spread.surfaceData.layeredItems)[number]);

    const book = mapShutterflyProject(rotated, resolvers);

    expect(findPage(book, "Page 2").document.layers.some((layer) => layer.kind === "sticker")).toBe(
      true,
    );
    expect(findPage(book, "Page 3").document.layers.some((layer) => layer.kind === "sticker")).toBe(
      true,
    );
  });
});

describe("photo-well references", () => {
  it("places photos whose image reference comes only from the project's photo well", () => {
    const withoutAssetIds = structuredClone(project);

    for (const category of withoutAssetIds.surfaceCategories) {
      for (const surface of category.surfaces) {
        for (const item of surface.surfaceData.layeredItems) {
          if (item.type === "photo") {
            delete item.content.userData.assetId;
          }
        }
      }
    }

    const references = collectShutterflyProjectReferences(withoutAssetIds);
    const book = mapShutterflyProject(withoutAssetIds, resolvers);

    expect(references.photos).toEqual([{ mediaId: "9000000000000001", imageId: "img-cover" }]);
    expect(layerOfKind(findPage(book, "Page 2").document.layers, "photo").assetId).toBe(
      "asset_9000000000000001",
    );
  });
});

describe("escapeShutterflyText", () => {
  it("keeps Markdown-like characters literal when Zakka renders the text", () => {
    const caption = "Our *favorite* trip_2024 `beach` [day] <3";
    const { text, truncated } = escapeShutterflyText(caption);

    expect(truncated).toBe(false);
    expect(parseRichText(text)).toEqual([[{ text: caption, bold: false, italic: false }]]);
  });

  it("reports when escaped text must be shortened to fit Zakka's limit", () => {
    const result = escapeShutterflyText("*".repeat(1500));

    expect(result).toEqual({ text: "\\*".repeat(1000), truncated: true });
  });
});
