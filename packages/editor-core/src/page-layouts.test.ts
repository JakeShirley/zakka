import { describe, expect, it } from "vitest";

import {
  createPageDocument,
  createPhotoLayer,
  createStickerLayer,
  createTextLayer,
  maxPageLayerCount,
  type PhotoLayer,
  renderPageDocumentSvg,
  type TextLayer,
} from "./index.js";
import {
  applyPageLayout,
  decodePageLayouts,
  filterPageLayoutsForCanvas,
  getPageLayoutCategories,
  getPageLayoutFit,
  type PageLayout,
  PageLayoutLayerLimitError,
  zakkaPageLayouts,
} from "./page-layouts.js";
import { shutterflyPageLayouts } from "./page-layouts-shutterfly.js";

const canvas = { width: 1000, height: 1000, backgroundColor: "#ffffff" };

const layout = (slots: PageLayout["slots"]): PageLayout => ({
  id: "test",
  name: "Test",
  source: "zakka",
  orientation: "any",
  slots,
  photoSlotCount: slots.filter((slot) => slot.kind === "photo").length,
  textSlotCount: slots.filter((slot) => slot.kind === "text").length,
});

// A wide slot on top and a tall slot underneath.
const wideAndTall = layout([
  { kind: "photo", x: 0.1, y: 0.1, width: 0.8, height: 0.3, rotation: 0 },
  { kind: "photo", x: 0.35, y: 0.45, width: 0.3, height: 0.5, rotation: 0 },
]);

const photosById = (layers: readonly unknown[]) =>
  new Map(
    layers
      .filter((layer): layer is PhotoLayer => (layer as PhotoLayer).kind === "photo")
      .map((layer) => [layer.id, layer]),
  );

