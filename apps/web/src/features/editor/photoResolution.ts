import {
  capPhotoFrameToPrintResolution,
  classifyPhotoResolution,
  createPhotoLayer,
  getPhotoEffectiveDpi,
  type PageDocument,
  type PhotoLayer,
  type PhotoResolutionQuality,
} from "@zakka/editor-core";

import type { Asset, PageDetail } from "../../types";

/** Default frame for a newly added photo, shrunk if needed so it doesn't start out low resolution. */
export const getNewPhotoFrameSize = (canvas: PageDocument["canvas"], asset: Asset) => {
  const frame = createPhotoLayer({
    assetId: asset.id,
    width: Math.min(canvas.width * 0.5, 1000),
    height: Math.min(canvas.height * 0.34, 760),
  });
  if (!asset.width || !asset.height) return { width: frame.width, height: frame.height };
  return capPhotoFrameToPrintResolution(frame, {
    width: asset.width,
    height: asset.height,
    orientation: asset.orientation,
  });
};

export type PhotoResolutionWarning = {
  dpi: number;
  quality: Exclude<PhotoResolutionQuality, "good">;
  message: string;
};

/** Returns a print-quality warning when the placed photo has too few pixels for its printed size. */
export const getPhotoResolutionWarning = (
  layer: PhotoLayer,
  asset: Asset | undefined,
): PhotoResolutionWarning | null => {
  if (!asset?.width || !asset.height) return null;
  const effectiveDpi = getPhotoEffectiveDpi(layer, {
    width: asset.width,
    height: asset.height,
    orientation: asset.orientation,
  });
  if (effectiveDpi === null) return null;
  const quality = classifyPhotoResolution(effectiveDpi);
  if (quality === "good") return null;
  const dpi = Math.round(effectiveDpi);

  return {
    dpi,
    quality,
    message:
      quality === "veryLow"
        ? "Very low resolution. This photo will likely print blurry; make it smaller or zoom out."
        : "Low resolution. This photo may print soft; make it smaller or zoom out.",
  };
};

export type BookPrintWarningPhoto = {
  asset: Asset;
  dpi: number;
  layerId: string;
  pageId: string;
  quality: PhotoResolutionWarning["quality"];
};

export type BookPrintWarningGroup = {
  label: string;
  pageIds: string[];
  photos: BookPrintWarningPhoto[];
};

/** Collects every low-resolution photo in the book, grouped by the spread it appears on. */
export const getBookPrintWarnings = (
  spreads: readonly { pageIds: readonly string[] }[],
  orderedPageIds: readonly string[],
  pageDetails: ReadonlyMap<string, PageDetail>,
  assetById: ReadonlyMap<string, Asset>,
): BookPrintWarningGroup[] =>
  spreads.flatMap((spread) => {
    // A photo crossing the gutter is stored on each facing page under the same layer ID.
    const seenLayerIds = new Set<string>();
    const photos = spread.pageIds.flatMap((pageId) =>
      (pageDetails.get(pageId)?.document.layers ?? []).flatMap((layer) => {
        if (layer.kind !== "photo" || !layer.assetId || seenLayerIds.has(layer.id)) return [];
        seenLayerIds.add(layer.id);
        const asset = assetById.get(layer.assetId);
        const warning = getPhotoResolutionWarning(layer, asset);

        return asset && warning
          ? [{ asset, dpi: warning.dpi, layerId: layer.id, pageId, quality: warning.quality }]
          : [];
      }),
    );
    if (photos.length === 0) return [];
    const pageNumbers = spread.pageIds
      .map((pageId) => orderedPageIds.indexOf(pageId) + 1)
      .filter((pageNumber) => pageNumber > 0);
    const label =
      pageNumbers.length > 1
        ? `Pages ${pageNumbers[0]}–${pageNumbers[pageNumbers.length - 1]}`
        : `Page ${pageNumbers[0] ?? ""}`.trim();

    return [{ label, pageIds: [...spread.pageIds], photos }];
  });
