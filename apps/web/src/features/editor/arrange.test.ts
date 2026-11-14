import { createPhotoLayer, createTextLayer, type PageLayer } from "@zakka/editor-core";
import { describe, expect, it } from "vitest";

import {
  type ArrangePlan,
  type ArrangeSettings,
  defaultArrangeSettings,
  planAlign,
  planGrid,
  planSpread,
} from "./arrange";

const canvas = { backgroundColor: "#ffffff", height: 1000, width: 1000 } as const;

const box = (id: string, x: number, y: number, width: number, height: number, extra = {}) =>
  createPhotoLayer({ assetId: "asset", id, x, y, width, height, ...extra }) as PageLayer;

const positions = (layers: PageLayer[], plan: ArrangePlan | null) => {
  const updates = new Map(plan?.updates.map(({ layerId, update }) => [layerId, update]));
  return Object.fromEntries(
    layers.map((layer) => {
      const next = { ...layer, ...updates.get(layer.id) };
      return [layer.id, { x: next.x, y: next.y, width: next.width, height: next.height }];
    }),
  );
};

const align = (overrides: Partial<ArrangeSettings["align"]>) => ({
  ...defaultArrangeSettings.align,
  ...overrides,
});
const spread = (overrides: Partial<ArrangeSettings["spread"]>) => ({
  ...defaultArrangeSettings.spread,
  ...overrides,
});
const grid = (overrides: Partial<ArrangeSettings["grid"]>) => ({
  ...defaultArrangeSettings.grid,
  ...overrides,
});

describe("planAlign", () => {
  const a = box("a", 100, 100, 100, 100);
  const b = box("b", 300, 250, 200, 50);
  const c = box("c", 600, 400, 50, 300);

  it("aligns the other layers to the last selected layer, which stays put", () => {
    const plan = planAlign([a, b, c], canvas, align({ horizontal: "left", vertical: "top" }));

    expect(plan?.anchorLayerId).toBe("c");
    expect(plan?.updates.map(({ layerId }) => layerId)).toEqual(["a", "b"]);
    expect(positions([a, b, c], plan)).toMatchObject({
      a: { x: 600, y: 400 },
      b: { x: 600, y: 400 },
      c: { x: 600, y: 400 },
    });
  });

  it("resolves first selected, largest and smallest anchors", () => {
    const settings = { horizontal: "right" as const };

    expect(
      planAlign([a, b, c], canvas, align({ ...settings, relativeTo: "firstSelected" }))
        ?.anchorLayerId,
    ).toBe("a");
    expect(
      planAlign([a, b, c], canvas, align({ ...settings, relativeTo: "largest" }))?.anchorLayerId,
    ).toBe("c");
    expect(
      planAlign([a, b, c], canvas, align({ ...settings, relativeTo: "smallest" }))?.anchorLayerId,
    ).toBe("a");
  });

  it("centers each layer on the page, or the whole selection when moved as a group", () => {
    const each = planAlign([a, b], canvas, align({ horizontal: "center", relativeTo: "page" }));
    expect(positions([a, b], each)).toMatchObject({ a: { x: 450 }, b: { x: 400 } });

    const group = planAlign(
      [a, b],
      canvas,
      align({ asGroup: true, horizontal: "center", relativeTo: "page" }),
    );
    // Selection spans 100..500, so the group shifts right by 200.
    expect(positions([a, b], group)).toMatchObject({ a: { x: 300 }, b: { x: 500 } });
  });

  it("aligns to the selection bounds and never moves locked layers", () => {
    const locked = box("locked", 50, 900, 100, 50, { locked: true });
    const plan = planAlign(
      [a, b, locked],
      canvas,
      align({ relativeTo: "selection", vertical: "bottom" }),
    );

    expect(plan?.updates.map(({ layerId }) => layerId)).toEqual(["a", "b"]);
    expect(positions([a, b], plan)).toMatchObject({ a: { y: 850 }, b: { y: 900 } });
  });

  it("uses the visual bounds of rotated layers", () => {
    const rotated = box("rotated", 400, 400, 200, 100, { rotation: 90 });
    const plan = planAlign([rotated], canvas, align({ horizontal: "left", relativeTo: "page" }));

    // Rotated 90°, the 200×100 box is visually 100 wide and centred on x=500.
    expect(positions([rotated], plan).rotated?.x).toBeCloseTo(-50);
  });

  it("needs a direction, and a page reference for a single layer", () => {
    expect(planAlign([a, b], canvas, align({}))).toBeNull();
    expect(planAlign([a], canvas, align({ horizontal: "left" }))).toBeNull();
  });
});

