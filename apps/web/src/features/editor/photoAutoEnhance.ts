import { measurePhotoTones, type PhotoToneStats } from "@zakka/editor-core/photo-quality";

export {
  getAutoEnhanceAdjustments,
  measurePhotoTones,
  type PhotoAdjustmentValues,
  type PhotoToneStats,
} from "@zakka/editor-core/photo-quality";

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
