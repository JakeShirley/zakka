import {
  createPageDocument,
  createPhotoLayer,
  createTextLayer,
  type PageDocument,
} from "@zakka/editor-core";
import { describe, expect, it } from "vitest";

import type { PageDetail } from "../../types";
import {
  fillPhotoAcrossSpread,
  reconcileSpreadPageEdit,
  syncLayerAcrossSpread,
} from "./spreadLayers";

const pageDetail = (id: string, document: PageDocument): PageDetail => ({
  id,
  title: id,
  width: document.canvas.width,
  height: document.canvas.height,
  layerCount: document.layers.length,
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
  document,
});

const layerIds = (page: PageDetail): string[] => page.document.layers.map((layer) => layer.id);

describe("spread layer syncing", () => {
  it("keeps existing spread layer copies at their own stack index on each page", () => {
    const sharedLeft = createPhotoLayer({
      assetId: "asset_1",
      id: "shared_photo",
      x: 300,
      y: 100,
      width: 360,
      height: 240,
    });
    const sharedRight = createPhotoLayer({ ...sharedLeft, x: -300 });
    const left = pageDetail(
      "left",
      createPageDocument({
        canvas: { width: 600, height: 400 },
        layers: [
          createTextLayer({ id: "left_background", text: "background" }),
          sharedLeft,
          createTextLayer({ id: "left_foreground", text: "foreground" }),
        ],
      }),
    );
    const right = pageDetail(
      "right",
      createPageDocument({
        canvas: { width: 600, height: 400 },
        layers: [
          sharedRight,
          createTextLayer({ id: "right_background", text: "background" }),
          createTextLayer({ id: "right_foreground", text: "foreground" }),
        ],
      }),
    );

    const result = syncLayerAcrossSpread({
      details: new Map([
        [left.id, left],
        [right.id, right],
      ]),
      removeNonOverlappingSource: false,
      sourceLayer: sharedLeft,
      sourcePageId: left.id,
      spreadPageIds: [left.id, right.id],
    });

    expect(layerIds(result.details.get(left.id) ?? left)).toEqual([
      "left_background",
      "shared_photo",
      "left_foreground",
    ]);
    expect(layerIds(result.details.get(right.id) ?? right)).toEqual([
      "shared_photo",
      "right_background",
      "right_foreground",
    ]);
  });

  it("inserts new spread layer copies at the source stack index", () => {
    const shared = createPhotoLayer({
      assetId: "asset_1",
      id: "shared_photo",
      x: 300,
      y: 100,
      width: 360,
      height: 240,
    });
    const left = pageDetail(
      "left",
      createPageDocument({
        canvas: { width: 600, height: 400 },
        layers: [
          createTextLayer({ id: "left_background", text: "background" }),
          shared,
          createTextLayer({ id: "left_foreground", text: "foreground" }),
        ],
      }),
    );
    const right = pageDetail(
      "right",
      createPageDocument({
        canvas: { width: 600, height: 400 },
        layers: [
          createTextLayer({ id: "right_background", text: "background" }),
          createTextLayer({ id: "right_foreground", text: "foreground" }),
        ],
      }),
    );

    const result = syncLayerAcrossSpread({
      details: new Map([
        [left.id, left],
        [right.id, right],
      ]),
      removeNonOverlappingSource: false,
      sourceLayer: shared,
      sourcePageId: left.id,
      spreadPageIds: [left.id, right.id],
    });

    expect(layerIds(result.details.get(right.id) ?? right)).toEqual([
      "right_background",
      "shared_photo",
      "right_foreground",
    ]);
  });

  it("preserves each page's own stack position when syncing existing spread layer copies", () => {
    const sharedRight = createPhotoLayer({
      assetId: "asset_1",
      id: "shared_photo",
      x: -60,
      y: 100,
      width: 360,
      height: 240,
    });
    const sharedLeft = createPhotoLayer({ ...sharedRight, x: 540 });
    const left = pageDetail(
      "left",
      createPageDocument({
        canvas: { width: 600, height: 400 },
        layers: [
          sharedLeft,
          createTextLayer({ id: "left_one", text: "one" }),
          createTextLayer({ id: "left_two", text: "two" }),
          createTextLayer({ id: "left_three", text: "three" }),
        ],
      }),
    );
    const right = pageDetail(
      "right",
      createPageDocument({
        canvas: { width: 600, height: 400 },
        layers: [createTextLayer({ id: "right_one", text: "one" }), sharedRight],
      }),
    );

    const result = syncLayerAcrossSpread({
      details: new Map([
        [left.id, left],
        [right.id, right],
      ]),
      removeNonOverlappingSource: false,
      sourceLayer: sharedRight,
      sourcePageId: right.id,
      spreadPageIds: [left.id, right.id],
    });

    expect(layerIds(result.details.get(left.id) ?? left)).toEqual([
      "shared_photo",
      "left_one",
      "left_two",
      "left_three",
    ]);
    expect(layerIds(result.details.get(right.id) ?? right)).toEqual(["right_one", "shared_photo"]);
  });

  it("fills a rotated gutter-spanning placeholder on both pages without pruning a copy", () => {
    // Unrotated, this frame ends at x=590 on the 600-wide left page; rotated 45° it crosses the
    // gutter, so the importer keeps a copy on the right page that bounds-based syncing would drop.
    const placeholderLeft = createPhotoLayer({
      assetId: undefined,
      id: "frame",
      rotation: 45,
      x: 300,
      y: 100,
      width: 290,
      height: 200,
    });
    const placeholderRight = createPhotoLayer({ ...placeholderLeft, x: -300 });
    const left = pageDetail(
      "left",
      createPageDocument({ canvas: { width: 600, height: 400 }, layers: [placeholderLeft] }),
    );
    const right = pageDetail(
      "right",
      createPageDocument({ canvas: { width: 600, height: 400 }, layers: [placeholderRight] }),
    );

    const result = fillPhotoAcrossSpread({
      assetId: "asset_1",
      details: new Map([
        [left.id, left],
        [right.id, right],
      ]),
      layerId: "frame",
      sourcePageId: left.id,
      spreadPageIds: [left.id, right.id],
    });

    expect(result.changedPageIds).toEqual([left.id, right.id]);
    expect(result.details.get(left.id)?.document.layers).toEqual([
      expect.objectContaining({ assetId: "asset_1", id: "frame", rotation: 45, x: 300 }),
    ]);
    expect(result.details.get(right.id)?.document.layers).toEqual([
      expect.objectContaining({ assetId: "asset_1", id: "frame", rotation: 45, x: -300 }),
    ]);
  });

  it("replaces a gutter-spanning photo on both pages while keeping its frame styling", () => {
    const photoLeft = createPhotoLayer({
      assetId: "old_asset",
      border: { color: "#112233", framePreset: "none", radius: 12, style: "solid", width: 20 },
      crop: { aspectRatioPreset: "free", height: 0.5, width: 0.5, x: 0.25, y: 0.25 },
      filter: {
        brightness: 1.1,
        contrast: 1,
        highlights: 0,
        preset: "mono",
        saturation: 1,
        shadows: 0,
      },
      id: "photo",
      opacity: 0.8,
      rotation: 12,
      x: 400,
      y: 100,
      width: 400,
      height: 200,
    });
    const photoRight = createPhotoLayer({ ...photoLeft, x: -200 });
    const left = pageDetail(
      "left",
      createPageDocument({ canvas: { width: 600, height: 400 }, layers: [photoLeft] }),
    );
    const right = pageDetail(
      "right",
      createPageDocument({ canvas: { width: 600, height: 400 }, layers: [photoRight] }),
    );

    const result = fillPhotoAcrossSpread({
      assetId: "new_asset",
      details: new Map([
        [left.id, left],
        [right.id, right],
      ]),
      layerId: "photo",
      sourcePageId: right.id,
      spreadPageIds: [left.id, right.id],
    });

    expect(result.changedPageIds).toEqual([left.id, right.id]);
    for (const [pageId, original] of [
      [left.id, photoLeft],
      [right.id, photoRight],
    ] as const) {
      expect(result.details.get(pageId)?.document.layers).toEqual([
        {
          ...original,
          assetId: "new_asset",
          crop: { aspectRatioPreset: "free", height: 1, width: 1, x: 0, y: 0 },
        },
      ]);
    }
  });

  it("moves or drops facing copies of shared layers after a whole-page edit", () => {
    const canvas = { width: 600, height: 400 };
    const moved = createPhotoLayer({ assetId: "a", id: "moved", x: 400, y: 0, width: 210 });
    const removed = createPhotoLayer({ assetId: "b", id: "removed", x: 400, y: 200, width: 210 });
    const untouched = createTextLayer({ id: "untouched", text: "hi", x: 500, width: 200 });
    const left = pageDetail(
      "left",
      createPageDocument({ canvas, layers: [moved, removed, untouched] }),
    );
    const right = pageDetail(
      "right",
      createPageDocument({
        canvas,
        layers: [
          { ...moved, x: -200 },
          { ...removed, x: -200 },
          { ...untouched, x: -100 },
          createTextLayer({ id: "right_only", text: "own" }),
        ],
      }),
    );

    const documents = reconcileSpreadPageEdit({
      details: new Map([
        [left.id, left],
        [right.id, right],
      ]),
      nextDocument: createPageDocument({ canvas, layers: [{ ...moved, x: 20 }, untouched] }),
      sourcePageId: left.id,
      spreadPageIds: [left.id, right.id],
    });

    expect(documents.get(left.id)?.layers.map((layer) => layer.id)).toEqual(["moved", "untouched"]);
    expect(documents.get(right.id)?.layers).toEqual([
      expect.objectContaining({ id: "untouched", x: -100 }),
      expect.objectContaining({ id: "right_only" }),
    ]);
  });
});
