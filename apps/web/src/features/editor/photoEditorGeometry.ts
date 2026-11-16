import { getPhotoFrameLayout, type PhotoLayer } from "@zakka/editor-core";

export type PhotoTransform = PhotoLayer["photoTransform"];

export const PHOTO_EDITOR_SCALE_MAX = 5;
const PHOTO_SCALE_SCHEMA_MIN = 0.1;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/**
 * Size of the (unscaled) photo box behind the frame aperture and the half-extents the box must
 * reach from the aperture centre so the aperture stays covered after the photo's own rotation.
 * Mirrors the geometry in editor-core's `renderPhotoLayerSvg`.
 */
const getCoverGeometry = (layer: PhotoLayer, rotation: number) => {
  const aperture = getPhotoFrameLayout(layer).image;
  const boxWidth = aperture.width / Math.max(layer.crop.width, 0.05);
  const boxHeight = aperture.height / Math.max(layer.crop.height, 0.05);
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));

  return {
    aperture,
    boxHeight,
    boxWidth,
    halfExtentX: (cos * aperture.width + sin * aperture.height) / 2,
    halfExtentY: (sin * aperture.width + cos * aperture.height) / 2,
  };
};

/**
 * Where the renderer draws the photo's full image box inside a layer (before frame clipping), so
 * the editor can preview the parts of the photo that fall outside the frame.
 */
export const getPhotoImagePlacement = (layer: PhotoLayer) => {
  const aperture = getPhotoFrameLayout(layer).image;
  const width = aperture.width / Math.max(layer.crop.width, 0.05);
  const height = aperture.height / Math.max(layer.crop.height, 0.05);
  const centerX = aperture.x + aperture.width / 2;
  const centerY = aperture.y + aperture.height / 2;
  const { flipX, flipY, offsetX, offsetY, rotation, scale } = layer.photoTransform;

  return {
    aperture,
    height,
    preserveAspectRatio: `xMidYMid ${layer.fit === "cover" ? "slice" : "meet"}`,
    transform: `translate(${centerX} ${centerY}) rotate(${rotation}) scale(${flipX ? -scale : scale} ${flipY ? -scale : scale}) translate(${-centerX} ${-centerY})`,
    width,
    x: aperture.x - layer.crop.x * width + offsetX * width * 0.5,
    y: aperture.y - layer.crop.y * height + offsetY * height * 0.5,
  };
};

/** Smallest zoom at which a cover-fit photo still fills its frame at the given rotation. */
export const getPhotoMinimumScale = (
  layer: PhotoLayer,
  rotation = layer.photoTransform.rotation,
): number => {
  if (layer.fit !== "cover") {
    return PHOTO_SCALE_SCHEMA_MIN;
  }

  const { boxHeight, boxWidth, halfExtentX, halfExtentY } = getCoverGeometry(layer, rotation);
  // Round up to the schema's precision so a saved scale never leaves a sliver uncovered.
  const minimum =
    Math.ceil(Math.max((2 * halfExtentX) / boxWidth, (2 * halfExtentY) / boxHeight) * 1000) / 1000;

  return clamp(minimum, PHOTO_SCALE_SCHEMA_MIN, PHOTO_EDITOR_SCALE_MAX);
};

/**
 * Clamps zoom and pan so a cover-fit photo always fills its frame, including when the photo is
 * rotated inside the frame. Contain-fit photos only respect the schema ranges.
 */
export const clampPhotoTransform = (
  layer: PhotoLayer,
  transform: PhotoTransform,
): PhotoTransform => {
  const minimumScale = getPhotoMinimumScale(layer, transform.rotation);
  const scale = clamp(transform.scale, minimumScale, PHOTO_EDITOR_SCALE_MAX);

  if (layer.fit !== "cover") {
    return {
      ...transform,
      scale,
      offsetX: clamp(transform.offsetX, -1, 1),
      offsetY: clamp(transform.offsetY, -1, 1),
    };
  }

  const { aperture, boxHeight, boxWidth, halfExtentX, halfExtentY } = getCoverGeometry(
    layer,
    transform.rotation,
  );
  const clampOffset = (
    offset: number,
    cropStart: number,
    apertureSize: number,
    boxSize: number,
    halfExtent: number,
  ) => {
    // The box's leading edge must stay before the aperture's rotated extent and its trailing
    // edge after it; both bounds are linear in the offset.
    const max = 2 * cropStart + (apertureSize - (2 * halfExtent) / scale) / boxSize;
    const min = 2 * cropStart - 2 + (apertureSize + (2 * halfExtent) / scale) / boxSize;

    return min > max
      ? clamp((min + max) / 2, -1, 1)
      : clamp(offset, Math.max(min, -1), Math.min(max, 1));
  };

  return {
    ...transform,
    scale,
    offsetX: clampOffset(transform.offsetX, layer.crop.x, aperture.width, boxWidth, halfExtentX),
    offsetY: clampOffset(transform.offsetY, layer.crop.y, aperture.height, boxHeight, halfExtentY),
  };
};

/**
 * Moves the photo inside its frame by a pointer delta measured in the frame's own (unrotated)
 * page units, undoing the photo's rotation, zoom, and flips to find the matching offsets.
 */
export const panPhotoTransform = (
  layer: PhotoLayer,
  start: PhotoTransform,
  deltaX: number,
  deltaY: number,
): PhotoTransform => {
  const { boxHeight, boxWidth } = getCoverGeometry(layer, start.rotation);
  const radians = (-start.rotation * Math.PI) / 180;
  const localX = deltaX * Math.cos(radians) - deltaY * Math.sin(radians);
  const localY = deltaX * Math.sin(radians) + deltaY * Math.cos(radians);
  const boxDeltaX = (localX / start.scale) * (start.flipX ? -1 : 1);
  const boxDeltaY = (localY / start.scale) * (start.flipY ? -1 : 1);

  return clampPhotoTransform(layer, {
    ...start,
    offsetX: start.offsetX + (2 * boxDeltaX) / boxWidth,
    offsetY: start.offsetY + (2 * boxDeltaY) / boxHeight,
  });
};

export const zoomPhotoTransform = (
  layer: PhotoLayer,
  transform: PhotoTransform,
  scale: number,
): PhotoTransform => clampPhotoTransform(layer, { ...transform, scale: roundTo(scale, 0.001) });

/** Normalizes an angle to (-180, 180], rounded to the schema's tenth-of-a-degree precision. */
export const normalizePhotoRotation = (rotation: number) => {
  const normalized = ((((rotation + 180) % 360) + 360) % 360) - 180;
  return roundTo(normalized === -180 ? 180 : normalized, 0.1);
};

/** Applies a rotation, zooming in just enough that a cover-fit photo still fills the frame. */
export const rotatePhotoTransform = (
  layer: PhotoLayer,
  transform: PhotoTransform,
  rotation: number,
): PhotoTransform => {
  const nextRotation = normalizePhotoRotation(rotation);
  return clampPhotoTransform(layer, {
    ...transform,
    rotation: nextRotation,
    scale: Math.max(transform.scale, getPhotoMinimumScale(layer, nextRotation)),
  });
};

export const flipPhotoTransform = (
  layer: PhotoLayer,
  transform: PhotoTransform,
  axis: "x" | "y",
): PhotoTransform =>
  clampPhotoTransform(
    layer,
    axis === "x"
      ? { ...transform, flipX: !transform.flipX }
      : { ...transform, flipY: !transform.flipY },
  );
