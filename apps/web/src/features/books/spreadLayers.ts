import {
  addLayer,
  deleteLayer,
  fillPhotoLayerUpdate,
  isPhotoPlaceholder,
  type PageDocument,
  type PageLayer,
  reorderLayer,
  updateLayer,
} from "@zakka/editor-core";

import type { PageDetail } from "../../types";

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

export const getSpreadPageContexts = (
  details: Map<string, PageDetail>,
  pageIds: string[],
): SpreadPageContext[] => {
  let offsetX = 0;
  const pages: SpreadPageContext[] = [];

  for (const pageId of pageIds) {
    const page = details.get(pageId);

    if (!page) {
      continue;
    }

    pages.push({ offsetX, page, pageId });
    offsetX += page.document.canvas.width;
  }

  return pages;
};

export const layerOverlapsPageCanvas = (layer: PageLayer, document: PageDocument): boolean =>
  layer.x < document.canvas.width &&
  layer.x + layer.width > 0 &&
  layer.y < document.canvas.height &&
  layer.y + layer.height > 0;

/**
 * Fills a photo placeholder on every spread page that carries a copy of it. Filling only changes
 * the photo content, so existing copies are updated in place rather than re-projected; this keeps
 * copies the importer placed from rotated bounds that geometry-based syncing would prune.
 */
export const fillPhotoPlaceholderAcrossSpread = ({
  assetId,
  details,
  layerId,
  sourcePageId,
  spreadPageIds,
}: {
  assetId: string;
  details: Map<string, PageDetail>;
  layerId: string;
  sourcePageId: string;
  spreadPageIds: string[];
}): SpreadLayerSyncResult => {
  const nextDetails = new Map(details);
  const changedPageIds: string[] = [];
  const pageIds = spreadPageIds.includes(sourcePageId) ? spreadPageIds : [sourcePageId];

  for (const pageId of pageIds) {
    const page = details.get(pageId);
    const layer = page?.document.layers.find((item) => item.id === layerId);

    if (!page || !layer || !isPhotoPlaceholder(layer)) {
      continue;
    }

    nextDetails.set(
      pageId,
      replacePageDocument(
        page,
        updateLayer(page.document, layerId, fillPhotoLayerUpdate(assetId) as Partial<PageLayer>),
      ),
    );
    changedPageIds.push(pageId);
  }

  return {
    changedPageIds,
    containingPageId: changedPageIds.includes(sourcePageId) ? sourcePageId : null,
    details: nextDetails,
  };
};

type SpreadLayerStackPlacement =
  | { kind: "bottom" }
  | { index: number; kind: "index" }
  | { kind: "top" };

const getLayerStackPlacement = (
  document: PageDocument,
  layerId: string,
): SpreadLayerStackPlacement => {
  const layerIndex = document.layers.findIndex((layer) => layer.id === layerId);

  if (layerIndex <= 0) {
    return { kind: "bottom" };
  }

  if (layerIndex >= document.layers.length - 1) {
    return { kind: "top" };
  }

  return { index: layerIndex, kind: "index" };
};

const getLayerStackIndex = (
  document: PageDocument,
  placement: SpreadLayerStackPlacement,
): number => {
  if (placement.kind === "bottom") {
    return 0;
  }

  if (placement.kind === "top") {
    return Math.max(0, document.layers.length - 1);
  }

  return Math.max(0, Math.min(placement.index, document.layers.length - 1));
};

