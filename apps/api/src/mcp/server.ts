import { z } from "@hono/zod-openapi";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { defaultBookPageSize } from "@zakka/api-contract";
import {
  addLayer,
  builtInBackgrounds,
  createMapLayer,
  createPageDocument,
  createPhotoLayer,
  createStickerLayer,
  createTextLayer,
  createWashiTapeLayer,
  deleteLayer,
  editorFontDefinitions,
  type PageDocument,
  type PageLayer,
  pageDocumentSchema,
  pageLayerSchema,
  reorderLayer,
  setPageBackground,
  toCustomBackgroundId,
  updateCanvas,
} from "@zakka/editor-core";
import { searchStickers } from "@zakka/editor-core/stickers";
import sharp from "sharp";

import { type AssetStorage, AssetUploadError, createAssetFromUpload } from "../assets.js";
import { ExportRenderError, renderPageExport } from "../exports.js";
import {
  createBookWithCovers,
  parseStoredPageDocument,
  validatePageDocumentAssets,
} from "../library.js";
import type { MapTileSource } from "../map-tiles.js";
import { OwnershipError, type Repositories } from "../persistence/repositories.js";
import type { AssetRecord, BookRecord, PageRecord } from "../persistence/schema.js";

export type ZakkaMcpServerOptions = {
  accountId: string;
  mapTiles?: MapTileSource;
  repositories: Repositories;
  storage: AssetStorage;
  version: string;
};

const layerKinds = ["photo", "text", "sticker", "washiTape", "map"] as const;
type LayerKind = (typeof layerKinds)[number];

const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .describe("Hex color such as #fffdf7.");

const instructions = `Zakka is a scrapbooking app. Users keep a photo library, organize photos into albums, and design scrapbook pages that can be grouped into books.

Page model:
- Coordinates and sizes are page pixels at 300 dpi with the origin at the top-left. The default page is 2400x3000 (8x10 inches).
- A page document has a canvas (width, height, backgroundColor, optional background) and an ordered list of layers. Layers are drawn bottom to top, so the last layer is on top.
- Layer kinds: photo (a photo from the library, or an empty photo frame without assetId), text (supports **bold** and *italic* markdown), sticker, washiTape and map.
- In a book, the first page is the front cover and the last page is the back cover.

Workflow tips:
- Use list_photos and view_photo to choose photos, upload_image to add a new image to the library, add_photos_to_book to collect photos for a book, search_stickers and list_fonts for decoration, and list_backgrounds for page backgrounds.
- Prefer add_layer, update_layer and delete_layer for targeted edits. Use get_page to read the full document.
- After editing, call render_page to check the result visually.
- If the page is open in the browser editor, the editor may overwrite your edits when it autosaves. Ask the user to reload the page after you make changes.`;

