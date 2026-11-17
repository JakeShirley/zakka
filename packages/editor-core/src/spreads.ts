import {
  addLayer,
  deleteLayer,
  fillPhotoLayerUpdate,
  type PageBackground,
  type PageDocument,
  type PageLayer,
  reorderLayer,
  setPageBackground,
  updateLayer,
} from "./index.js";

/** A page of a spread, positioned by its x offset from the spread's left edge. */
export type SpreadPage = { offsetX: number; pageId: string; document: PageDocument };

export type SpreadSyncResult = {
  changedPageIds: string[];
  containingPageId: string | null;
  /** The input documents with the changed pages replaced. */
  documents: Map<string, PageDocument>;
};

/** Lays out the spread's pages left to right, skipping any whose document is missing. */
export const getSpreadPages = (
  documents: ReadonlyMap<string, PageDocument>,
  pageIds: readonly string[],
): SpreadPage[] => {
  let offsetX = 0;
  const pages: SpreadPage[] = [];

  for (const pageId of pageIds) {
    const document = documents.get(pageId);

    if (!document) {
      continue;
    }

    pages.push({ document, offsetX, pageId });
    offsetX += document.canvas.width;
  }

  return pages;
};

export const layerOverlapsPageCanvas = (layer: PageLayer, document: PageDocument): boolean =>
  layer.x < document.canvas.width &&
  layer.x + layer.width > 0 &&
  layer.y < document.canvas.height &&
  layer.y + layer.height > 0;

/**
 * Puts a photo into a photo frame (an empty placeholder or a photo being replaced) on every spread
 * page that carries a copy of it. Only the photo content changes, so the frame's position and
 * styling are kept and existing copies are updated in place rather than re-projected; this keeps
 * copies the importer placed from rotated bounds that geometry-based syncing would prune.
 */
export const fillPhotoAcrossSpread = ({
  assetId,
  documents,
  layerId,
  sourcePageId,
  spreadPageIds,
}: {
  assetId: string;
  documents: ReadonlyMap<string, PageDocument>;
  layerId: string;
  sourcePageId: string;
  spreadPageIds: readonly string[];
}): SpreadSyncResult => {
  const nextDocuments = new Map(documents);
  const changedPageIds: string[] = [];
  const pageIds = spreadPageIds.includes(sourcePageId) ? spreadPageIds : [sourcePageId];

  for (const pageId of pageIds) {
    const document = documents.get(pageId);
    const layer = document?.layers.find((item) => item.id === layerId);

    if (!document || layer?.kind !== "photo") {
      continue;
    }

    nextDocuments.set(
      pageId,
      updateLayer(document, layerId, fillPhotoLayerUpdate(assetId) as Partial<PageLayer>),
    );
    changedPageIds.push(pageId);
  }

  return {
    changedPageIds,
    containingPageId: changedPageIds.includes(sourcePageId) ? sourcePageId : null,
    documents: nextDocuments,
  };
};

/**
 * After a whole-page edit (such as applying a page layout) on one spread page, updates the facing
 * pages' copies of any shared layer the edit moved or removed. Moved layers keep a facing copy
 * only while they still overlap that page; unchanged shared layers are left alone. Returns the
 * documents to write, including the edited page.
 */