export const syncLayerAcrossSpread = ({
  details,
  removeNonOverlappingSource,
  sourceLayer,
  sourcePageId,
  spreadPageIds,
}: {
  details: Map<string, PageDetail>;
  removeNonOverlappingSource: boolean;
  sourceLayer: PageLayer;
  sourcePageId: string;
  spreadPageIds: string[];
}): SpreadLayerSyncResult => {
  const spreadPages = getSpreadPageContexts(details, spreadPageIds);
  const sourceContext = spreadPages.find((spreadPage) => spreadPage.pageId === sourcePageId);

  if (!sourceContext || spreadPages.length < 2) {
    const sourcePage = details.get(sourcePageId);

    if (!sourcePage) {
      return { changedPageIds: [], containingPageId: null, details };
    }

    return {
      changedPageIds: [sourcePageId],
      containingPageId: sourcePageId,
      details: new Map(details).set(
        sourcePageId,
        replacePageDocument(
          sourcePage,
          updateLayer(sourcePage.document, sourceLayer.id, sourceLayer),
        ),
      ),
    };
  }

  const nextDetails = new Map(details);
  const changedPageIds = new Set<string>();
  const sourceLayerIndex = sourceContext.page.document.layers.findIndex(
    (layer) => layer.id === sourceLayer.id,
  );
  const sourceLayerStackIndex =
    sourceLayerIndex >= 0 ? sourceLayerIndex : sourceContext.page.document.layers.length;
  const sourceLayerStackPlacement = getLayerStackPlacement(
    sourceContext.page.document,
    sourceLayer.id,
  );
  const spreadX = sourceContext.offsetX + sourceLayer.x;
  const spreadCenterX = spreadX + sourceLayer.width / 2;
  const containingPage = spreadPages.find(
    (spreadPage) =>
      spreadCenterX >= spreadPage.offsetX &&
      spreadCenterX < spreadPage.offsetX + spreadPage.page.document.canvas.width,
  );
  const ownerPage =
    containingPage ??
    spreadPages.reduce((closestPage, spreadPage) => {
      const closestDistance = Math.min(
        Math.abs(spreadCenterX - closestPage.offsetX),
        Math.abs(spreadCenterX - (closestPage.offsetX + closestPage.page.document.canvas.width)),
      );
      const spreadPageDistance = Math.min(
        Math.abs(spreadCenterX - spreadPage.offsetX),
        Math.abs(spreadCenterX - (spreadPage.offsetX + spreadPage.page.document.canvas.width)),
      );

      return spreadPageDistance < closestDistance ? spreadPage : closestPage;
    }, sourceContext);
  const projectedLayers = spreadPages.map((spreadPage) => {
    const currentPage = nextDetails.get(spreadPage.pageId) ?? spreadPage.page;
    const localLayer = { ...sourceLayer, x: spreadX - spreadPage.offsetX };

    return {
      currentPage,
      localLayer,
      overlapsPage: layerOverlapsPageCanvas(localLayer, currentPage.document),
      spreadPage,
    };
  });
  const overlapsAnyPage = projectedLayers.some((projectedLayer) => projectedLayer.overlapsPage);

  for (const { currentPage, localLayer, overlapsPage, spreadPage } of projectedLayers) {
    const existingLayer = currentPage.document.layers.find((layer) => layer.id === sourceLayer.id);

    if (existingLayer && existingLayer.kind !== sourceLayer.kind) {
      continue;
    }

    const shouldKeepLayer =
      overlapsPage ||
      (!removeNonOverlappingSource && spreadPage.pageId === sourcePageId) ||
      (!overlapsAnyPage && spreadPage.pageId === ownerPage.pageId);
    let nextDocument = currentPage.document;

    if (shouldKeepLayer) {
      if (existingLayer) {
        nextDocument = updateLayer(currentPage.document, sourceLayer.id, localLayer);
      } else {
        nextDocument = addLayer(
          currentPage.document,
          localLayer,
          Math.max(0, Math.min(sourceLayerStackIndex, currentPage.document.layers.length)),
        );
        nextDocument = reorderLayer(
          nextDocument,
          sourceLayer.id,
          getLayerStackIndex(nextDocument, sourceLayerStackPlacement),
        );
      }
    } else if (existingLayer) {
      nextDocument = deleteLayer(currentPage.document, sourceLayer.id);
    }

    if (nextDocument !== currentPage.document) {
      nextDetails.set(spreadPage.pageId, replacePageDocument(currentPage, nextDocument));
      changedPageIds.add(spreadPage.pageId);
    }
  }

  return {
    changedPageIds: [...changedPageIds],
    containingPageId: ownerPage.pageId,
    details: nextDetails,
  };
};