const jsonResult = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Merges changes into a layer, merging nested settings (border, shadow, etc.) one level deep. */
const mergeLayerChanges = (
  layer: PageLayer,
  changes: Record<string, unknown>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...layer };

  for (const [key, value] of Object.entries(changes)) {
    const existing = merged[key];
    merged[key] =
      isPlainObject(existing) && isPlainObject(value) ? { ...existing, ...value } : value;
  }

  return { ...merged, id: layer.id, kind: layer.kind };
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

  return `Invalid page content: ${(issues as ValidationIssue[])
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.map(String).join(".")}: ${issue.message}`
        : issue.message,
    )
    .join("; ")}`;
};

/** Runs a tool body, turning validation and ownership failures into readable tool errors. */
const runTool = async (
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
      error instanceof AssetUploadError
    ) {
      throw new Error(error.message);
    }

    throw error;
  }
};

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

export const createZakkaMcpServer = (options: ZakkaMcpServerOptions): McpServer => {
  const { accountId, repositories, storage } = options;
  const server = new McpServer(
    { name: "zakka", title: "Zakka", version: options.version },
    { instructions },
  );

  const requirePage = (pageId: string): PageRecord => {
    const page = repositories.pages.findByIdForAccount(accountId, pageId);

    if (!page) {
      throw new Error(`Page ${pageId} was not found`);
    }

    return page;
  };

  const requireBook = (bookId: string): BookRecord => {
    const book = repositories.books.findByIdForAccount(accountId, bookId);

    if (!book) {
      throw new Error(`Book ${bookId} was not found`);
    }

    return book;
  };

  const savePageDocument = (page: PageRecord, document: PageDocument): PageRecord => {
    const parsed = pageDocumentSchema.parse(document);

    if (!validatePageDocumentAssets(accountId, parsed, repositories)) {
      throw new Error(
        "Photo layers and backgrounds must reference photos and backgrounds in this library",
      );
    }

    const updated = repositories.pages.updateForAccount(accountId, page.id, {
      documentJson: JSON.stringify(parsed),
      height: parsed.canvas.height,
      width: parsed.canvas.width,
    });

    if (!updated) {
      throw new Error(`Page ${page.id} was not found`);
    }

    return updated;
  };

  const toPageSummary = (page: PageRecord) => {
    const document = parseStoredPageDocument(page);

    return {
      id: page.id,
      title: page.title,
      width: document.canvas.width,
      height: document.canvas.height,
      layerCount: document.layers.length,
      updatedAt: page.updatedAt,
    };
  };

  const toBookDetail = (book: BookRecord) => ({
    id: book.id,
    title: book.title,
    pageWidth: book.pageWidth,
    pageHeight: book.pageHeight,
    updatedAt: book.updatedAt,
    pages: repositories.books
      .listPagesForBook(accountId, book.id)
      .map(({ page }, index) => ({ index, ...toPageSummary(page) })),
  });

  const toPhotoSummary = (asset: AssetRecord) => {
    // The preview is rotated upright, so its dimensions give the displayed aspect ratio.
    const preview = repositories.assets.findVariantByKindForAccount(accountId, asset.id, "preview");

    return {
      id: asset.id,
      filename: asset.originalFilename,
      width: preview?.width ?? asset.width,
      height: preview?.height ?? asset.height,
      dateTaken: asset.dateTaken,
      gpsLatitude: asset.gpsLatitude,
      gpsLongitude: asset.gpsLongitude,
      createdAt: asset.createdAt,
    };
  };

  const createPhotoLayerForProperties = (properties: Record<string, unknown>): PageLayer => {
    const assetId = typeof properties.assetId === "string" ? properties.assetId : undefined;
    const photo = assetId ? repositories.assets.findByIdForAccount(accountId, assetId) : null;

    if (assetId && !photo) {
      throw new Error(`Photo ${assetId} was not found`);
    }

    const summary = photo ? toPhotoSummary(photo) : null;
    const aspectRatio =
      summary?.width && summary.height ? summary.height / summary.width : 720 / 960;
    const requestedWidth = readNumber(properties.width);
    const requestedHeight = readNumber(properties.height);
    const width = Math.round(
      requestedWidth ?? (requestedHeight ? requestedHeight / aspectRatio : 960),
    );
    const height = Math.round(requestedHeight ?? width * aspectRatio);

    return createPhotoLayer({ ...(assetId ? { assetId } : {}), height, width });
  };

  const createDefaultLayer = (kind: LayerKind, properties: Record<string, unknown>): PageLayer => {
    switch (kind) {
      case "photo":
        return createPhotoLayerForProperties(properties);
      case "text":
        return createTextLayer({ text: "" });
      case "sticker":
        return createStickerLayer();
      case "washiTape":
        return createWashiTapeLayer({});
      case "map":
        return createMapLayer();
    }
  };

  server.registerTool(
    "list_books",
    {
      title: "List books",
      description: "Lists the user's scrapbook books, most recently updated first.",
      annotations: { readOnlyHint: true },
    },
    () =>
      runTool(() =>
        jsonResult({
          books: repositories.books.listForAccount(accountId).map((book) => ({
            id: book.id,
            title: book.title,
            pageWidth: book.pageWidth,
            pageHeight: book.pageHeight,
            pageCount: repositories.books.listPagesForBook(accountId, book.id).length,
            updatedAt: book.updatedAt,
          })),
        }),
      ),
  );

  server.registerTool(
    "get_book",
    {
      title: "Get book",
      description:
        "Gets a book and its pages in order. The first page is the front cover and the last page is the back cover.",
      inputSchema: { bookId: z.string().describe("The book id.") },
      annotations: { readOnlyHint: true },
    },
    ({ bookId }) => runTool(() => jsonResult(toBookDetail(requireBook(bookId)))),
  );

  server.registerTool(
    "list_pages",
    {
      title: "List pages",
      description:
        "Lists every page in the user's library, including pages that are not in a book, most recently updated first.",
      annotations: { readOnlyHint: true },
    },
    () =>
      runTool(() =>
        jsonResult({ pages: repositories.pages.listForAccount(accountId).map(toPageSummary) }),
      ),
  );

  server.registerTool(
    "get_page",
    {
      title: "Get page",
      description:
        "Gets a page and its full document: the canvas settings and every layer, bottom to top.",
      inputSchema: { pageId: z.string().describe("The page id.") },
      annotations: { readOnlyHint: true },
    },
    ({ pageId }) =>
      runTool(() => {
        const page = requirePage(pageId);

        return jsonResult({
          id: page.id,
          title: page.title,
          updatedAt: page.updatedAt,
          document: parseStoredPageDocument(page),
        });
      }),
  );

  server.registerTool(
    "render_page",
    {
      title: "Render page",
      description:
        "Renders a page to a JPEG image so you can see what it looks like. Use it to check your edits.",
      inputSchema: {
        pageId: z.string().describe("The page id."),
        maxSize: z
          .number()
          .int()
          .min(256)
          .max(2048)
          .optional()
          .describe("The longest edge of the image in pixels. Defaults to 1024."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ maxSize = 1024, pageId }) =>
      runTool(async () => {
        const document = parseStoredPageDocument(requirePage(pageId));
        const dpi = (300 * maxSize) / Math.max(document.canvas.width, document.canvas.height);
        const rendered = await renderPageExport({
          accountId,
          dpi,
          format: "jpeg",
          ...(options.mapTiles ? { mapTiles: options.mapTiles } : {}),
          pageId,
          preset: "digital",
          repositories,
          storage,
        });

        return {
          content: [
            {
              type: "image",
              data: rendered.buffer.toString("base64"),
              mimeType: rendered.mimeType,
            },
          ],
        };
      }),
  );

  server.registerTool(
    "list_photos",
    {
      title: "List photos",
      description:
        "Lists photos in the user's library, newest first. Filter by album or by the photos collected for a book. Width and height are the upright display size.",
      inputSchema: {
        albumId: z.string().optional().describe("Only list photos in this album."),
        bookId: z.string().optional().describe("Only list photos collected for this book."),
        limit: z.number().int().min(1).max(200).optional().describe("Defaults to 50."),
        offset: z.number().int().min(0).optional().describe("Defaults to 0."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ albumId, bookId, limit = 50, offset = 0 }) =>
      runTool(() => {
        let photos = repositories.assets.listForAccount(accountId);

        if (albumId) {
          if (!repositories.albums.findByIdForAccount(accountId, albumId)) {
            throw new Error(`Album ${albumId} was not found`);
          }

          const albumPhotoIds = new Set(
            repositories.albums.listAssetsForAlbum(accountId, albumId).map((asset) => asset.id),
          );
          photos = photos.filter((photo) => albumPhotoIds.has(photo.id));
        }

        if (bookId) {
          requireBook(bookId);

          const bookPhotoIds = new Set(
            repositories.books.listAssetsForBook(accountId, bookId).map((asset) => asset.id),
          );
          photos = photos.filter((photo) => bookPhotoIds.has(photo.id));
        }

        return jsonResult({
          photos: photos.slice(offset, offset + limit).map(toPhotoSummary),
          total: photos.length,
        });
      }),
  );

  server.registerTool(
    "view_photo",
    {
      title: "View photo",
      description: "Returns a photo from the library as an image so you can see it.",
      inputSchema: {
        photoId: z.string().describe("The photo id from list_photos."),
        size: z
          .enum(["small", "large"])
          .optional()
          .describe("small is up to 360px, large is up to 1024px. Defaults to small."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ photoId, size = "small" }) =>
      runTool(async () => {
        const variant = repositories.assets.findVariantByKindForAccount(
          accountId,
          photoId,
          size === "small" ? "thumbnail" : "preview",
        );

        if (!variant) {
          throw new Error(`Photo ${photoId} was not found`);
        }

        let data = await storage.read(variant.storageKey);
        let mimeType = variant.mimeType;

        if (size === "large") {
          data = await sharp(data)
            .resize({ fit: "inside", height: 1024, width: 1024, withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();
          mimeType = "image/jpeg";
        }

        return { content: [{ type: "image", data: data.toString("base64"), mimeType }] };
      }),
  );

  server.registerTool(
    "upload_image",
    {
      title: "Upload image",
      description:
        "Adds an image to the user's photo library so it can be placed on pages with a photo layer. Accepts JPEG, PNG, WebP, HEIC, HEIF, TIFF or DNG up to 20 MB.",
      inputSchema: {
        data: z
          .string()
          .min(1)
          .describe("The image file encoded as base64. A data: URL prefix is also accepted."),
        filename: z.string().optional().describe("File name to show in the library."),
        albumId: z.string().optional().describe("Also add the photo to this album."),
        bookId: z.string().optional().describe("Also collect the photo for this book."),
      },
    },
    ({ albumId, bookId, data, filename }) =>
      runTool(async () => {
        if (albumId && !repositories.albums.findByIdForAccount(accountId, albumId)) {
          throw new Error(`Album ${albumId} was not found`);
        }

        if (bookId) {
          requireBook(bookId);
        }

        const base64 = data.replace(/^data:[^,]*,/, "").replace(/\s/g, "");

        if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(base64)) {
          throw new Error("Image data must be base64 encoded");
        }

        const buffer = Buffer.from(base64, "base64");
        const { asset } = await createAssetFromUpload({
          accountId,
          file: new File([new Uint8Array(buffer)], filename ?? "upload"),
          repositories,
          storage,
        });

        if (albumId) {
          repositories.albums.addAssetsToAlbum({ accountId, albumId, assetIds: [asset.id] });
        }

        if (bookId) {
          repositories.books.addAssetsToBook({ accountId, bookId, assetIds: [asset.id] });
        }

        return jsonResult({ photo: toPhotoSummary(asset) });
      }),
  );

  server.registerTool(
    "add_photos_to_book",
    {
      title: "Add photos to book",
      description:
        "Collects existing library photos for a book, so they show in the book's photo tray in the editor and in list_photos with bookId. Photos already in the book are skipped. This does not place them on a page; use add_layer for that.",
      inputSchema: {
        bookId: z.string(),
        photoIds: z.array(z.string()).min(1).max(500).describe("Photo ids from list_photos."),
      },
      annotations: { idempotentHint: true },
    },
    ({ bookId, photoIds }) =>
      runTool(() => {
        requireBook(bookId);

        const missing = photoIds.filter(
          (photoId) => !repositories.assets.findByIdForAccount(accountId, photoId),
        );

        if (missing.length > 0) {
          throw new Error(`Photos not found: ${missing.join(", ")}`);
        }

        const added = repositories.books.addAssetsToBook({ accountId, bookId, assetIds: photoIds });

        return jsonResult({
          added: added.map((record) => record.assetId),
          bookPhotoCount: repositories.books.listAssetsForBook(accountId, bookId).length,
        });
      }),
  );

  server.registerTool(
    "remove_photos_from_book",
    {
      title: "Remove photos from book",
      description:
        "Removes photos from a book's collected photos. The photos stay in the library and on any pages that use them.",
      inputSchema: {
        bookId: z.string(),
        photoIds: z.array(z.string()).min(1).max(500),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    ({ bookId, photoIds }) =>
      runTool(() => {
        requireBook(bookId);

        const removed = photoIds.filter((assetId) =>
          repositories.books.removeAssetFromBook({ accountId, bookId, assetId }),
        );

        return jsonResult({
          removed,
          bookPhotoCount: repositories.books.listAssetsForBook(accountId, bookId).length,
        });
      }),
  );

  server.registerTool(
    "list_albums",
    {
      title: "List albums",
      description: "Lists the user's photo albums.",
      annotations: { readOnlyHint: true },
    },
    () =>
      runTool(() =>
        jsonResult({
          albums: repositories.albums.listForAccount(accountId).map((album) => ({
            id: album.id,
            title: album.title,
            photoCount: album.photoCount,
          })),
        }),
      ),
  );

  server.registerTool(
    "search_stickers",
    {
      title: "Search stickers",
      description:
        "Searches emoji stickers (Noto and Twemoji) and the user's custom stickers. Use a result's id as a sticker layer's stickerId.",
      inputSchema: {
        query: z.string().optional().describe("Words to search for, such as 'heart' or 'beach'."),
        library: z
          .enum(["noto", "twemoji", "custom"])
          .optional()
          .describe("Only search one library."),
        limit: z.number().int().min(1).max(100).optional().describe("Defaults to 30."),
        offset: z.number().int().min(0).optional().describe("Defaults to 0."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ library, limit = 30, offset = 0, query = "" }) =>
      runTool(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const custom =
          library === undefined || library === "custom"
            ? repositories.stickerPacks
                .listStickersForAccount(accountId)
                .filter((sticker) => sticker.name.toLocaleLowerCase().includes(normalizedQuery))
                .map((sticker) => ({
                  id: `custom:${sticker.id}`,
                  name: sticker.name,
                  category: "Custom",
                  library: "custom",
                }))
            : [];
        const builtIn =
          library === "custom"
            ? []
            : searchStickers({
                ...(library ? { library } : {}),
                limit: Number.MAX_SAFE_INTEGER,
                query,
              }).stickers.map((sticker) => ({
                id: sticker.id,
                name: sticker.name,
                category: sticker.category,
                library: sticker.library,
              }));
        const stickers = [...custom, ...builtIn];

        return jsonResult({
          stickers: stickers.slice(offset, offset + limit),
          total: stickers.length,
        });
      }),
  );

  server.registerTool(
    "list_fonts",
    {
      title: "List fonts",
      description: "Lists the fonts available for text layers. Use a font's family as fontFamily.",
      annotations: { readOnlyHint: true },
    },
    () =>
      runTool(() =>
        jsonResult({
          fonts: editorFontDefinitions.map((font) => ({
            family: font.family,
            label: font.label,
            category: font.category,
          })),
        }),
      ),
  );

  server.registerTool(
    "list_backgrounds",
    {
      title: "List backgrounds",
      description:
        "Lists built-in page backgrounds (patterns, paper textures and skies) and the user's uploaded backgrounds. Set one with update_page.",
      annotations: { readOnlyHint: true },
    },
    () =>
      runTool(() =>
        jsonResult({
          backgrounds: [
            ...repositories.customBackgrounds.listForAccount(accountId).map((background) => ({
              id: toCustomBackgroundId(background.id),
              name: background.name,
              category: "custom",
            })),
            ...builtInBackgrounds.map((background) => ({
              id: background.id,
              name: background.name,
              category: background.category,
            })),
          ],
        }),
      ),
  );

  server.registerTool(
    "create_book",
    {
      title: "Create book",
      description: "Creates a book with a blank front cover and back cover.",
      inputSchema: {
        title: z.string().trim().min(1).max(120),
        pageWidth: z
          .number()
          .int()
          .min(320)
          .max(10000)
          .optional()
          .describe(`Page width in pixels at 300 dpi. Defaults to ${defaultBookPageSize.width}.`),
        pageHeight: z
          .number()
          .int()
          .min(320)
          .max(10000)
          .optional()
          .describe(`Page height in pixels at 300 dpi. Defaults to ${defaultBookPageSize.height}.`),
      },
    },
    ({ pageHeight, pageWidth, title }) =>
      runTool(() =>
        jsonResult(
          toBookDetail(
            createBookWithCovers({
              accountId,
              title,
              pageWidth: pageWidth ?? defaultBookPageSize.width,
              pageHeight: pageHeight ?? defaultBookPageSize.height,
              coverSpreadEnabled: true,
              repositories,
            }),
          ),
        ),
      ),
  );

  server.registerTool(
    "update_book",
    {
      title: "Update book",
      description: "Renames a book.",
      inputSchema: {
        bookId: z.string(),
        title: z.string().trim().min(1).max(120),
      },
      annotations: { idempotentHint: true },
    },
    ({ bookId, title }) =>
      runTool(() => {
        requireBook(bookId);
        repositories.books.updateForAccount(accountId, bookId, { title });

        return jsonResult(toBookDetail(requireBook(bookId)));
      }),
  );

  server.registerTool(
    "set_book_pages",
    {
      title: "Set book pages",
      description:
        "Sets the pages in a book and their order. Pages left out are removed from the book but stay in the library.",
      inputSchema: {
        bookId: z.string(),
        pageIds: z.array(z.string()).max(500).describe("Every page in the book, in order."),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ bookId, pageIds }) =>
      runTool(() => {
        requireBook(bookId);
        repositories.books.replacePages({ accountId, bookId, pageIds });

        return jsonResult(toBookDetail(requireBook(bookId)));
      }),
  );

  server.registerTool(
    "create_page",
    {
      title: "Create page",
      description:
        "Creates a blank page. With a bookId, the page is added to the book, by default just before the back cover, and uses the book's page size.",
      inputSchema: {
        title: z.string().trim().max(120).optional(),
        bookId: z.string().optional().describe("Add the page to this book."),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Zero-based position in the book. Defaults to just before the back cover."),
        width: z.number().int().min(320).max(10000).optional(),
        height: z.number().int().min(320).max(10000).optional(),
        backgroundColor: hexColorSchema.optional(),
      },
    },
    ({ backgroundColor, bookId, height, position, title, width }) =>
      runTool(() => {
        const book = bookId ? requireBook(bookId) : null;
        const document = createPageDocument({
          canvas: {
            width: width ?? book?.pageWidth ?? defaultBookPageSize.width,
            height: height ?? book?.pageHeight ?? defaultBookPageSize.height,
            ...(backgroundColor ? { backgroundColor } : {}),
          },
        });
        const page = repositories.pages.create({
          accountId,
          title: title || "Untitled page",
          width: document.canvas.width,
          height: document.canvas.height,
          documentJson: JSON.stringify(document),
        });

        if (book) {
          const pageIds = repositories.books
            .listPagesForBook(accountId, book.id)
            .map((entry) => entry.page.id);
          const index = Math.min(position ?? Math.max(0, pageIds.length - 1), pageIds.length);

          pageIds.splice(index, 0, page.id);
          repositories.books.replacePages({ accountId, bookId: book.id, pageIds });
        }

        return jsonResult({ ...toPageSummary(page), document });
      }),
  );

  server.registerTool(
    "update_page",
    {
      title: "Update page",
      description:
        "Updates a page's title, background color or background, or replaces its whole document. Prefer the layer tools for editing layers.",
      inputSchema: {
        pageId: z.string(),
        title: z.string().trim().max(120).optional(),
        backgroundColor: hexColorSchema.optional(),
        background: z
          .object({
            backgroundId: z.string().describe("A background id from list_backgrounds."),
            scale: z
              .number()
              .min(0.1)
              .max(8)
              .optional()
              .describe("Tile size multiplier for repeating backgrounds. Defaults to 1."),
            rotation: z.number().min(-180).max(180).optional(),
          })
          .nullable()
          .optional()
          .describe("A background that covers the page, or null to remove it."),
        document: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("A full replacement page document, in the same shape get_page returns."),
      },
      annotations: { idempotentHint: true },
    },
    ({ background, backgroundColor, document, pageId, title }) =>
      runTool(() => {
        const page = requirePage(pageId);
        let nextDocument = document
          ? pageDocumentSchema.parse(document)
          : parseStoredPageDocument(page);

        if (backgroundColor) {
          nextDocument = updateCanvas(nextDocument, { backgroundColor });
        }

        if (background === null) {
          nextDocument = setPageBackground(nextDocument, null);
        } else if (background) {
          nextDocument = setPageBackground(nextDocument, {
            backgroundId: background.backgroundId,
            x: 0,
            y: 0,
            width: nextDocument.canvas.width,
            height: nextDocument.canvas.height,
            ...(background.scale === undefined ? {} : { scale: background.scale }),
            ...(background.rotation === undefined ? {} : { rotation: background.rotation }),
          });
        }

        let updated = savePageDocument(page, nextDocument);

        if (title !== undefined) {
          updated =
            repositories.pages.updateForAccount(accountId, pageId, {
              title: title || "Untitled page",
            }) ?? updated;
        }

        return jsonResult({
          ...toPageSummary(updated),
          document: parseStoredPageDocument(updated),
        });
      }),
  );

  const layerPropertiesDescription =
    "Layer properties, in the shape get_page returns. Common: x, y, width, height, rotation (degrees), opacity (0-1), locked. photo: assetId, fit, border, shadow, mask, filter. text: text, fontFamily, fontSize (6-240), color, align, verticalAlign. sticker: stickerId. washiTape: outline, pattern {kind, primaryColor, secondaryColor}. map: style, markers [{id, label, latitude, longitude}], routes [{id, fromMarkerId, toMarkerId}]. Nested settings such as border or shadow are merged with the current values.";

  const toLayerResult = (page: PageRecord, layerId: string) => {
    const document = parseStoredPageDocument(page);

    return jsonResult({
      layer: document.layers.find((candidate) => candidate.id === layerId),
      index: document.layers.findIndex((candidate) => candidate.id === layerId),
      layerCount: document.layers.length,
    });
  };

  server.registerTool(
    "add_layer",
    {
      title: "Add layer",
      description:
        "Adds a layer to a page. Unset properties use the editor defaults. A photo keeps its aspect ratio unless you set both width and height.",
      inputSchema: {
        pageId: z.string(),
        kind: z.enum(layerKinds),
        properties: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(layerPropertiesDescription),
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Position in the layer stack, where 0 is the bottom. Defaults to the top."),
      },
    },
    ({ index, kind, pageId, properties = {} }) =>
      runTool(() => {
        const page = requirePage(pageId);
        const document = parseStoredPageDocument(page);
        const layer = pageLayerSchema.parse(
          mergeLayerChanges(createDefaultLayer(kind, properties), properties),
        );

        return toLayerResult(savePageDocument(page, addLayer(document, layer, index)), layer.id);
      }),
  );

  server.registerTool(
    "update_layer",
    {
      title: "Update layer",
      description: "Changes a layer's properties, its position in the layer stack, or both.",
      inputSchema: {
        pageId: z.string(),
        layerId: z.string(),
        changes: z.record(z.string(), z.unknown()).optional().describe(layerPropertiesDescription),
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Move the layer to this position in the stack, where 0 is the bottom."),
      },
      annotations: { idempotentHint: true },
    },
    ({ changes, index, layerId, pageId }) =>
      runTool(() => {
        const page = requirePage(pageId);
        let document = parseStoredPageDocument(page);
        const layer = document.layers.find((candidate) => candidate.id === layerId);

        if (!layer) {
          throw new Error(`Layer ${layerId} was not found on page ${pageId}`);
        }

        if (changes) {
          const updatedLayer = pageLayerSchema.parse(mergeLayerChanges(layer, changes));
          document = {
            ...document,
            layers: document.layers.map((candidate) =>
              candidate.id === layerId ? updatedLayer : candidate,
            ),
          };
        }

        if (index !== undefined) {
          document = reorderLayer(document, layerId, index);
        }

        return toLayerResult(savePageDocument(page, document), layerId);
      }),
  );

  server.registerTool(
    "delete_layer",
    {
      title: "Delete layer",
      description: "Removes a layer from a page.",
      inputSchema: { pageId: z.string(), layerId: z.string() },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ layerId, pageId }) =>
      runTool(() => {
        const page = requirePage(pageId);
        const document = parseStoredPageDocument(page);

        if (!document.layers.some((layer) => layer.id === layerId)) {
          throw new Error(`Layer ${layerId} was not found on page ${pageId}`);
        }

        const saved = savePageDocument(page, deleteLayer(document, layerId));

        return jsonResult({
          deletedLayerId: layerId,
          layerCount: parseStoredPageDocument(saved).layers.length,
        });
      }),
  );

  return server;
};
