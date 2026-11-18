import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

import {
  isAllowedShutterflyDownloadUrl,
  type ShutterflyAlbumContents,
  type ShutterflyAlbumSummary,
  type ShutterflyClient,
  type ShutterflyMediaDetails,
  type ShutterflyRawProject,
  type ShutterflySession,
} from "./client.js";
import { collectShutterflyProjectReferences } from "./map-project.js";
import {
  createShutterflyDesignUrlResolver,
  inlineShutterflySvgResources,
  listShutterflyProjectPages,
} from "./page-render.js";
import { type ShutterflyDesignAsset, shutterflyProjectSchema } from "./schemas.js";
import { mapWithConcurrency, safeFileName } from "./util.js";

export type ShutterflyArchiveStep =
  | "starting"
  | "orders"
  | "projects"
  | "albums"
  | "photos"
  | "finishing";

export type ShutterflyArchiveSection = "orders" | "projects" | "albums" | "photos";

export const shutterflyArchiveParts = [
  "photos",
  "albums",
  "books",
  "calendars",
  "cards",
  "prints",
  "otherProjects",
  "orders",
] as const;

export type ShutterflyArchivePart = (typeof shutterflyArchiveParts)[number];

type ShutterflyProjectKind = Extract<
  ShutterflyArchivePart,
  "books" | "calendars" | "cards" | "prints" | "otherProjects"
>;

export type ShutterflyArchiveCount = { completed: number; failed: number; total: number };

export type ShutterflyArchiveProgress = {
  step: ShutterflyArchiveStep;
  photos: ShutterflyArchiveCount;
  projects: ShutterflyArchiveCount;
  albums: ShutterflyArchiveCount;
  orders: number;
  bytes: number;
  errorCount: number;
};

export type ShutterflyArchiveItemError = {
  section: ShutterflyArchiveSection;
  item: string | null;
  message: string;
};

export type ShutterflyArchiveDependencies = {
  client: ShutterflyClient;
  withSession: <Output>(action: (session: ShutterflySession) => Promise<Output>) => Promise<Output>;
  /** Errors that make every later request fail too, such as a revoked sign-in. */
  isFatal: (error: unknown) => boolean;
};

export type ShutterflyArchiveRunOptions = {
  /** Directory whose contents become the downloadable archive. */
  filesDir: string;
  /** Private bookkeeping that lets an interrupted archive resume where it stopped. */
  stateDir: string;
  /** What to archive. */
  parts: readonly ShutterflyArchivePart[];
  signal: AbortSignal;
  clock: () => Date;
  onProgress: (progress: ShutterflyArchiveProgress) => void;
};

type CompletedPhoto = { momentId: string; file: string; bytes: number };
/** `pages` is missing for projects archived before page renders existed, which renders them on update. */
type CompletedProject = { id: string; folder: string; bytes: number; pages?: boolean };

const photoConcurrency = 4;
const projectConcurrency = 2;
const projectDownloadConcurrency = 4;
const pageRenderConcurrency = 2;
const albumConcurrency = 4;

const contentTypeExtensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/webp": ".webp",
  "image/tiff": ".tif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "image/svg+xml": ".svg",
};

export const emptyShutterflyArchiveProgress = (): ShutterflyArchiveProgress => ({
  step: "starting",
  photos: { completed: 0, failed: 0, total: 0 },
  projects: { completed: 0, failed: 0, total: 0 },
  albums: { completed: 0, failed: 0, total: 0 },
  orders: 0,
  bytes: 0,
  errorCount: 0,
});

