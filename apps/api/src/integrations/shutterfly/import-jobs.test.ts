import { afterEach, describe, expect, it, vi } from "vitest";

import { createShutterflyImportJobs } from "./import-jobs.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createShutterflyImportJobs", () => {
  it("expires finished jobs after the retention period without further requests", async () => {
    vi.useFakeTimers();
    const fixedNow = new Date("2026-05-17T12:00:00.000Z");
    const jobs = createShutterflyImportJobs<string>({
      clock: () => fixedNow,
      describeError: () => ({ code: "internal_error", message: "failed" }),
      retentionMs: 1000,
    });

    const job = jobs.start("account_1", "project_1", async () => "done");
    await vi.advanceTimersByTimeAsync(0);

    expect(jobs.get("account_1", job.id)?.status).toBe("completed");

    await vi.advanceTimersByTimeAsync(1000);

    expect(jobs.get("account_1", job.id)).toBeNull();
  });
});
