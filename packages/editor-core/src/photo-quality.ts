import {
  capPhotoFrameToPrintResolution,
  classifyPhotoResolution,
  createPhotoLayer,
  getPhotoEffectiveDpi,
  type PageDocument,
  type PhotoLayer,
  type PhotoResolutionQuality,
} from "./index.js";

/** Pixel size and EXIF orientation of a photo's source image, when known. */
export type PhotoDimensions = {
  width: number | null;
  height: number | null;
  orientation: number | null;
};

/** Default frame for a newly added photo, shrunk if needed so it doesn't start out low resolution. */
export const getNewPhotoFrameSize = (
  canvas: PageDocument["canvas"],
  photo: PhotoDimensions & { id: string },
): { width: number; height: number } => {
  const frame = createPhotoLayer({
    assetId: photo.id,
    width: Math.min(canvas.width * 0.5, 1000),
    height: Math.min(canvas.height * 0.34, 760),
  });
  if (!photo.width || !photo.height) return { width: frame.width, height: frame.height };
  return capPhotoFrameToPrintResolution(frame, {
    width: photo.width,
    height: photo.height,
    orientation: photo.orientation,
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
  photo: PhotoDimensions | undefined,
): PhotoResolutionWarning | null => {
  if (!photo?.width || !photo.height) return null;
  const effectiveDpi = getPhotoEffectiveDpi(layer, {
    width: photo.width,
    height: photo.height,
    orientation: photo.orientation,
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

export type BookPrintWarningPhoto<TPhoto> = {
  asset: TPhoto;
  dpi: number;
  layerId: string;
  pageId: string;
  quality: PhotoResolutionWarning["quality"];
};

export type BookPrintWarningGroup<TPhoto> = {
  label: string;
  pageIds: string[];
  photos: BookPrintWarningPhoto<TPhoto>[];
};

/** Collects every low-resolution photo in the book, grouped by the spread it appears on. */
export const getBookPrintWarnings = <TPhoto extends PhotoDimensions>(
  spreads: readonly { pageIds: readonly string[] }[],
  orderedPageIds: readonly string[],
  documents: ReadonlyMap<string, PageDocument>,
  photoById: ReadonlyMap<string, TPhoto>,
): BookPrintWarningGroup<TPhoto>[] =>
  spreads.flatMap((spread) => {
    // A photo crossing the gutter is stored on each facing page under the same layer ID at the
    // same spread position. Duplicated pages also reuse layer IDs, so position tells them apart.
    const seenPlacements = new Set<string>();
    let pageOffsetX = 0;
    const photos = spread.pageIds.flatMap((pageId): BookPrintWarningPhoto<TPhoto>[] => {
      const document = documents.get(pageId);
      if (!document) return [];
      const offsetX = pageOffsetX;
      pageOffsetX += document.canvas.width;

      return document.layers.flatMap((layer): BookPrintWarningPhoto<TPhoto>[] => {
        if (layer.kind !== "photo" || !layer.assetId) return [];
        const placement = `${layer.id}@${Math.round(offsetX + layer.x)},${Math.round(layer.y)}`;
        if (seenPlacements.has(placement)) return [];
        seenPlacements.add(placement);
        const asset = photoById.get(layer.assetId);
        const warning = getPhotoResolutionWarning(layer, asset);

        return asset && warning
          ? [{ asset, dpi: warning.dpi, layerId: layer.id, pageId, quality: warning.quality }]
          : [];
      });
    });
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

export type PhotoToneStats = {
  /** Luminance percentiles and mean on a 0..1 scale. */
  low: number;
  shadow: number;
  median: number;
  highlight: number;
  high: number;
  meanSaturation: number;
};

export type PhotoAdjustmentValues = Pick<
  PhotoLayer["filter"],
  "exposure" | "brightness" | "contrast" | "saturation" | "shadows" | "highlights"
>;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Summarises raw RGBA pixel data into the tone statistics auto enhance works from. */
export const measurePhotoTones = (
  pixels: Uint8ClampedArray | Uint8Array,
): PhotoToneStats | null => {
  const histogram = new Array<number>(256).fill(0);
  let count = 0;
  let saturationTotal = 0;

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if ((pixels[index + 3] ?? 0) < 128) continue;
    const red = pixels[index] ?? 0;
    const green = pixels[index + 1] ?? 0;
    const blue = pixels[index + 2] ?? 0;
    const luminance = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);

    histogram[luminance] = (histogram[luminance] ?? 0) + 1;
    saturationTotal += max === 0 ? 0 : (max - min) / max;
    count += 1;
  }

  if (count === 0) return null;

  const percentile = (fraction: number) => {
    const target = fraction * count;
    let seen = 0;
    for (let level = 0; level < 256; level += 1) {
      seen += histogram[level] ?? 0;
      if (seen >= target) return level / 255;
    }
    return 1;
  };

  return {
    low: percentile(0.02),
    shadow: percentile(0.1),
    median: percentile(0.5),
    highlight: percentile(0.9),
    high: percentile(0.98),
    meanSaturation: saturationTotal / count,
  };
};

/**
 * Picks gentle adjustments that pull exposure toward mid-grey, stretch a flat tonal range, open up
 * crushed shadows, recover bright highlights, and lift dull colour. Well-exposed photos stay close
 * to neutral.
 */
export const getAutoEnhanceAdjustments = (stats: PhotoToneStats): PhotoAdjustmentValues => ({
  exposure: 0,
  brightness: round2(clamp(Math.sqrt(0.5 / Math.max(stats.median, 0.05)), 0.85, 1.3)),
  contrast: round2(clamp(0.9 / Math.max(stats.high - stats.low, 0.1), 1, 1.35)),
  shadows: round2(clamp((0.2 - stats.shadow) * 2, 0, 0.4)),
  highlights: round2(0 - clamp((stats.highlight - 0.85) * 2.5, 0, 0.4)),
  saturation: round2(clamp(1 + (0.35 - stats.meanSaturation), 1, 1.3)),
});
