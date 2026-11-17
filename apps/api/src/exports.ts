import type { ExportFormat, ExportPreset } from "@zakka/api-contract";
import type { AssetStorage } from "./assets.js";
import { rasterizeBookPngZip } from "./export-rendering/book-pages.js";
import { rasterizeBookSheet } from "./export-rendering/book-sheet.js";
import { parsePageDocument, renderPageSvg } from "./export-rendering/documents.js";
import { renderSvgPdf } from "./export-rendering/pdf.js";
import { type RasterRenderSettings, rasterizeSvg } from "./export-rendering/raster.js";
import {
  ExportRenderError,
  type ExportStorage,
  type RenderedExport,
} from "./export-rendering/types.js";
import type { MapTileSource } from "./map-tiles.js";
import type { Repositories } from "./persistence/repositories.js";
import type { ExportJobRecord, PageRecord } from "./persistence/schema.js";

export { ExportRenderError, type ExportStorage, type RenderedExport };

type ExportRendererInput = {
  accountId: string;
  dpi?: number;
  format: ExportFormat;
  includeBackground?: boolean;
  mapTiles?: MapTileSource;
  preset: ExportPreset;
  repositories: Repositories;
  storage: ExportStorage;
};

const createRasterRenderSettings = (input: {
  dpi?: number;
  preset: ExportPreset;
}): RasterRenderSettings =>
  input.dpi === undefined ? { preset: input.preset } : { dpi: input.dpi, preset: input.preset };

const renderStoredPageSvg = async (input: ExportRendererInput & { page: PageRecord }) =>
  renderPageSvg({
    accountId: input.accountId,
    document: await parsePageDocument(input.page),
    ...(input.includeBackground === undefined
      ? {}
      : { includeBackground: input.includeBackground }),
    ...createRasterRenderSettings(input),
    ...(input.mapTiles ? { mapTiles: input.mapTiles } : {}),
    preset: input.preset,
    repositories: input.repositories,
    storage: input.storage,
  });

export const renderPageExport = async (
  input: ExportRendererInput & {
    pageId: string;
  },
): Promise<RenderedExport> => {
  const page = input.repositories.pages.findByIdForAccount(input.accountId, input.pageId);

  if (!page) {
    throw new ExportRenderError("export_target_not_found", "Export target was not found", 404);
  }

  const svg = await renderStoredPageSvg({
    accountId: input.accountId,
    ...createRasterRenderSettings(input),
    format: input.format,
    ...(input.includeBackground === undefined
      ? {}
      : { includeBackground: input.includeBackground }),
    ...(input.mapTiles ? { mapTiles: input.mapTiles } : {}),
    page,
    repositories: input.repositories,
    storage: input.storage,
  });

  return input.format === "pdf"
    ? renderSvgPdf([svg], input.preset)
    : rasterizeSvg(svg, input.format, createRasterRenderSettings(input));
};

export const renderBookExport = async (
  input: ExportRendererInput & {
    bookId: string;
  },
): Promise<RenderedExport> => {
  const book = input.repositories.books.findByIdForAccount(input.accountId, input.bookId);

  if (!book) {
    throw new ExportRenderError("export_target_not_found", "Export target was not found", 404);
  }

  const bookPages = input.repositories.books.listPagesForBook(input.accountId, book.id);

  if (bookPages.length === 0) {
    throw new ExportRenderError("empty_book", "Book exports require at least one page");
  }

  const renderedPages = await Promise.all(
    bookPages.map(async ({ page }) => ({
      page,
      svg: await renderStoredPageSvg({
        accountId: input.accountId,
        ...createRasterRenderSettings(input),
        format: input.format,
        ...(input.includeBackground === undefined
          ? {}
          : { includeBackground: input.includeBackground }),
        ...(input.mapTiles ? { mapTiles: input.mapTiles } : {}),
        page,
        repositories: input.repositories,
        storage: input.storage,
      }),
    })),
  );
  if (input.format === "pdf") {
    return renderSvgPdf(
      renderedPages.map(({ svg }) => svg),
      input.preset,
    );
  }

  return input.format === "png"
    ? rasterizeBookPngZip(renderedPages, createRasterRenderSettings(input))
    : rasterizeBookSheet(renderedPages, input.format, createRasterRenderSettings(input));
};

/**
 * Creates an export job, renders it and stores the output. Throws OwnershipError when the target
 * does not belong to the account, and marks the job failed before rethrowing render errors.
 */
export const runExportJob = async (input: {
  accountId: string;
  bookId?: string | undefined;
  dpi?: number | undefined;
  format: ExportFormat;
  includeBackground?: boolean | undefined;
  mapTiles?: MapTileSource | undefined;
  pageId?: string | undefined;
  preset: ExportPreset;
  repositories: Repositories;
  storage: AssetStorage;
}): Promise<{ buffer: Buffer; job: ExportJobRecord }> => {
  const { accountId, repositories } = input;
  const exportJob = repositories.exports.create({
    accountId,
    bookId: input.bookId ?? null,
    format: input.format,
    pageId: input.pageId ?? null,
    preset: input.preset,
  });

  repositories.exports.updateForAccount(accountId, exportJob.id, { status: "running" });

  try {
    const rendererInput = {
      accountId,
      ...(input.dpi === undefined ? {} : { dpi: input.dpi }),
      format: input.format,
      includeBackground: input.includeBackground ?? true,
      ...(input.mapTiles ? { mapTiles: input.mapTiles } : {}),
      preset: input.preset,
      repositories,
      storage: input.storage,
    };
    const rendered = input.pageId
      ? await renderPageExport({ ...rendererInput, pageId: input.pageId })
      : await renderBookExport({ ...rendererInput, bookId: input.bookId ?? "" });
    const stored = await input.storage.write("exports", rendered.buffer, {
      extension: rendered.extension,
    });
    const completedJob = repositories.exports.updateForAccount(accountId, exportJob.id, {
      outputStorageKey: stored.key,
      status: "completed",
    });

    if (!completedJob) {
      throw new ExportRenderError("export_not_found", "Export not found", 404);
    }

    return { buffer: rendered.buffer, job: completedJob };
  } catch (error) {
    repositories.exports.updateForAccount(accountId, exportJob.id, {
      errorMessage: error instanceof Error ? error.message : "Export failed",
      status: "failed",
    });

    throw error;
  }
};

const slugifyDownloadName = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug.slice(0, 80) : "zakka-export";
};

export const getExportContentType = (exportJob: ExportJobRecord): string => {
  if (exportJob.format === "pdf") {
    return "application/pdf";
  }

  if (exportJob.format === "jpeg") {
    return "image/jpeg";
  }

  return exportJob.bookId ? "application/zip" : "image/png";
};

export const getExportDownloadFilename = (
  exportJob: ExportJobRecord,
  repositories: Repositories,
): string => {
  if (exportJob.bookId) {
    const book = repositories.books.findByIdForAccount(exportJob.accountId, exportJob.bookId);
    const name = slugifyDownloadName(book?.title ?? "zakka-book");

    return exportJob.format === "png" ? `${name}-png-pages.zip` : `${name}.${exportJob.format}`;
  }

  const page = exportJob.pageId
    ? repositories.pages.findByIdForAccount(exportJob.accountId, exportJob.pageId)
    : null;
  const name = slugifyDownloadName(page?.title ?? "zakka-page");

  return `${name}.${exportJob.format === "jpeg" ? "jpg" : exportJob.format}`;
};