describe("planSpread", () => {
  const a = box("a", 0, 0, 100, 100);
  const b = box("b", 150, 0, 200, 100);
  const c = box("c", 800, 0, 100, 100);

  it("evens the gaps between layers while the outer layers stay put", () => {
    const plan = planSpread([c, a, b], canvas, spread({}));

    // Span 0..900 holds 400 of layers, leaving two 250 gaps.
    expect(plan?.updates.map(({ layerId }) => layerId)).toEqual(["b"]);
    expect(positions([b], plan).b?.x).toBe(350);
  });

  it("uses a fixed gap from the first layer", () => {
    const plan = planSpread([a, b, c], canvas, spread({ gap: 10, gapMode: "fixed" }));
    expect(positions([a, b, c], plan)).toMatchObject({ a: { x: 0 }, b: { x: 110 }, c: { x: 320 } });
  });

  it("spreads across the page with even space around every layer", () => {
    const plan = planSpread([a, b, c], canvas, spread({ within: "page" }));
    expect(positions([a, b, c], plan)).toMatchObject({
      a: { x: 150 },
      b: { x: 400 },
      c: { x: 750 },
    });
  });

  it("spaces chosen edges evenly", () => {
    const plan = planSpread([a, b, c], canvas, spread({ mode: "centerX" }));
    // Centers go from 50 to 850, so the middle center is 450.
    expect(positions([b], plan).b?.x).toBe(350);

    const vertical = planSpread(
      [box("t1", 0, 20, 50, 50), box("t2", 0, 100, 50, 200), box("t3", 0, 800, 50, 100)],
      canvas,
      spread({ mode: "bottom", within: "page" }),
    );
    // Bottoms run from 50 (first layer flush with the top) to 1000 (last flush with the bottom).
    expect(vertical?.updates.map(({ layerId, update }) => [layerId, update.y])).toEqual([
      ["t1", 0],
      ["t2", 325],
      ["t3", 900],
    ]);
  });

  it("keeps the outer layers put when an inner layer is wider than the span", () => {
    const wide = box("wide", 0, 0, 1000, 100);
    const left = box("left", 200, 0, 100, 100);
    const right = box("right", 800, 0, 100, 100);
    const plan = planSpread([wide, left, right], canvas, spread({}));

    expect(positions([wide, left, right], plan)).toMatchObject({
      left: { x: 200 },
      right: { x: 800 },
    });
  });

  it("needs three unlocked layers to even gaps within the selection", () => {
    expect(planSpread([a, b], canvas, spread({}))).toBeNull();
    expect(planSpread([a, b, { ...c, locked: true }], canvas, spread({}))).toBeNull();
  });
});

describe("planGrid", () => {
  const layers = [
    box("d", 600, 600, 100, 50),
    box("a", 0, 0, 100, 100),
    box("c", 0, 600, 50, 100),
    box("b", 600, 0, 100, 100),
  ];

  it("places layers in reading order in cells sized to the largest layer", () => {
    const plan = planGrid(layers, canvas, grid({ gapX: 20, gapY: 10 }));

    expect(positions(layers, plan)).toMatchObject({
      a: { x: 0, y: 0 },
      b: { x: 120, y: 0 },
      c: { x: 25, y: 110 },
      d: { x: 120, y: 135 },
    });
  });

  it("reads existing rows independently of the destination column count", () => {
    const rowLayers = [
      box("a", 0, 0, 100, 100),
      box("b", 300, 0, 100, 100),
      box("c", 600, 0, 100, 100),
      box("d", 0, 300, 100, 100),
    ];
    const plan = planGrid(rowLayers, canvas, grid({ columns: 2, gapX: 0, gapY: 0 }));

    expect(positions(rowLayers, plan)).toMatchObject({
      a: { x: 0, y: 0 },
      b: { x: 100, y: 0 },
      c: { x: 0, y: 100 },
      d: { x: 100, y: 100 },
    });
  });

  it("can follow selection order, start-align cells and center the grid on the page", () => {
    const plan = planGrid(
      layers,
      canvas,
      grid({
        area: "page",
        cellAlignX: "start",
        cellAlignY: "start",
        columns: 4,
        gapX: 0,
        order: "selection",
      }),
    );

    expect(positions(layers, plan)).toMatchObject({
      d: { x: 300, y: 450 },
      a: { x: 400, y: 450 },
      c: { x: 500, y: 450 },
      b: { x: 600, y: 450 },
    });
  });

  it("resizes layers, including text font size, to fit the area", () => {
    const text = createTextLayer({ id: "text", text: "Hi", x: 0, y: 0, width: 200, height: 100 });
    const photo = box("photo", 0, 0, 100, 100);
    const plan = planGrid(
      [text, photo],
      canvas,
      grid({ area: "page", cellSize: "fit", columns: 2, gapX: 0, gapY: 0, order: "selection" }),
    );
    const textUpdate = plan?.updates.find(({ layerId }) => layerId === "text")?.update;

    // Cells are 500×1000; text scales by 2.5 and the photo by 5.
    expect(textUpdate).toMatchObject({ width: 500, height: 250, x: 0, y: 375 });
    expect((textUpdate as { fontSize?: number }).fontSize).toBe(text.fontSize * 2.5);
    expect(positions([photo], plan).photo).toEqual({ x: 500, y: 250, width: 500, height: 500 });
  });
});