describe("page layouts", () => {
  it("decodes every imported Shutterfly layout into on-page slots", () => {
    const layouts = decodePageLayouts(shutterflyPageLayouts);

    expect(layouts.length).toBeGreaterThan(1000);
    for (const orientation of ["square", "portrait", "landscape"] as const) {
      expect(layouts.some((entry) => entry.orientation === orientation)).toBe(true);
    }
    for (const entry of layouts) {
      expect(entry.slots.length).toBe(entry.photoSlotCount + entry.textSlotCount);
      for (const slot of entry.slots) {
        expect(slot.width).toBeGreaterThan(0);
        expect(slot.x + slot.width).toBeLessThanOrEqual(1.0001);
        expect(slot.y + slot.height).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it("categorizes layouts from slot geometry", () => {
    const grid = layout([
      { kind: "photo", x: 0.05, y: 0.05, width: 0.4, height: 0.4, rotation: 0 },
      { kind: "photo", x: 0.55, y: 0.05, width: 0.4, height: 0.4, rotation: 0 },
    ]);
    const titledFeature = layout([
      { kind: "photo", x: 0.05, y: 0.2, width: 0.9, height: 0.6, rotation: 0 },
      { kind: "photo", x: 0.05, y: 0.82, width: 0.2, height: 0.15, rotation: 0 },
      {
        kind: "text",
        x: 0.1,
        y: 0.03,
        width: 0.8,
        height: 0.1,
        rotation: 0,
        role: "body",
        align: "center",
      },
    ]);
    const tiltedJournal = layout([
      { kind: "photo", x: 0.1, y: 0.1, width: 0.3, height: 0.3, rotation: -6 },
      {
        kind: "text",
        x: 0.5,
        y: 0.1,
        width: 0.4,
        height: 0.8,
        rotation: 0,
        role: "body",
        align: "left",
      },
    ]);

    expect([...getPageLayoutCategories(grid)].sort()).toEqual(["grid", "photos-only"]);
    expect([...getPageLayoutCategories(titledFeature)].sort()).toEqual(["feature", "titled"]);
    expect([...getPageLayoutCategories(tiltedJournal)].sort()).toEqual([
      "captions",
      "collage",
      "journaling",
    ]);
  });

  it("offers layouts that match the page shape plus the shape-agnostic Zakka layouts", () => {
    const layouts = [...zakkaPageLayouts, ...decodePageLayouts(shutterflyPageLayouts)];
    const portrait = filterPageLayoutsForCanvas(layouts, { ...canvas, height: 1300 });

    expect(portrait.some((entry) => entry.orientation === "portrait")).toBe(true);
    expect(portrait.some((entry) => entry.orientation === "square")).toBe(false);
    expect(portrait.filter((entry) => entry.source === "zakka")).toHaveLength(
      zakkaPageLayouts.length,
    );
  });

  it("fills an empty page with photo and text placeholders", () => {
    const hero = zakkaPageLayouts.find((entry) => entry.id === "zakka:hero-title");
    if (!hero) throw new Error("missing hero layout");

    const { document } = applyPageLayout(createPageDocument({ canvas }), hero);

    expect(document.layers.map((layer) => layer.kind)).toEqual(["photo", "text", "text"]);
    const [photo, title, body] = document.layers as [PhotoLayer, TextLayer, TextLayer];
    expect(photo.assetId).toBeUndefined();
    expect(photo).toMatchObject({ x: 0, y: 0, width: 1000, height: 700 });
    expect(title.text).toBe("");
    expect(title.fontSize).toBeGreaterThan(body.fontSize);
  });

  it("stacks arranged layers in the layout's slot order", () => {
    const textUnderPhotos = layout([
      { kind: "photo", x: 0.05, y: 0.05, width: 0.5, height: 0.5, rotation: 0 },
      {
        kind: "text",
        x: 0.3,
        y: 0.3,
        width: 0.5,
        height: 0.2,
        rotation: 0,
        role: "body",
        align: "left",
      },
      { kind: "photo", x: 0.45, y: 0.45, width: 0.5, height: 0.5, rotation: 0 },
    ]);
    const sticker = createStickerLayer({ id: "sticker" });
    const photo = createPhotoLayer({ id: "photo", assetId: "a1", width: 500, height: 500 });

    const empty = applyPageLayout(createPageDocument({ canvas }), textUnderPhotos);
    const filled = applyPageLayout(
      createPageDocument({ canvas, layers: [sticker, photo] }),
      textUnderPhotos,
    );

    expect(empty.document.layers.map((layer) => layer.kind)).toEqual(["photo", "text", "photo"]);
    expect(filled.document.layers.map((layer) => layer.kind)).toEqual([
      "sticker",
      "photo",
      "text",
      "photo",
    ]);
  });

  it("refuses a layout that would exceed the page layer limit", () => {
    const hero = zakkaPageLayouts.find((entry) => entry.id === "zakka:hero-title");
    if (!hero) throw new Error("missing hero layout");
    const stickers = Array.from({ length: maxPageLayerCount - 2 }, (_, index) =>
      createStickerLayer({ id: `sticker-${index}` }),
    );

    expect(() =>
      applyPageLayout(createPageDocument({ canvas, layers: stickers }), hero),
    ).toThrowError(expect.objectContaining({ excessLayerCount: 1 }));
    expect(() =>
      applyPageLayout(createPageDocument({ canvas, layers: stickers }), hero),
    ).toThrowError(PageLayoutLayerLimitError);
  });

  it("puts photos into the slots that best match their shape", () => {
    const tall = createPhotoLayer({
      id: "tall",
      assetId: "a1",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    const wide = createPhotoLayer({
      id: "wide",
      assetId: "a2",
      x: 0,
      y: 500,
      width: 200,
      height: 200,
    });
    const aspects: Record<string, number> = { a1: 0.66, a2: 1.5 };

    const { document, removedPhotoLayerIds } = applyPageLayout(
      createPageDocument({ canvas, layers: [tall, wide] }),
      wideAndTall,
      { getPhotoAspectRatio: (layer) => aspects[layer.assetId ?? ""] },
    );

    const photos = photosById(document.layers);
    expect(removedPhotoLayerIds).toEqual([]);
    expect(photos.get("wide")).toMatchObject({ x: 100, y: 100, width: 800, height: 300 });
    expect(photos.get("tall")).toMatchObject({ x: 350, y: 450, width: 300, height: 500 });
  });

  it("removes the least prominent photos when the layout has fewer slots", () => {
    const layers = [
      createPhotoLayer({ id: "big", assetId: "a1", width: 600, height: 400 }),
      createPhotoLayer({ id: "small", assetId: "a2", width: 100, height: 100 }),
      createPhotoLayer({ id: "medium", assetId: "a3", width: 300, height: 300 }),
    ];
    const document = createPageDocument({ canvas, layers });

    expect(getPageLayoutFit(document, wideAndTall)).toMatchObject({
      photoCount: 3,
      extraPhotoCount: 1,
      fits: false,
    });
    const result = applyPageLayout(document, wideAndTall);
    expect(result.removedPhotoLayerIds).toEqual(["small"]);
    expect([...photosById(result.document.layers).keys()].sort()).toEqual(["big", "medium"]);
  });

  it("reuses existing placeholders and leaves decorations, locked, and off-page layers alone", () => {
    const sticker = createStickerLayer({ id: "sticker", x: 10, y: 10 });
    const locked = createPhotoLayer({ id: "locked", assetId: "a1", locked: true });
    const spreadCopy = createPhotoLayer({ id: "spread", assetId: "a2", x: 800, width: 600 });
    const placeholders = ["p1", "p2", "p3"].map((id) =>
      createPhotoLayer({ id, x: 0, y: 0, width: 100, height: 100 }),
    );
    const document = createPageDocument({
      canvas,
      layers: [sticker, locked, spreadCopy, ...placeholders],
    });

    expect(getPageLayoutFit(document, wideAndTall).photoCount).toBe(0);
    const result = applyPageLayout(document, wideAndTall);

    expect(result.document.layers.map((layer) => layer.id)).toEqual([
      "sticker",
      "locked",
      "spread",
      "p1",
      "p2",
    ]);
    expect(result.document.layers.slice(0, 3)).toEqual([sticker, locked, spreadCopy]);
  });

  it("moves the largest text into the title slot and keeps text that has no slot", () => {
    const caption = createTextLayer({
      id: "caption",
      text: "Caption",
      fontSize: 40,
      x: 0,
      y: 100,
      width: 500,
    });
    const heading = createTextLayer({
      id: "heading",
      text: "Heading",
      fontSize: 120,
      x: 0,
      y: 600,
      width: 500,
    });
    const note = createTextLayer({
      id: "note",
      text: "Note",
      fontSize: 30,
      x: 5,
      y: 900,
      width: 500,
      height: 60,
    });
    const titleAndBody = layout([
      {
        kind: "text",
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.2,
        rotation: 0,
        role: "title",
        align: "center",
      },
      {
        kind: "text",
        x: 0.1,
        y: 0.8,
        width: 0.8,
        height: 0.1,
        rotation: 0,
        role: "body",
        align: "left",
      },
    ]);

    const result = applyPageLayout(
      createPageDocument({ canvas, layers: [caption, heading, note] }),
      titleAndBody,
    );
    const texts = new Map(
      result.document.layers.map((layer) => [layer.id, layer as TextLayer] as const),
    );

    expect(texts.get("heading")).toMatchObject({ y: 100, height: 200, align: "center" });
    expect(texts.get("caption")).toMatchObject({ y: 800, height: 100, align: "left" });
    expect(texts.get("note")).toEqual(note);
  });

  it("draws empty text boxes only when the editor asks for placeholders", () => {
    const document = createPageDocument({
      canvas,
      layers: [createTextLayer({ id: "empty", text: "" })],
    });

    expect(renderPageDocumentSvg(document)).not.toContain("Add text");
    expect(renderPageDocumentSvg(document, { showTextPlaceholders: true })).toContain(
      'data-text-placeholder="true"',
    );
  });

  it("keeps an empty text box's background under its editor placeholder, matching the export", () => {
    const document = createPageDocument({
      canvas,
      layers: [
        createTextLayer({
          id: "empty",
          text: "",
          background: { enabled: true, color: "#ff0000", opacity: 1, padding: 0, radius: 0 },
        }),
      ],
    });

    expect(renderPageDocumentSvg(document)).toContain('data-text-background="true"');
    const editorSvg = renderPageDocumentSvg(document, { showTextPlaceholders: true });
    expect(editorSvg).toContain('data-text-background="true"');
    expect(editorSvg).toContain('data-text-placeholder="true"');
  });
});
