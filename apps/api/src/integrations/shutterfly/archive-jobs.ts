import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { collectZipEntries, type ZipEntry, zipLength } from "../../zip-stream.js";
import {
  emptyShutterflyArchiveProgress,
  type ShutterflyArchivePart,
  type ShutterflyArchiveProgress,
  type ShutterflyArchiveRunOptions,
  shutterflyArchiveParts,
} from "./archive.js";

export type ShutterflyArchiveStatus = "running" | "completed" | "failed" | "interrupted";

export type ShutterflyArchive = {
  id: string;
  parts: ShutterflyArchivePart[];
  status: ShutterflyArchiveStatus;
  progress: ShutterflyArchiveProgress;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type ShutterflyArchiveDownload = {
  fileName: string;
  entries: ZipEntry[];
  size: number;
};

export class ShutterflyArchiveNotFoundError extends Error {
  constructor() {
    super("Shutterfly archive not found");
    this.name = "ShutterflyArchiveNotFoundError";
  }
}

export class ShutterflyArchiveBusyError extends Error {
  constructor(message = "Another Shutterfly archive is already running for this account") {
    super(message);
    this.name = "ShutterflyArchiveBusyError";
  }
}

type RunArchive = (
  accountId: string,
  options: Omit<ShutterflyArchiveRunOptions, "clock">,
) => Promise<ShutterflyArchiveProgress>;

type RunningArchive = {
  accountId: string;
  archive: ShutterflyArchive;
  controller: AbortController;
  done: Promise<void>;
};

const archiveIdPattern = /^shutterfly_archive_[0-9a-f-]{36}$/;
const persistIntervalMs = 2000;

const accountFolder = (accountId: string) =>
  /^[A-Za-z0-9_-]{1,80}$/.test(accountId)
    ? accountId
    : createHash("sha256").update(accountId).digest("hex");

/**
 * Builds Shutterfly account archives in the background and keeps them on disk so they survive
 * restarts. An archive interrupted by a restart, error, or cancellation can be resumed and will
 * skip everything it already downloaded.
 */
export const createShutterflyArchives = (options: {
  rootDir: string;
  clock: () => Date;
  describeError: (error: unknown) => { code: string; message: string };
  run: RunArchive;
}) => {
  const running = new Map<string, RunningArchive>();

  const archiveDir = (accountId: string, archiveId: string) =>
    join(options.rootDir, accountFolder(accountId), archiveId);

  const now = () => options.clock().toISOString();

  const persist = async (accountId: string, archive: ShutterflyArchive) => {
    const directory = archiveDir(accountId, archive.id);
    const temporaryPath = join(directory, `archive.json.${randomUUID()}.tmp`);

    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(archive, null, 2)}\n`);
    await rename(temporaryPath, join(directory, "archive.json"));
  };

  const load = async (accountId: string, archiveId: string): Promise<ShutterflyArchive | null> => {
    if (!archiveIdPattern.test(archiveId)) {
      return null;
    }

    const active = running.get(archiveId);

    if (active) {
      return structuredClone(active.archive);
    }

    try {
      const stored = JSON.parse(
        await readFile(join(archiveDir(accountId, archiveId), "archive.json"), "utf8"),
      ) as Omit<ShutterflyArchive, "parts"> & { parts?: ShutterflyArchivePart[] };
      const archive: ShutterflyArchive = {
        ...stored,
        parts: stored.parts ?? [...shutterflyArchiveParts],
      };

      // A running archive with no job in this process was cut off by a restart.
      return archive.status === "running" ? { ...archive, status: "interrupted" } : archive;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  };

  const findRunning = (accountId: string) =>
    [...running.values()].find((active) => active.accountId === accountId);

  const launch = (accountId: string, archive: ShutterflyArchive): ShutterflyArchive => {
    const controller = new AbortController();
    const directory = archiveDir(accountId, archive.id);
    let lastPersistedAt = 0;
    let persisting = Promise.resolve();

    const save = (force = false) => {
      const current = options.clock().getTime();

      if (!force && current - lastPersistedAt < persistIntervalMs) {
        return persisting;
      }

      lastPersistedAt = current;

      const snapshot = structuredClone(archive);

      persisting = persisting.then(() => persist(accountId, snapshot)).catch(() => undefined);

      return persisting;
    };

    const done = (async () => {
      try {
        archive.progress = await options.run(accountId, {
          filesDir: join(directory, "files"),
          stateDir: join(directory, "state"),
          parts: archive.parts,
          signal: controller.signal,
          onProgress: (progress) => {
            archive.progress = progress;
            archive.updatedAt = now();
            void save();
          },
        });
        archive.status = "completed";
        archive.error = null;
      } catch (error) {
        archive.status = controller.signal.aborted ? "interrupted" : "failed";
        archive.error = options.describeError(error);
      } finally {
        archive.finishedAt = now();
        archive.updatedAt = archive.finishedAt;
        await save(true);
        running.delete(archive.id);
      }
    })();

    running.set(archive.id, { accountId, archive, controller, done });
    void save(true);

    return structuredClone(archive);
  };

  return {
    list: async (accountId: string): Promise<ShutterflyArchive[]> => {
      let ids: string[];

      try {
        ids = await readdir(join(options.rootDir, accountFolder(accountId)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }

        throw error;
      }

      const archives = await Promise.all(ids.map((id) => load(accountId, id)));

      return archives
        .filter((archive): archive is ShutterflyArchive => archive !== null)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },

    get: load,

    /** Starts a new archive of the given parts, or returns the one already running for this account. */
    start: async (
      accountId: string,
      parts: readonly ShutterflyArchivePart[] = shutterflyArchiveParts,
    ): Promise<ShutterflyArchive> => {
      const active = findRunning(accountId);

      if (active) {
        return structuredClone(active.archive);
      }

      const createdAt = now();

      return launch(accountId, {
        id: `shutterfly_archive_${randomUUID()}`,
        parts: shutterflyArchiveParts.filter((part) => parts.includes(part)),
        status: "running",
        progress: emptyShutterflyArchiveProgress(),
        error: null,
        createdAt,
        updatedAt: createdAt,
        finishedAt: null,
      });
    },

    /** Continues an archive that stopped, skipping photos and projects it already saved. */
    resume: async (accountId: string, archiveId: string): Promise<ShutterflyArchive> => {
      const archive = await load(accountId, archiveId);

      if (!archive) {
        throw new ShutterflyArchiveNotFoundError();
      }

      if (running.has(archiveId)) {
        return archive;
      }

      if (findRunning(accountId)) {
        throw new ShutterflyArchiveBusyError();
      }

      return launch(accountId, {
        ...archive,
        status: "running",
        error: null,
        updatedAt: now(),
        finishedAt: null,
      });
    },

    /** Stops the archive if it is running and deletes everything it downloaded. */
    remove: async (accountId: string, archiveId: string): Promise<void> => {
      const archive = await load(accountId, archiveId);

      if (!archive) {
        throw new ShutterflyArchiveNotFoundError();
      }

      const active = running.get(archiveId);

      if (active) {
        active.controller.abort(new Error("The archive was deleted"));
        await active.done;
      }

      await rm(archiveDir(accountId, archiveId), { force: true, recursive: true });
    },

    /** Lists the files to stream for a finished archive. */
    download: async (accountId: string, archiveId: string): Promise<ShutterflyArchiveDownload> => {
      const archive = await load(accountId, archiveId);

      if (!archive) {
        throw new ShutterflyArchiveNotFoundError();
      }

      if (archive.status === "running") {
        throw new ShutterflyArchiveBusyError(
          "This Shutterfly archive is still running. Download it when it finishes.",
        );
      }

      const prefix = `shutterfly-archive-${archive.createdAt.slice(0, 10)}`;
      let entries: ZipEntry[] = [];

      try {
        entries = await collectZipEntries(
          join(archiveDir(accountId, archiveId), "files"),
          `${prefix}/`,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }

      return { fileName: `${prefix}.zip`, entries, size: zipLength(entries) };
    },
  };
};

export type ShutterflyArchives = ReturnType<typeof createShutterflyArchives>;
