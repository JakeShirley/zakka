import type { ExportFormat, ExportPreset } from "@zakka/api-contract";

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
import type { PageRecord } from "./persistence/schema.js";

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
