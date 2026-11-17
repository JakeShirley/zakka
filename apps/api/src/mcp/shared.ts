import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { PageDocument, PageLayer } from "@zakka/editor-core";
import { getSpreadPages, isSpreadLayerCopy } from "@zakka/editor-core/spreads";

import { type AssetStorage, AssetUploadError } from "../assets.js";
import { CustomBackgroundUploadError } from "../custom-backgrounds.js";
import { CustomStickerUploadError } from "../custom-stickers.js";
import { ExportRenderError } from "../exports.js";
import type { MapTileSource } from "../map-tiles.js";
import { OwnershipError, type Repositories } from "../persistence/repositories.js";
import type { AssetRecord, BookRecord, PageRecord } from "../persistence/schema.js";

export type McpToolContext = {
  accountId: string;
  mapTiles?: MapTileSource | undefined;
  repositories: Repositories;
  storage: AssetStorage;
  server: McpServer;
  requirePage: (pageId: string) => PageRecord;
  requireBook: (bookId: string) => BookRecord;
  /** Books that contain the page; a page can belong to more than one book. */
  findBooksForPage: (pageId: string) => BookRecord[];
  savePageDocument: (page: PageRecord, document: PageDocument) => PageRecord;
  /** Validates every document before writing any, so a bad page leaves the others unchanged. */
  savePageDocuments: (documents: ReadonlyMap<string, PageDocument>) => void;
  /** Pages in the spread that shows the page, left to right, or just the page outside a spread. */
  getSpreadPageIds: (pageId: string, bookId?: string) => string[];
  loadPageDocuments: (pageIds: readonly string[]) => Map<string, PageDocument>;
  /** The book's spreads in reading order, honoring its cover spread setting. */
  getBookSpreads: (book: BookRecord) => { pageIds: string[] }[];
  toPageSummary: (page: PageRecord) => {
    id: string;
    title: string;
    width: number;
    height: number;
    layerCount: number;
    updatedAt: string;
  };
  toPhotoSummary: (asset: AssetRecord) => Record<string, unknown> & { id: string };
};

export const jsonResult = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

/**
 * Pages of a spread holding a copy of the layer. A layer crossing the fold is stored on each
 * facing page under the same id at the same spread position; duplicated pages also reuse layer
 * ids, so position tells real copies apart.
 */
export const findSpreadLayerCopyPageIds = (
  documents: ReadonlyMap<string, PageDocument>,
  spreadPageIds: readonly string[],
  sourcePageId: string,
  layer: PageLayer,
): string[] => {
  const pages = getSpreadPages(documents, spreadPageIds);
  const source = pages.find((page) => page.pageId === sourcePageId);

  if (!source) {
    return [];
  }

  return pages
    .filter((page) => {
      if (page.pageId === sourcePageId) return false;
      const copy = page.document.layers.find((candidate) => candidate.id === layer.id);

      return (
        copy !== undefined &&
        isSpreadLayerCopy(
          { layer, offsetX: source.offsetX },
          { layer: copy, offsetX: page.offsetX },
        )
      );
    })
    .map((page) => page.pageId);
};

type ValidationIssue = { message: string; path: PropertyKey[] };

const formatValidationError = (error: unknown): string | null => {
  if (!(error instanceof Error) || error.name !== "ZodError") {
    return null;
  }

  const issues = (error as Error & { issues?: unknown }).issues;

  if (!Array.isArray(issues)) {
    return null;
  }

  return `Invalid input: ${(issues as ValidationIssue[])
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.map(String).join(".")}: ${issue.message}`
        : issue.message,
    )
    .join("; ")}`;
};

/** Runs a tool body, turning validation and ownership failures into readable tool errors. */
export const runTool = async (
  body: () => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> => {
  try {
    return await body();
  } catch (error) {
    const validationMessage = formatValidationError(error);

    if (validationMessage) {
      throw new Error(validationMessage);
    }

    if (
      error instanceof OwnershipError ||
      error instanceof ExportRenderError ||
      error instanceof AssetUploadError ||
      error instanceof CustomStickerUploadError ||
      error instanceof CustomBackgroundUploadError
    ) {
      throw new Error(error.message);
    }

    throw error;
  }
};

const base64Length = (byteSize: number) => Math.ceil(byteSize / 3) * 4;

const formatMegabytes = (byteSize: number) => `${Math.round(byteSize / (1024 * 1024))} MB`;

const mimeTypesByExtension: Record<string, string> = {
  dng: "image/x-adobe-dng",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jp2: "image/jp2",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

const sniffImageMimeType = (buffer: Buffer): string | null => {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  const header = buffer.toString("latin1", 0, 12);

  if (header.startsWith("GIF8")) {
    return "image/gif";
  }

  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") {
    return "image/webp";
  }

  if (header.slice(4, 8) === "ftyp") {
    return "image/heic";
  }

  const text = buffer.toString("utf8", 0, Math.min(buffer.byteLength, 1024)).trimStart();

  return text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))
    ? "image/svg+xml"
    : null;
};

/**
 * Decodes a base64 (or data: URL) upload, enforcing the size limit before decoding. The MIME type
 * comes from the data: URL, an explicit hint, the file extension, or the file's leading bytes.
 */
export const decodeBase64Upload = (input: {
  data: string;
  filename?: string | undefined;
  maxByteSize: number;
  mimeType?: string | undefined;
  tooLargeMessage?: string;
}): File => {
  const dataUrlMimeType = /^data:([^;,]+)[;,]/.exec(input.data)?.[1]?.toLowerCase();
  const base64 = input.data.replace(/^data:[^,]*,/, "").replace(/\s/g, "");

  if (base64.length > base64Length(input.maxByteSize)) {
    throw new Error(
      input.tooLargeMessage ?? `Upload must be ${formatMegabytes(input.maxByteSize)} or smaller`,
    );
  }

  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(base64)) {
    throw new Error("Image data must be base64 encoded");
  }

  const buffer = Buffer.from(base64, "base64");
  const extension = input.filename?.split(".").pop()?.toLowerCase();
  const mimeType =
    input.mimeType?.toLowerCase() ??
    dataUrlMimeType ??
    (extension ? mimeTypesByExtension[extension] : undefined) ??
    sniffImageMimeType(buffer) ??
    "";

  return new File([new Uint8Array(buffer)], input.filename ?? "upload", { type: mimeType });
};

/** Largest base64 payload, in characters, for a file of the given size. */
export const maxBase64LengthFor = base64Length;
