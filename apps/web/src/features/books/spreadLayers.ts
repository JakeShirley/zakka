import type { PageDocument, PageLayer } from "@zakka/editor-core";
import {
  fillPhotoAcrossSpread as fillPhotoAcrossSpreadDocuments,
  getSpreadPages,
  reconcileSpreadPageEdit as reconcileSpreadPageEditDocuments,
  type SpreadSyncResult,
  syncLayerAcrossSpread as syncLayerAcrossSpreadDocuments,
} from "@zakka/editor-core/spreads";

import type { PageDetail } from "../../types";

export { layerOverlapsPageCanvas } from "@zakka/editor-core/spreads";

export type SpreadPageContext = {
  offsetX: number;
  page: PageDetail;
  pageId: string;
};

export type SpreadLayerSyncResult = {
  changedPageIds: string[];
  containingPageId: string | null;
  details: Map<string, PageDetail>;
};

export const replacePageDocument = (page: PageDetail, document: PageDocument): PageDetail => ({
  ...page,
  document,
  height: document.canvas.height,
  layerCount: document.layers.length,
  width: document.canvas.width,
});

const toDocuments = (details: ReadonlyMap<string, PageDetail>): Map<string, PageDocument> =>
  new Map([...details].map(([pageId, page]) => [pageId, page.document]));

const toDetailsResult = (
  details: Map<string, PageDetail>,
  { changedPageIds, containingPageId, documents }: SpreadSyncResult,
): SpreadLayerSyncResult => {
  const nextDetails = new Map(details);

  for (const pageId of changedPageIds) {
    const page = details.get(pageId);
    const document = documents.get(pageId);

    if (page && document) {
      nextDetails.set(pageId, replacePageDocument(page, document));
    }
  }

  return { changedPageIds, containingPageId, details: nextDetails };
};

export const getSpreadPageContexts = (
  details: Map<string, PageDetail>,
  pageIds: string[],
): SpreadPageContext[] =>
  getSpreadPages(toDocuments(details), pageIds).flatMap(({ offsetX, pageId }) => {
    const page = details.get(pageId);
    return page ? [{ offsetX, page, pageId }] : [];
  });

/**
 * Puts a photo into a photo frame (an empty placeholder or a photo being replaced) on every spread
 * page that carries a copy of it. See `fillPhotoAcrossSpread` in `@zakka/editor-core/spreads`.
 */
export const fillPhotoAcrossSpread = ({
  details,
  ...input
}: {
  assetId: string;
  details: Map<string, PageDetail>;
  layerId: string;
  sourcePageId: string;
  spreadPageIds: string[];
}): SpreadLayerSyncResult =>
  toDetailsResult(
    details,
    fillPhotoAcrossSpreadDocuments({ ...input, documents: toDocuments(details) }),
  );

/**
 * After a whole-page edit on one spread page, updates the facing pages' copies of any shared layer
 * the edit moved or removed. Returns the documents to write, including the edited page.
 */
export const reconcileSpreadPageEdit = ({
  details,
  ...input
}: {
  details: Map<string, PageDetail>;
  nextDocument: PageDocument;
  sourcePageId: string;
  spreadPageIds: string[];
}): Map<string, PageDocument> =>
  reconcileSpreadPageEditDocuments({ ...input, documents: toDocuments(details) });

export const syncLayerAcrossSpread = ({
  details,
  ...input
}: {
  details: Map<string, PageDetail>;
  removeNonOverlappingSource: boolean;
  sourceLayer: PageLayer;
  sourcePageId: string;
  spreadPageIds: string[];
}): SpreadLayerSyncResult =>
  toDetailsResult(
    details,
    syncLayerAcrossSpreadDocuments({ ...input, documents: toDocuments(details) }),
  );