export const reconcileSpreadPageEdit = ({
  documents,
  nextDocument,
  sourcePageId,
  spreadPageIds,
}: {
  documents: ReadonlyMap<string, PageDocument>;
  nextDocument: PageDocument;
  sourcePageId: string;
  spreadPageIds: readonly string[];
}): Map<string, PageDocument> => {
  const changedDocuments = new Map<string, PageDocument>([[sourcePageId, nextDocument]]);
  const spreadPages = getSpreadPages(documents, spreadPageIds);
  const sourcePage = spreadPages.find((spreadPage) => spreadPage.pageId === sourcePageId);

  if (!sourcePage) {
    return changedDocuments;
  }

  const previousLayers = new Map(sourcePage.document.layers.map((layer) => [layer.id, layer]));
  const nextLayers = new Map(nextDocument.layers.map((layer) => [layer.id, layer]));

  for (const spreadPage of spreadPages) {
    if (spreadPage.pageId === sourcePageId) {
      continue;
    }

    let facingDocument = spreadPage.document;

    for (const facingLayer of spreadPage.document.layers) {
      const previousLayer = previousLayers.get(facingLayer.id);

      if (!previousLayer || previousLayer.kind !== facingLayer.kind) {
        continue;
      }

      const nextLayer = nextLayers.get(facingLayer.id);

      if (nextLayer && JSON.stringify(nextLayer) === JSON.stringify(previousLayer)) {
        continue;
      }

      const localLayer = nextLayer
        ? { ...nextLayer, x: sourcePage.offsetX + nextLayer.x - spreadPage.offsetX }
        : null;

      facingDocument =
        localLayer && layerOverlapsPageCanvas(localLayer, facingDocument)
          ? updateLayer(facingDocument, facingLayer.id, localLayer)
          : deleteLayer(facingDocument, facingLayer.id);
    }

    if (facingDocument !== spreadPage.document) {
      changedDocuments.set(spreadPage.pageId, facingDocument);
    }
  }

  return changedDocuments;
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

/**
 * Writes an edited layer back to its spread: every page the layer overlaps gets a copy shifted
 * into that page's coordinates, and copies on pages it no longer overlaps are removed.
 */
export const syncLayerAcrossSpread = ({
  documents,
  removeNonOverlappingSource,
  sourceLayer,
  sourcePageId,
  spreadPageIds,
}: {
  documents: ReadonlyMap<string, PageDocument>;
  removeNonOverlappingSource: boolean;
  sourceLayer: PageLayer;
  sourcePageId: string;
  spreadPageIds: readonly string[];
}): SpreadSyncResult => {
  const spreadPages = getSpreadPages(documents, spreadPageIds);
  const sourcePage = spreadPages.find((spreadPage) => spreadPage.pageId === sourcePageId);

  if (!sourcePage || spreadPages.length < 2) {
    const sourceDocument = documents.get(sourcePageId);

    if (!sourceDocument) {
      return { changedPageIds: [], containingPageId: null, documents: new Map(documents) };
    }

    return {
      changedPageIds: [sourcePageId],
      containingPageId: sourcePageId,
      documents: new Map(documents).set(
        sourcePageId,
        updateLayer(sourceDocument, sourceLayer.id, sourceLayer),
      ),
    };
  }

  const nextDocuments = new Map(documents);
  const changedPageIds = new Set<string>();
  const sourceLayerIndex = sourcePage.document.layers.findIndex(
    (layer) => layer.id === sourceLayer.id,
  );
  const sourceLayerStackIndex =
    sourceLayerIndex >= 0 ? sourceLayerIndex : sourcePage.document.layers.length;
  const sourceLayerStackPlacement = getLayerStackPlacement(sourcePage.document, sourceLayer.id);
  const spreadX = sourcePage.offsetX + sourceLayer.x;
  const spreadCenterX = spreadX + sourceLayer.width / 2;
  const containingPage = spreadPages.find(
    (spreadPage) =>
      spreadCenterX >= spreadPage.offsetX &&
      spreadCenterX < spreadPage.offsetX + spreadPage.document.canvas.width,
  );
  const ownerPage =
    containingPage ??
    spreadPages.reduce((closestPage, spreadPage) => {
      const closestDistance = Math.min(
        Math.abs(spreadCenterX - closestPage.offsetX),
        Math.abs(spreadCenterX - (closestPage.offsetX + closestPage.document.canvas.width)),
      );
      const spreadPageDistance = Math.min(
        Math.abs(spreadCenterX - spreadPage.offsetX),
        Math.abs(spreadCenterX - (spreadPage.offsetX + spreadPage.document.canvas.width)),
      );

      return spreadPageDistance < closestDistance ? spreadPage : closestPage;
    }, sourcePage);
  const projectedLayers = spreadPages.map((spreadPage) => {
    const currentDocument = nextDocuments.get(spreadPage.pageId) ?? spreadPage.document;
    const localLayer = { ...sourceLayer, x: spreadX - spreadPage.offsetX };

    return {
      currentDocument,
      localLayer,
      overlapsPage: layerOverlapsPageCanvas(localLayer, currentDocument),
      spreadPage,
    };
  });
  const overlapsAnyPage = projectedLayers.some((projectedLayer) => projectedLayer.overlapsPage);

  for (const { currentDocument, localLayer, overlapsPage, spreadPage } of projectedLayers) {
    const existingLayer = currentDocument.layers.find((layer) => layer.id === sourceLayer.id);

    if (existingLayer && existingLayer.kind !== sourceLayer.kind) {
      continue;
    }

    const shouldKeepLayer =
      overlapsPage ||
      (!removeNonOverlappingSource && spreadPage.pageId === sourcePageId) ||
      (!overlapsAnyPage && spreadPage.pageId === ownerPage.pageId);
    let nextDocument = currentDocument;

    if (shouldKeepLayer) {
      if (existingLayer) {
        nextDocument = updateLayer(currentDocument, sourceLayer.id, localLayer);
      } else {
        nextDocument = addLayer(
          currentDocument,
          localLayer,
          Math.max(0, Math.min(sourceLayerStackIndex, currentDocument.layers.length)),
        );
        nextDocument = reorderLayer(
          nextDocument,
          sourceLayer.id,
          getLayerStackIndex(nextDocument, sourceLayerStackPlacement),
        );
      }
    } else if (existingLayer) {
      nextDocument = deleteLayer(currentDocument, sourceLayer.id);
    }

    if (nextDocument !== currentDocument) {
      nextDocuments.set(spreadPage.pageId, nextDocument);
      changedPageIds.add(spreadPage.pageId);
    }
  }

  return {
    changedPageIds: [...changedPageIds],
    containingPageId: ownerPage.pageId,
    documents: nextDocuments,
  };
};

/**
 * Applies a background to each target page so the pages share one frame spanning all of them:
 * the frame is as wide as the pages combined and each page sees its slice of it.
 */
export const applySharedBackground = (
  targets: readonly SpreadPage[],
  backgroundId: string,
): Map<string, PageDocument> => {
  const firstOffset = targets[0]?.offsetX ?? 0;
  const width = targets.reduce((total, target) => total + target.document.canvas.width, 0);
  const height = Math.max(0, ...targets.map((target) => target.document.canvas.height));

  return new Map(
    targets.map((target) => [
      target.pageId,
      setPageBackground(target.document, {
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
  pages: readonly SpreadPage[],
  activePageId: string,
): SpreadPage[] => {
  const active = pages.find((page) => page.pageId === activePageId);
  const activeBackground = active?.document.canvas.background;

  if (!active || !activeBackground) {
    return [];
  }

  return pages.filter((page) => {
    const background = page.document.canvas.background;

    return (
      background !== undefined &&
      sharesFrame(background, page.offsetX, activeBackground, active.offsetX)
    );
  });
};

/** Applies new tile scale or rotation to each page's existing background. */
export const adjustBackgrounds = (
  targets: readonly SpreadPage[],
  changes: Partial<Pick<PageBackground, "rotation" | "scale">>,
): Map<string, PageDocument> =>
  new Map(
    targets.flatMap((target): [string, PageDocument][] => {
      const background = target.document.canvas.background;

      return background
        ? [[target.pageId, setPageBackground(target.document, { ...background, ...changes })]]
        : [];
    }),
  );
