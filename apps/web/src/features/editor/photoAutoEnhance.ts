import type { PhotoLayer } from "@zakka/editor-core";

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

/** Summarises RGBA pixel data into the tone statistics auto enhance works from. */
export const measurePhotoTones = (pixels: Uint8ClampedArray): PhotoToneStats | null => {
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

/** Loads an image and measures its tones from a small downsampled copy. */
export const analyzePhotoTones = (href: string): Promise<PhotoToneStats | null> =>
  new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const size = 96;
        const ratio = Math.min(
          1,
          size / Math.max(image.naturalWidth || size, image.naturalHeight || size),
        );
        const width = Math.max(1, Math.round((image.naturalWidth || size) * ratio));
        const height = Math.max(1, Math.round((image.naturalHeight || size) * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          resolve(null);
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        resolve(measurePhotoTones(context.getImageData(0, 0, width, height).data));
      } catch {
        // A cross-origin image without CORS headers taints the canvas.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = href;
  });
