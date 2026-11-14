import type { ShutterflyImportProgress } from "./service.js";

export type ShutterflyImportJobStatus = "running" | "completed" | "failed";

export type ShutterflyImportJob<Result> = {
  id: string;
  accountId: string;
  projectId: string;
  status: ShutterflyImportJobStatus;
  progress: ShutterflyImportProgress;
  result: Result | null;
  error: { code: string; message: string } | null;
  finishedAt: number | null;
};

const defaultRetentionMs = 15 * 60 * 1000;

/**
 * Tracks Shutterfly imports that run in the background so clients can poll their progress.
 * Jobs live in memory only; finished jobs are forgotten after the retention period.
 */
export const createShutterflyImportJobs = <Result>(options: {
  clock: () => Date;
  describeError: (error: unknown) => { code: string; message: string };
  retentionMs?: number;
}) => {
  const retentionMs = options.retentionMs ?? defaultRetentionMs;
  const jobs = new Map<string, ShutterflyImportJob<Result>>();

  const prune = () => {
    const now = options.clock().getTime();

    for (const [id, job] of jobs) {
      if (job.finishedAt !== null && now - job.finishedAt > retentionMs) {
        jobs.delete(id);
      }
    }
  };

  return {
    /** Starts `run` in the background, or returns the running job for the same project. */
    start: (
      accountId: string,
      projectId: string,
      run: (onProgress: (progress: ShutterflyImportProgress) => void) => Promise<Result>,
    ): ShutterflyImportJob<Result> => {
      prune();

      const running = [...jobs.values()].find(
        (job) =>
          job.accountId === accountId && job.projectId === projectId && job.status === "running",
      );

      if (running) {
        return running;
      }

      const job: ShutterflyImportJob<Result> = {
        id: `shutterfly_import_${crypto.randomUUID()}`,
        accountId,
        projectId,
        status: "running",
        progress: { step: "preparing", completed: 0, total: 0, fraction: 0 },
        result: null,
        error: null,
        finishedAt: null,
      };

      jobs.set(job.id, job);

      void (async () => {
        try {
          job.result = await run((progress) => {
            job.progress = progress;
          });
          job.status = "completed";
        } catch (error) {
          job.error = options.describeError(error);
          job.status = "failed";
        } finally {
          job.finishedAt = options.clock().getTime();
          // Expire the job even if nobody polls or starts another import afterwards.
          setTimeout(() => {
            jobs.delete(job.id);
          }, retentionMs).unref();
        }
      })();

      return job;
    },

    get: (accountId: string, importId: string): ShutterflyImportJob<Result> | null => {
      prune();

      const job = jobs.get(importId);

      return job?.accountId === accountId ? job : null;
    },
  };
};
