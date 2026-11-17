import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createShutterflyArchives } from "./archive-jobs.js";

let rootDir: string | null = null;

afterEach(async () => {
  if (rootDir) {
    await rm(rootDir, { force: true, recursive: true });
    rootDir = null;
  }
});

describe("createShutterflyArchives", () => {
  it("deletes a running archive without reporting the cancellation as an error", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "zakka-archive-jobs-"));
    const describeError = vi.fn(() => ({ code: "archive_stopped", message: "failed" }));
    const archives = createShutterflyArchives({
      rootDir,
      clock: () => new Date("2026-05-17T12:00:00.000Z"),
      describeError,
      run: (_accountId, { signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    });

    const archive = await archives.start("account_1");
    await archives.remove("account_1", archive.id);

    expect(describeError).not.toHaveBeenCalled();
    expect(await readdir(join(rootDir, "account_1"))).toEqual([]);
  });
});
