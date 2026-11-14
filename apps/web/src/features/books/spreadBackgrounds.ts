import { type PageBackground, type PageDocument, setPageBackground } from "@zakka/editor-core";

import type { SpreadPageContext } from "./spreadLayers";

/**
 * Applies a background to each target page so the pages share one frame spanning all of them:
 * the frame is as wide as the pages combined and each page sees its slice of it.
 */
export const applySharedBackground = (
  targets: readonly SpreadPageContext[],
  backgroundId: string,
): Map<string, PageDocument> => {
  const firstOffset = targets[0]?.offsetX ?? 0;
  const width = targets.reduce((total, target) => total + target.page.document.canvas.width, 0);
  const height = Math.max(0, ...targets.map((target) => target.page.document.canvas.height));

  return new Map(
    targets.map((target) => [
      target.pageId,
      setPageBackground(target.page.document, {
        backgroundId,
        x: firstOffset - target.offsetX,
        y: 0,
        width,
        height,
        scale: 1,
      }),
    ]),
  );
};

const sharesFrame = (
  a: PageBackground,
  aOffsetX: number,
  b: PageBackground,
  bOffsetX: number,
): boolean =>
  a.backgroundId === b.backgroundId &&
  a.width === b.width &&
  a.height === b.height &&
  a.y === b.y &&
  Math.abs(aOffsetX + a.x - (bOffsetX + b.x)) < 1;

/**
 * Returns the pages whose background is the same frame as the active page's, so edits such as
 * tile size keep a background that spans a spread continuous across the fold.
 */
export const getLinkedBackgroundPages = (
  contexts: readonly SpreadPageContext[],
  activePageId: string,
): SpreadPageContext[] => {
  const active = contexts.find((context) => context.pageId === activePageId);
  const activeBackground = active?.page.document.canvas.background;

  if (!active || !activeBackground) {
    return [];
  }

  return contexts.filter((context) => {
    const background = context.page.document.canvas.background;

    return (
      background !== undefined &&
      sharesFrame(background, context.offsetX, activeBackground, active.offsetX)
    );
  });
};

/** Applies new tile scale or rotation to each page's existing background. */
export const adjustBackgrounds = (
  targets: readonly SpreadPageContext[],
  changes: Partial<Pick<PageBackground, "rotation" | "scale">>,
): Map<string, PageDocument> =>
  new Map(
    targets.flatMap((target): [string, PageDocument][] => {
      const background = target.page.document.canvas.background;

      return background
        ? [[target.pageId, setPageBackground(target.page.document, { ...background, ...changes })]]
        : [];
    }),
  );