const readJsonLines = async <Entry>(path: string): Promise<Entry[]> => {
  let text: string;

  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const entries: Entry[] = [];
  let damaged = false;

  for (const line of text.split("\n")) {
    try {
      if (line.trim()) {
        entries.push(JSON.parse(line) as Entry);
      }
    } catch {
      // A crash can leave a partial last line; that item is simply archived again.
      damaged = true;
    }
  }

  if (damaged || (text.length > 0 && !text.endsWith("\n"))) {
    // Rewrite the journal so the next appended entry starts on a clean line.
    const temporaryPath = `${path}.${process.pid}.tmp`;

    await writeFile(temporaryPath, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
    await rename(temporaryPath, path);
  }

  return entries;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const readString = (value: unknown, key: string): string | null => {
  const field = (value as Record<string, unknown> | null)?.[key];

  return typeof field === "string" && field.trim() ? field.trim() : null;
};

const projectCategoryLabel = (project: ShutterflyRawProject): string | null => {
  const projectType = project.projectType as Record<string, unknown> | undefined;

  return readString(project, "productCategory") ?? readString(projectType, "group");
};

const projectCategory = (project: ShutterflyRawProject): string =>
  safeFileName(projectCategoryLabel(project), "Other");

/** Sorts a project into one of the archive's project parts by its Shutterfly category. */
export const shutterflyProjectKind = (project: ShutterflyRawProject): ShutterflyProjectKind => {
  const category = projectCategoryLabel(project)?.toLowerCase() ?? "";

  if (/\bbooks?\b|photo ?books?/.test(category)) {
    return "books";
  }

  if (category.includes("calendar")) {
    return "calendars";
  }

  if (/card|stationery|invitation|announcement/.test(category)) {
    return "cards";
  }

  if (category.includes("print")) {
    return "prints";
  }

  return "otherProjects";
};

const urlExtension = (url: string, fallback: string): string => {
  try {
    const extension = extname(new URL(url).pathname).toLowerCase();

    return /^\.[a-z0-9]{2,5}$/.test(extension) ? extension : fallback;
  } catch {
    return fallback;
  }
};

/** Picks a unique, case-insensitively distinct file name within one folder. */
const createNameReserver = (taken: Iterable<string> = []) => {
  const used = new Set([...taken].map((name) => name.toLowerCase()));

  return (preferred: string, uniqueSuffix: string): string => {
    const extension = extname(preferred);
    const stem = preferred.slice(0, preferred.length - extension.length) || "file";
    let candidate = preferred;
    let attempt = 1;

    while (used.has(candidate.toLowerCase())) {
      candidate = `${stem} (${uniqueSuffix}${attempt > 1 ? `-${attempt}` : ""})${extension}`;
      attempt += 1;
    }

    used.add(candidate.toLowerCase());

    return candidate;
  };
};

const partLabels: Record<ShutterflyArchivePart, string> = {
  photos: "photo library",
  albums: "albums",
  books: "photo books",
  calendars: "calendars",
  cards: "cards and stationery",
  prints: "prints",
  otherProjects: "other projects",
  orders: "order history",
};

const readme = (
  archivedAt: string,
  parts: ReadonlySet<ShutterflyArchivePart>,
) => `Shutterfly account archive
Created by Zakka on ${archivedAt}
Includes: ${shutterflyArchiveParts
  .filter((part) => parts.has(part))
  .map((part) => partLabels[part])
  .join(", ")}

account.json            Shutterfly account details and totals for this archive.
photos/                 Original photos and videos from your Shutterfly photo library and albums.
photos/index.json       Maps each Shutterfly moment id to its file in photos/.
albums/albums.json      Every album, including albums shared with you.
albums/<album>/album.json
                        The album's details and the files in photos/ that belong to it.
projects/projects.json  Every archived saved and purchased project (books, cards, calendars, ...).
projects/<type>/<project>/
  project.json          The complete project exactly as Shutterfly stores it.
  thumbnail.*           Shutterfly's preview of the project, when available.
  pages/                A full-size render of every page as a self-contained SVG, with its
                        photos, artwork, and fonts built in. Open one in any web browser.
  pages.json            Maps each page render to its surface in project.json.
  photos/               The photos placed in the project, as Shutterfly renders them.
  photos.json           Maps each photo in project.json to its file.
  design-assets.json    Catalog details for the project's stickers, backgrounds, and fonts.
  design-assets/        Sticker and background artwork. Fonts are licensed and not included.
orders/orders.json      Order history.
orders/legacy-orders.json
                        Orders from Shutterfly's previous order system.
errors.json             Anything that could not be archived. Resume the archive in Zakka to retry.

Folders for parts that were not included are left out.
`;

/**
 * Archives the chosen parts of a Shutterfly account into `filesDir`. Completed photos and projects
 * are recorded in `stateDir`, so running again on the same directories resumes instead of starting
 * over.
 */
export const runShutterflyArchive = async (
  dependencies: ShutterflyArchiveDependencies,
  options: ShutterflyArchiveRunOptions,
): Promise<ShutterflyArchiveProgress> => {
  const { client, withSession } = dependencies;
  const { filesDir, stateDir, signal } = options;
  const parts = new Set(options.parts);
  const projectKinds = new Set<ShutterflyArchivePart>(
    options.parts.filter((part) => part !== "photos" && part !== "albums" && part !== "orders"),
  );
  const includePhotos = parts.has("photos") || parts.has("albums");
  const progress = emptyShutterflyArchiveProgress();
  const errors: ShutterflyArchiveItemError[] = [];
  const tempDir = join(stateDir, "tmp");
  const completedPhotosPath = join(stateDir, "photos.jsonl");
  const completedProjectsPath = join(stateDir, "projects.jsonl");

  const report = () => options.onProgress(structuredClone(progress));

  const throwIfFatal = (error: unknown) => {
    if (
      signal.aborted ||
      dependencies.isFatal(error) ||
      (error as NodeJS.ErrnoException).code === "ENOSPC"
    ) {
      throw signal.aborted ? signal.reason : error;
    }
  };

  const recordError = (section: ShutterflyArchiveSection, item: string | null, error: unknown) => {
    throwIfFatal(error);
    errors.push({ section, item, message: errorMessage(error) });
    progress.errorCount = errors.length;
  };

  /** Writes a file into the archive. `tally` also collects the bytes for one item, such as a project. */
  const writeArchiveFile = async (
    relativePath: string,
    data: string | Buffer,
    tally?: { bytes: number },
  ) => {
    const path = join(filesDir, relativePath);
    const bytes = Buffer.byteLength(data);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    progress.bytes += bytes;

    if (tally) {
      tally.bytes += bytes;
    }

    return bytes;
  };

  const writeArchiveJson = (relativePath: string, value: unknown, tally?: { bytes: number }) =>
    writeArchiveFile(relativePath, `${JSON.stringify(value, null, 2)}\n`, tally);

  const setStep = (step: ShutterflyArchiveStep) => {
    signal.throwIfAborted();
    progress.step = step;
    report();
  };

  await mkdir(filesDir, { recursive: true });
  await rm(tempDir, { force: true, recursive: true });
  await mkdir(tempDir, { recursive: true });
  report();

  const readJsonFile = <Value>(path: string) =>
    readFile(path, "utf8")
      .then((text) => JSON.parse(text) as Value)
      .catch(() => null);

  /** Replaces a state file atomically so an interruption can't leave it truncated. */
  const writeStateJson = async (path: string, value: unknown) => {
    const temporaryPath = `${path}.${process.pid}.tmp`;

    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`);
    await rename(temporaryPath, path);
  };

  const session = await withSession(async (current) => current);
  const ownerPath = join(stateDir, "shutterfly-account.json");
  type Owner = { shutterflyAccountId?: unknown };
  const previousOwner =
    (await readJsonFile<Owner>(ownerPath)) ??
    (await readJsonFile<Owner>(join(filesDir, "account.json")));

  if (previousOwner && previousOwner.shutterflyAccountId !== session.accountId) {
    throw new Error(
      "This archive belongs to a different Shutterfly account. Reconnect that account to update it, or start a new archive.",
    );
  }

  await writeStateJson(ownerPath, { shutterflyAccountId: session.accountId });

  // Orders -----------------------------------------------------------------------------------------
  const orderLists = parts.has("orders")
    ? ([
        ["orders/orders.json", client.listOrders],
        ["orders/legacy-orders.json", client.listLegacyOrders],
      ] as const)
    : [];

  if (orderLists.length > 0) {
    setStep("orders");
  }

  for (const [file, list] of orderLists) {
    try {
      const orders = await withSession((current) => list(current));

      await writeArchiveJson(file, orders);
      progress.orders += orders.length;
      report();
    } catch (error) {
      recordError("orders", file, error);
    }
  }

  // Projects ---------------------------------------------------------------------------------------
  if (projectKinds.size > 0) {
    setStep("projects");
  }

  const completedProjects = new Map(
    (await readJsonLines<CompletedProject>(completedProjectsPath)).map((entry) => [
      entry.id,
      entry,
    ]),
  );
  let projects: ShutterflyRawProject[] = [];

  if (projectKinds.size > 0) {
    try {
      projects = (await withSession((current) => client.listAllProjects(current))).filter(
        (project) => projectKinds.has(shutterflyProjectKind(project)),
      );
      await writeArchiveJson("projects/projects.json", projects);
    } catch (error) {
      recordError("projects", null, error);
    }
  }

  progress.projects.total = projects.length;

  const reserveProjectFolder = createNameReserver(
    [...completedProjects.values()].map((entry) => entry.folder),
  );
  const projectFolders = new Map<string, string>();

  for (const project of projects) {
    const done = completedProjects.get(project._id);

    if (done) {
      projectFolders.set(project._id, done.folder);
      progress.bytes += done.bytes;

      if (done.pages) {
        progress.projects.completed += 1;
      }
    } else {
      const name = safeFileName(readString(project, "projectName"), "Untitled project");

      projectFolders.set(
        project._id,
        `projects/${projectCategory(project)}/${reserveProjectFolder(`${name} (${project._id})`, project._id)}`,
      );
    }
  }

  report();

  /** Renders every page of a project into `<folder>/pages/`, replacing any earlier attempt. */
  const archiveProjectPages = async (
    project: ShutterflyRawProject,
    folder: string,
    raw: unknown,
    designAssets: unknown,
    fail: (what: string, error: unknown) => void,
    tally: { bytes: number },
  ) => {
    const pages = listShutterflyProjectPages(raw);
    const resolveUrl = createShutterflyDesignUrlResolver(designAssets);

    await rm(join(filesDir, folder, "pages"), { force: true, recursive: true });
    await rm(join(filesDir, folder, "pages.json"), { force: true });

    if (pages.length === 0) {
      return;
    }

    const skuId = readString(raw, "commerceSku") ?? readString(project, "commerceSku");
    const rendered = await mapWithConcurrency(pages, pageRenderConcurrency, async (page) => {
      signal.throwIfAborted();

      try {
        const svg = await withSession((current) =>
          client.renderSurfaceSvg(
            current,
            { surface: page.surface, height: page.height, skuId },
            signal,
          ),
        );
        const inlined = await inlineShutterflySvgResources(
          svg,
          (url) => client.download(url),
          signal,
          resolveUrl,
        );

        for (const failure of inlined.failures) {
          fail(`${page.file} resource ${failure.url}`, failure.error);
        }

        await writeArchiveFile(`${folder}/${page.file}`, inlined.svg, tally);

        return { file: page.file, category: page.category, surfaceNumber: page.surfaceNumber };
      } catch (error) {
        fail(page.file, error);

        return { file: null, category: page.category, surfaceNumber: page.surfaceNumber };
      }
    });

    await writeArchiveJson(`${folder}/pages.json`, rendered, tally);
  };

  const finishProject = async (entry: CompletedProject, failed: boolean) => {
    if (failed) {
      progress.projects.failed += 1;
    } else {
      progress.projects.completed += 1;
      await appendFile(completedProjectsPath, `${JSON.stringify(entry)}\n`);
    }

    report();
  };

  /** Adds page renders to a project archived before they existed, keeping its other files. */
  const addProjectPages = async (project: ShutterflyRawProject, done: CompletedProject) => {
    const tally = { bytes: 0 };
    let failed = false;

    const fail = (what: string, error: unknown) => {
      failed = true;
      recordError("projects", `${project._id} ${what}`, error);
    };

    try {
      const raw: unknown = JSON.parse(
        await readFile(join(filesDir, done.folder, "project.json"), "utf8"),
      );
      const designAssets: unknown = await readFile(
        join(filesDir, done.folder, "design-assets.json"),
        "utf8",
      ).then(
        (text) => JSON.parse(text),
        () => null,
      );

      await archiveProjectPages(project, done.folder, raw, designAssets, fail, tally);
    } catch (error) {
      fail("pages", error);
    }

    await finishProject({ ...done, bytes: done.bytes + tally.bytes, pages: true }, failed);
  };

  const archiveProject = async (project: ShutterflyRawProject) => {
    const folder = projectFolders.get(project._id) as string;
    const tally = { bytes: 0 };
    let failed = false;

    const fail = (what: string, error: unknown) => {
      failed = true;
      recordError("projects", `${project._id} ${what}`, error);
    };

    await rm(join(filesDir, folder), { force: true, recursive: true });

    let raw: unknown;

    try {
      raw = await withSession((current) => client.getRawProject(current, project._id));
      await writeArchiveJson(`${folder}/project.json`, raw, tally);
    } catch (error) {
      fail("project", error);
      progress.projects.failed += 1;
      report();

      return;
    }

    const thumbnailUrl = readString(project, "thumbnailUrl") ?? readString(project, "iconUrl");

    if (thumbnailUrl && isAllowedShutterflyDownloadUrl(thumbnailUrl)) {
      try {
        await writeArchiveFile(
          `${folder}/thumbnail${urlExtension(thumbnailUrl, ".jpg")}`,
          await client.download(thumbnailUrl),
          tally,
        );
      } catch (error) {
        fail("thumbnail", error);
      }
    }

    const parsed = shutterflyProjectSchema.safeParse(raw);
    let designAssets: ShutterflyDesignAsset[] = [];

    if (parsed.success) {
      const references = collectShutterflyProjectReferences(parsed.data);

      if (references.photos.length > 0) {
        try {
          const details = await withSession((current) =>
            client.getMediaDetails(current, references.photos),
          );
          const reservePhotoName = createNameReserver();
          const photoFiles = await mapWithConcurrency(
            references.photos,
            projectDownloadConcurrency,
            async (photo) => {
              signal.throwIfAborted();

              const media: ShutterflyMediaDetails | undefined = details.get(photo.mediaId);

              if (!media) {
                fail(`photo ${photo.mediaId}`, new Error("Shutterfly did not return this photo"));

                return { ...photo, file: null };
              }

              try {
                const data = await client.download(media.url);
                const preferred = safeFileName(media.fileName, photo.mediaId);
                const file = `photos/${reservePhotoName(
                  extname(preferred) ? preferred : `${preferred}.jpg`,
                  photo.mediaId,
                )}`;

                await writeArchiveFile(`${folder}/${file}`, data, tally);

                return {
                  ...photo,
                  file,
                  fileName: media.fileName,
                  width: media.width,
                  height: media.height,
                };
              } catch (error) {
                fail(`photo ${photo.mediaId}`, error);

                return { ...photo, file: null };
              }
            },
          );

          await writeArchiveJson(`${folder}/photos.json`, photoFiles, tally);
        } catch (error) {
          fail("photos", error);
        }
      }

      const designAssetIds = [
        ...references.stickerAssetIds,
        ...references.backgroundAssetIds,
        ...references.fontAssetIds,
      ];

      if (designAssetIds.length > 0) {
        try {
          const assets = await withSession((current) =>
            client.getDesignAssets(current, designAssetIds),
          );
          const artwork = [...references.stickerAssetIds, ...references.backgroundAssetIds]
            .map((id) => assets.get(id))
            .filter((asset): asset is ShutterflyDesignAsset => asset !== undefined);
          const reserveAssetName = createNameReserver();

          designAssets = [...assets.values()];
          await writeArchiveJson(`${folder}/design-assets.json`, designAssets, tally);
          await mapWithConcurrency(artwork, projectDownloadConcurrency, async (asset) => {
            signal.throwIfAborted();

            const printFile = asset.files?.PRINT_RES;
            const printUrl = printFile?.location ? client.designFileUrl(printFile.location) : null;
            const url = printUrl ?? asset.preview ?? null;

            if (!url || !isAllowedShutterflyDownloadUrl(url)) {
              return;
            }

            const extension =
              printUrl && printFile?.fileType
                ? `.${printFile.fileType.toLowerCase().replace(/[^a-z0-9]/g, "")}`
                : urlExtension(url, ".png");

            try {
              await writeArchiveFile(
                `${folder}/design-assets/${reserveAssetName(
                  `${safeFileName(asset.name, asset.id)} (${safeFileName(asset.id, "asset")})${extension}`,
                  asset.id,
                )}`,
                await client.download(url),
                tally,
              );
            } catch (error) {
              fail(`design asset ${asset.id}`, error);
            }
          });
        } catch (error) {
          fail("design assets", error);
        }
      }
    }

    await archiveProjectPages(project, folder, raw, designAssets, fail, tally);

    await finishProject({ id: project._id, folder, bytes: tally.bytes, pages: true }, failed);
  };

  await mapWithConcurrency(
    projects.filter((project) => completedProjects.get(project._id)?.pages !== true),
    projectConcurrency,
    async (project) => {
      signal.throwIfAborted();

      try {
        const done = completedProjects.get(project._id);

        await (done ? addProjectPages(project, done) : archiveProject(project));
      } catch (error) {
        recordError("projects", project._id, error);
        progress.projects.failed += 1;
        report();
      }
    },
  );

  // Albums -----------------------------------------------------------------------------------------
  let albums: ShutterflyAlbumSummary[] = [];
  let albumsListed = false;
  const albumContents = new Map<string, ShutterflyAlbumContents>();

  if (parts.has("albums")) {
    setStep("albums");

    try {
      albums = await withSession((current) => client.listAlbums(current));
      albumsListed = true;
    } catch (error) {
      recordError("albums", null, error);
    }
  }

  progress.albums.total = albums.length;
  report();

  await mapWithConcurrency(albums, albumConcurrency, async (album) => {
    signal.throwIfAborted();

    try {
      albumContents.set(
        album.id,
        await withSession((current) => client.getAlbum(current, album.id)),
      );
      progress.albums.completed += 1;
    } catch (error) {
      recordError("albums", album.id, error);
      progress.albums.failed += 1;
    }

    report();
  });

  // Photos -----------------------------------------------------------------------------------------
  if (includePhotos) {
    setStep("photos");
  }

  const completedPhotos = new Map(
    (await readJsonLines<CompletedPhoto>(completedPhotosPath)).map((entry) => [
      entry.momentId,
      entry,
    ]),
  );
  const momentIds = new Set<string>();

  if (parts.has("photos")) {
    try {
      for (const id of await withSession((current) => client.listLibraryMomentIds(current))) {
        momentIds.add(id);
      }
    } catch (error) {
      recordError("photos", null, error);
    }
  }

  for (const contents of albumContents.values()) {
    for (const id of contents.momentIds) {
      momentIds.add(id);
    }
  }

  for (const entry of completedPhotos.values()) {
    if (momentIds.has(entry.momentId)) {
      progress.photos.completed += 1;
      progress.bytes += entry.bytes;
    }
  }

  progress.photos.total = momentIds.size;
  report();

  const reservePhotoName = createNameReserver(
    [...completedPhotos.values()].map((entry) => entry.file.replace(/^photos\//, "")),
  );

  if (includePhotos) {
    await mkdir(join(filesDir, "photos"), { recursive: true });
  }

  await mapWithConcurrency(
    [...momentIds].filter((id) => !completedPhotos.has(id)),
    photoConcurrency,
    async (momentId) => {
      signal.throwIfAborted();

      const tempPath = join(tempDir, `${safeFileName(momentId, "moment")}.part`);

      try {
        const download = await withSession((current) =>
          client.downloadOriginal(current, momentId, tempPath, signal),
        );
        const contentType = download.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
        const fallbackExtension = contentTypeExtensions[contentType] ?? "";
        const preferred = safeFileName(download.fileName, `${momentId}${fallbackExtension}`);
        const file = `photos/${reservePhotoName(preferred, momentId)}`;
        const bytes = (await stat(tempPath)).size;

        await rename(tempPath, join(filesDir, file));
        progress.bytes += bytes;

        const entry: CompletedPhoto = { momentId, file, bytes };

        completedPhotos.set(momentId, entry);
        await appendFile(completedPhotosPath, `${JSON.stringify(entry)}\n`);
        progress.photos.completed += 1;
      } catch (error) {
        await rm(tempPath, { force: true });
        recordError("photos", momentId, error);
        progress.photos.failed += 1;
      }

      report();
    },
  );

  // Finishing --------------------------------------------------------------------------------------
  setStep("finishing");

  const photoFile = (momentId: string) => completedPhotos.get(momentId)?.file ?? null;

  if (includePhotos) {
    // Keep photos Shutterfly no longer lists: their originals are still in the archive.
    await writeArchiveJson(
      "photos/index.json",
      [...completedPhotos.values()].sort((left, right) => left.file.localeCompare(right.file)),
    );
  }

  // Album folders stay assigned to their album, even after it is removed from Shutterfly, so a
  // later album with the same name can't overwrite a saved one.
  const albumFoldersPath = join(stateDir, "album-folders.json");
  const albumFolders = new Map<string, string>(
    Object.entries((await readJsonFile<Record<string, string>>(albumFoldersPath)) ?? {}),
  );

  if (albumFolders.size === 0) {
    const previousIndex = await readJsonFile<{ id?: unknown; folder?: unknown }[]>(
      join(filesDir, "albums", "albums.json"),
    );

    for (const entry of Array.isArray(previousIndex) ? previousIndex : []) {
      if (typeof entry.id === "string" && typeof entry.folder === "string") {
        albumFolders.set(entry.id, entry.folder);
      }
    }
  }

  const reserveAlbumFolder = createNameReserver(
    [...albumFolders.values()].map((folder) => folder.replace(/^albums\//, "")),
  );
  const albumIndex = [];

  for (const album of albums) {
    const contents = albumContents.get(album.id);
    const folder =
      albumFolders.get(album.id) ??
      `albums/${reserveAlbumFolder(safeFileName(album.name, album.id), album.id)}`;

    if (contents) {
      albumFolders.set(album.id, folder);
      await writeArchiveJson(`${folder}/album.json`, {
        id: album.id,
        name: contents.name ?? album.name,
        owned: album.owned,
        details: contents.raw,
        photos: contents.momentIds.map((momentId) => ({ momentId, file: photoFile(momentId) })),
      });
    }

    albumIndex.push({
      id: album.id,
      name: album.name,
      owned: album.owned,
      photoCount: contents?.momentIds.length ?? null,
      folder: contents ? folder : null,
      details: album.raw,
    });
  }

  if (albumsListed) {
    await writeArchiveJson("albums/albums.json", albumIndex);
    await writeStateJson(albumFoldersPath, Object.fromEntries(albumFolders));
  }

  const archivedAt = options.clock().toISOString();

  await writeArchiveJson("errors.json", errors);
  await writeArchiveJson("account.json", {
    shutterflyAccountId: session.accountId,
    photoLibraryId: session.libraryId,
    email: session.email,
    archivedAt,
    parts: shutterflyArchiveParts.filter((part) => parts.has(part)),
    photos: progress.photos,
    projects: progress.projects,
    albums: progress.albums,
    orders: progress.orders,
  });
  await writeArchiveFile("README.txt", readme(archivedAt, parts));
  await rm(tempDir, { force: true, recursive: true });
  report();

  return structuredClone(progress);
};
