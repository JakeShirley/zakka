import { createPageDocument, type PageDocument, setPageBackground } from "@zakka/editor-core";
import { describe, expect, it } from "vitest";

import type { PageDetail } from "../../types";
import {
  adjustBackgrounds,
  applySharedBackground,
  getLinkedBackgroundPages,
} from "./spreadBackgrounds";
import type { SpreadPageContext } from "./spreadLayers";

const context = (pageId: string, offsetX: number, document: PageDocument): SpreadPageContext => {
  const page: PageDetail = {
    id: pageId,
    title: pageId,
    width: document.canvas.width,
    height: document.canvas.height,
    layerCount: document.layers.length,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    document,
  };

  return { offsetX, page, pageId };
};

const blankPage = (width = 600, height = 400) => createPageDocument({ canvas: { width, height } });

const withDocuments = (
  contexts: SpreadPageContext[],
  documents: Map<string, PageDocument>,
): SpreadPageContext[] =>
  contexts.map((entry) => {
    const document = documents.get(entry.pageId) ?? entry.page.document;
    return { ...entry, page: { ...entry.page, document } };
  });

describe("spread backgrounds", () => {
  it("spans one background frame across every page of a spread", () => {
    const documents = applySharedBackground(
      [context("left", 0, blankPage(600, 400)), context("right", 600, blankPage(600, 420))],
      "zakka:hearts",
    );

    expect(documents.get("left")?.canvas.background).toEqual({
      backgroundId: "zakka:hearts",
      x: 0,
      y: 0,
      width: 1200,
      height: 420,
      scale: 1,
      rotation: 0,
    });
    expect(documents.get("right")?.canvas.background).toMatchObject({ x: -600, width: 1200 });
  });

  it("fits the frame to a single page", () => {
    const documents = applySharedBackground([context("right", 600, blankPage())], "zakka:hearts");

    expect(documents.get("right")?.canvas.background).toMatchObject({
      x: 0,
      width: 600,
      height: 400,
    });
  });

  it("links only pages showing the same background frame", () => {
    const spread = [context("left", 0, blankPage()), context("right", 600, blankPage())];
    const shared = withDocuments(spread, applySharedBackground(spread, "zakka:hearts"));

    expect(getLinkedBackgroundPages(shared, "right").map((entry) => entry.pageId)).toEqual([
      "left",
      "right",
    ]);

    const split = withDocuments(shared, applySharedBackground(shared.slice(1), "zakka:hearts"));

    expect(getLinkedBackgroundPages(split, "right").map((entry) => entry.pageId)).toEqual([
      "right",
    ]);
    expect(getLinkedBackgroundPages(spread, "left")).toEqual([]);
  });

  it("adjusts linked backgrounds and skips pages without one", () => {
    const left = context("left", 0, blankPage());
    const right = context(
      "right",
      600,
      setPageBackground(blankPage(), {
        backgroundId: "zakka:stars",
        x: 0,
        y: 0,
        width: 600,
        height: 400,
        scale: 1,
      }),
    );

    const documents = adjustBackgrounds([left, right], { scale: 2.5 });

    expect([...documents.keys()]).toEqual(["right"]);
    expect(documents.get("right")?.canvas.background?.scale).toBe(2.5);
    expect(
      adjustBackgrounds([right], { rotation: -45 }).get("right")?.canvas.background,
    ).toMatchObject({ rotation: -45, scale: 1 });
  });
});
