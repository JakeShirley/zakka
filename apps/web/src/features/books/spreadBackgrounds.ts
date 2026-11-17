import type { PageBackground, PageDocument } from "@zakka/editor-core";
import {
  adjustBackgrounds as adjustSpreadBackgrounds,
  applySharedBackground as applySpreadBackground,
  getLinkedBackgroundPages as getLinkedSpreadBackgroundPages,
  type SpreadPage,
} from "@zakka/editor-core/spreads";

import type { SpreadPageContext } from "./spreadLayers";

const toSpreadPage = ({ offsetX, page, pageId }: SpreadPageContext): SpreadPage => ({
  document: page.document,
  offsetX,
  pageId,
});

/**
 * Applies a background to each target page so the pages share one frame spanning all of them:
 * the frame is as wide as the pages combined and each page sees its slice of it.
 */
export const applySharedBackground = (
  targets: readonly SpreadPageContext[],
  backgroundId: string,
): Map<string, PageDocument> => applySpreadBackground(targets.map(toSpreadPage), backgroundId);

/**
 * Returns the pages whose background is the same frame as the active page's, so edits such as
 * tile size keep a background that spans a spread continuous across the fold.
 */
export const getLinkedBackgroundPages = (
  contexts: readonly SpreadPageContext[],
  activePageId: string,
): SpreadPageContext[] => {
  const contextBySpreadPage = new Map(
    contexts.map((context) => [toSpreadPage(context), context] as const),
  );

  return getLinkedSpreadBackgroundPages([...contextBySpreadPage.keys()], activePageId).flatMap(
    (spreadPage) => {
      const context = contextBySpreadPage.get(spreadPage);
      return context ? [context] : [];
    },
  );
};

/** Applies new tile scale or rotation to each page's existing background. */
export const adjustBackgrounds = (
  targets: readonly SpreadPageContext[],
  changes: Partial<Pick<PageBackground, "rotation" | "scale">>,
): Map<string, PageDocument> => adjustSpreadBackgrounds(targets.map(toSpreadPage), changes);
