import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "./util.js";

describe("mapWithConcurrency", () => {
  it("lets in-flight work finish and starts no new work before rejecting", async () => {
    const finished: number[] = [];
    let releaseSlow = () => {};
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    const mapped = mapWithConcurrency([1, 2, 3, 4], 2, async (input) => {
      if (input === 1) {
        await slow;
      } else if (input === 2) {
        throw new Error("boom");
      }

      finished.push(input);

      return input;
    });

    let settled = false;
    void mapped
      .catch(() => undefined)
      .finally(() => {
        settled = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    releaseSlow();

    await expect(mapped).rejects.toThrow("boom");
    expect(finished).toEqual([1]);
  });
});
