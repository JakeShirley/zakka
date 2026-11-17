import { describe, expect, test } from "vitest";

import { getAutoEnhanceAdjustments, measurePhotoTones } from "./photoAutoEnhance";

const greyPixels = (levels: number[]) =>
  new Uint8ClampedArray(levels.flatMap((level) => [level, level, level, 255]));

describe("auto enhance", () => {
  test("brightens, stretches, and saturates a dark, flat, grey photo", () => {
    const stats = measurePhotoTones(
      greyPixels(Array.from({ length: 100 }, (_, index) => 30 + (index % 40))),
    );
    if (!stats) throw new Error("Expected tone stats");

    expect(getAutoEnhanceAdjustments(stats)).toEqual({
      brightness: 1.3,
      contrast: 1.35,
      exposure: 0,
      highlights: 0,
      saturation: 1.3,
      shadows: 0.14,
    });
  });

  test("leaves a well-exposed photo close to neutral", () => {
    expect(
      getAutoEnhanceAdjustments({
        high: 0.97,
        highlight: 0.82,
        low: 0.03,
        meanSaturation: 0.4,
        median: 0.5,
        shadow: 0.2,
      }),
    ).toEqual({
      brightness: 1,
      contrast: 1,
      exposure: 0,
      highlights: 0,
      saturation: 1,
      shadows: 0,
    });
  });

  test("ignores transparent pixels and reports nothing for a fully transparent image", () => {
    expect(measurePhotoTones(new Uint8ClampedArray([255, 255, 255, 0]))).toBeNull();
  });
});
