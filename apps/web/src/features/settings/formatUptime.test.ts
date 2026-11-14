import { describe, expect, it } from "vitest";

import { formatUptime } from "./formatUptime";

describe("formatUptime", () => {
  it("shows only seconds for short uptimes", () => {
    expect(formatUptime(0)).toBe("0s");
    expect(formatUptime(42.9)).toBe("42s");
  });

  it("keeps zero-valued inner units once a larger unit is present", () => {
    expect(formatUptime(3_600)).toBe("1h 0m 0s");
    expect(formatUptime(86_400 + 5)).toBe("1d 0h 0m 5s");
    expect(formatUptime(270_245)).toBe("3d 3h 4m 5s");
  });

  it("clamps negative values", () => {
    expect(formatUptime(-10)).toBe("0s");
  });
});
