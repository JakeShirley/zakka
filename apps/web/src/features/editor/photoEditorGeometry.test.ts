import { createPhotoLayer, type PhotoLayer } from "@zakka/editor-core";
import { describe, expect, test } from "vitest";

import {
  canPhotoCoverFrame,
  clampPhotoTransform,
  getPhotoMinimumScale,
  panPhotoTransform,
  rotatePhotoTransform,
} from "./photoEditorGeometry";

// A 4:3 frame with the photo's full 4:3 image behind it, so scale 1 covers it exactly.
const photo = (photoTransform: Partial<PhotoLayer["photoTransform"]> = {}) => {
  const layer = createPhotoLayer({ assetId: "asset", height: 600, width: 800, x: 0, y: 0 });
  return { ...layer, photoTransform: { ...layer.photoTransform, ...photoTransform } };
};

describe("getPhotoMinimumScale", () => {
  test("grows with rotation so the rotated photo still covers the frame", () => {
    expect(getPhotoMinimumScale(photo())).toBe(1);
    expect(getPhotoMinimumScale(photo(), 90)).toBe(1.334);
    // At 10°, the frame's rotated bounding box is ~1.216x the photo's height.
    expect(getPhotoMinimumScale(photo(), 10)).toBe(1.217);
  });

  test("lets contain-fit photos zoom out to the schema minimum", () => {
    expect(getPhotoMinimumScale({ ...photo(), fit: "contain" }, 30)).toBe(0.1);
  });
});

describe("canPhotoCoverFrame", () => {
  test("rejects rotations that would need more than the maximum zoom", () => {
    const panorama = createPhotoLayer({ assetId: "asset", height: 200, width: 1200, x: 0, y: 0 });
    expect(canPhotoCoverFrame(panorama, 90)).toBe(false);
    expect(canPhotoCoverFrame(panorama, 180)).toBe(true);
    expect(canPhotoCoverFrame({ ...panorama, fit: "contain" }, 90)).toBe(true);
    expect(canPhotoCoverFrame(photo(), 90)).toBe(true);
  });
});

describe("clampPhotoTransform", () => {
  test("keeps a zoomed photo's offsets within the uncovered margin", () => {
    const { photoTransform } = photo();
    // At 2x the 800-wide box spans 1600, leaving 400 of slack on each side: offset ±0.5.
    expect(clampPhotoTransform(photo(), { ...photoTransform, scale: 2, offsetX: 3 })).toMatchObject(
      { offsetX: 0.5, scale: 2 },
    );
    expect(
      clampPhotoTransform(photo(), { ...photoTransform, scale: 1.5, offsetX: -3 }).offsetX,
    ).toBeCloseTo(-1 / 3, 6);
  });

  test("raises the zoom to the rotated cover minimum", () => {
    expect(clampPhotoTransform(photo(), { ...photo().photoTransform, rotation: 90 }).scale).toBe(
      1.334,
    );
  });
});

describe("panPhotoTransform", () => {
  test("moves the photo with the pointer, undoing zoom and flips", () => {
    const zoomed = photo({ scale: 2 });
    const panned = panPhotoTransform(zoomed, zoomed.photoTransform, 100, -50);
    expect(panned.offsetX).toBeCloseTo(0.125, 6);
    expect(panned.offsetY).toBeCloseTo(-1 / 12, 6);

    const flipped = photo({ flipX: true, scale: 2 });
    expect(panPhotoTransform(flipped, flipped.photoTransform, 100, 0).offsetX).toBeCloseTo(
      -0.125,
      6,
    );
  });

  test("maps a horizontal drag onto the rotated photo's own axes", () => {
    const turned = photo({ rotation: 90, scale: 3 });
    const panned = panPhotoTransform(turned, turned.photoTransform, 120, 0);
    expect(panned.offsetX).toBeCloseTo(0, 6);
    // Rotated 90° clockwise, the photo's -y axis points right on screen.
    expect(panned.offsetY).toBeCloseTo(-(2 * 40) / 600, 6);
  });
});

describe("rotatePhotoTransform", () => {
  test("normalizes the angle and keeps the photo covering its frame", () => {
    const rotated = rotatePhotoTransform(photo(), photo({ rotation: 135 }).photoTransform, 270);
    expect(rotated.rotation).toBe(-90);
    expect(rotated.scale).toBe(1.334);
  });
});
