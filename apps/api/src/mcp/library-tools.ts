import { z } from "@hono/zod-openapi";

import { parseStoredPageDocument } from "../library.js";
import type { AssetRecord } from "../persistence/schema.js";
import { jsonResult, type McpToolContext, runTool } from "./shared.js";

const titleSchema = z.string().trim().min(1).max(120);
const photoIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(240)
  .describe("Photo ids from list_photos.");

/** Registers tools for deleting and duplicating pages and books, photo details and albums. */
export const registerLibraryTools = (ctx: McpToolContext) => {
  const { accountId, repositories, server } = ctx;

  const requireAlbum = (albumId: string) => {
    const album = repositories.albums
      .listForAccount(accountId)
      .find((candidate) => candidate.id === albumId);

    if (!album) {
      throw new Error(`Album ${albumId} was not found`);
    }

    return album;
  };

  const toAlbumResult = (albumId: string) => {
    const album = requireAlbum(albumId);

    return { id: album.id, title: album.title, photoCount: album.photoCount };
  };

  const requirePhoto = (photoId: string): AssetRecord => {
    const photo = repositories.assets.findByIdForAccount(accountId, photoId);

    if (!photo) {
      throw new Error(`Photo ${photoId} was not found`);
    }

    return photo;
  };

  const requirePhotos = (photoIds: string[]) => {
    const missing = photoIds.filter(
      (photoId) => !repositories.assets.findByIdForAccount(accountId, photoId),
    );

    if (missing.length > 0) {
      throw new Error(`Photos not found: ${missing.join(", ")}`);
    }
  };

  server.registerTool(
    "delete_page",
    {
      title: "Delete page",
      description:
        "Permanently deletes a page from the library and removes it from any book that contains it. This cannot be undone.",
      inputSchema: { pageId: z.string() },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ pageId }) =>
      runTool(() => {
        ctx.requirePage(pageId);

        for (const book of ctx.findBooksForPage(pageId)) {
          repositories.books.replacePages({
            accountId,
            bookId: book.id,
            pageIds: repositories.books
              .listPagesForBook(accountId, book.id)
              .map((entry) => entry.page.id)
              .filter((candidate) => candidate !== pageId),
          });
        }

        repositories.pages.deleteByIdForAccount(accountId, pageId);

        return jsonResult({ deletedPageId: pageId });
      }),
  );

  server.registerTool(
    "duplicate_page",
    {
      title: "Duplicate page",
      description:
        "Copies a page and all of its layers. With a bookId, the copy is added to the book, by default just after the original (or before the back cover when the original is not in that book).",
      inputSchema: {
        pageId: z.string(),
        title: z
          .string()
          .trim()
          .max(120)
          .optional()
          .describe("Title for the copy. Defaults to the original title followed by 'copy'."),
        bookId: z.string().optional().describe("Add the copy to this book."),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Zero-based position in the book for the copy."),
      },
    },
    ({ bookId, pageId, position, title }) =>
      runTool(() => {
        const source = ctx.requirePage(pageId);
        const book = bookId ? ctx.requireBook(bookId) : null;
        const document = parseStoredPageDocument(source);
        const copy = repositories.pages.create({
          accountId,
          title: title || `${source.title} copy`,
          width: document.canvas.width,
          height: document.canvas.height,
          documentJson: JSON.stringify(document),
        });

        if (book) {
          const pageIds = repositories.books
            .listPagesForBook(accountId, book.id)
            .map((entry) => entry.page.id);
          const sourceIndex = pageIds.indexOf(pageId);
          const defaultIndex = sourceIndex >= 0 ? sourceIndex + 1 : Math.max(0, pageIds.length - 1);
          const index = Math.min(position ?? defaultIndex, pageIds.length);

          pageIds.splice(index, 0, copy.id);
          repositories.books.replacePages({ accountId, bookId: book.id, pageIds });
        }

        return jsonResult(ctx.toPageSummary(copy));
      }),
  );

  server.registerTool(
    "delete_book",
    {
      title: "Delete book",
      description:
        "Permanently deletes a book and its exports. Its pages stay in the library; use delete_page to remove them too. This cannot be undone.",
      inputSchema: { bookId: z.string() },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ bookId }) =>
      runTool(() => {
        const book = ctx.requireBook(bookId);
        const pageIds = repositories.books
          .listPagesForBook(accountId, book.id)
          .map((entry) => entry.page.id);

        repositories.books.deleteByIdForAccount(accountId, bookId);

        return jsonResult({ deletedBookId: bookId, remainingPageIds: pageIds });
      }),
  );

  server.registerTool(
    "get_photo",
    {
      title: "Get photo",
      description:
        "Gets a photo's full details: file info, camera and EXIF settings, location, and the albums and books it belongs to.",
      inputSchema: { photoId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ photoId }) =>
      runTool(() => {
        const photo = requirePhoto(photoId);

        return jsonResult({
          ...ctx.toPhotoSummary(photo),
          originalWidth: photo.width,
          originalHeight: photo.height,
          mimeType: photo.mimeType,
          byteSize: photo.byteSize,
          checksumSha256: photo.checksumSha256,
          orientation: photo.orientation,
          cameraMake: photo.cameraMake,
          cameraModel: photo.cameraModel,
          lensModel: photo.lensModel,
          isoSpeed: photo.isoSpeed,
          fNumber: photo.fNumber,
          exposureTimeSeconds: photo.exposureTimeSeconds,
          focalLengthMm: photo.focalLengthMm,
          focalLength35mmMm: photo.focalLength35mmMm,
          gpsAltitudeMeters: photo.gpsAltitudeMeters,
          albums: repositories.albums
            .listAlbumsForAsset(accountId, photo.id)
            .map((album) => ({ id: album.id, title: album.title })),
          books: repositories.books
            .listForAccount(accountId)
            .filter((book) =>
              repositories.books
                .listAssetsForBook(accountId, book.id)
                .some((asset) => asset.id === photo.id),
            )
            .map((book) => ({ id: book.id, title: book.title })),
        });
      }),
  );

  server.registerTool(
    "create_album",
    {
      title: "Create album",
      description: "Creates a photo album, optionally with photos already in the library.",
      inputSchema: {
        title: titleSchema,
        photoIds: photoIdsSchema.optional(),
      },
    },
    ({ photoIds, title }) =>
      runTool(() => {
        if (photoIds) {
          requirePhotos(photoIds);
        }

        const album = repositories.albums.create({ accountId, title });

        if (photoIds) {
          repositories.albums.addAssetsToAlbum({
            accountId,
            albumId: album.id,
            assetIds: [...new Set(photoIds)],
          });
        }

        return jsonResult(toAlbumResult(album.id));
      }),
  );

  server.registerTool(
    "update_album",
    {
      title: "Rename album",
      description: "Renames a photo album.",
      inputSchema: { albumId: z.string(), title: titleSchema },
      annotations: { idempotentHint: true },
    },
    ({ albumId, title }) =>
      runTool(() => {
        if (!repositories.albums.update({ accountId, albumId, title })) {
          throw new Error(`Album ${albumId} was not found`);
        }

        return jsonResult(toAlbumResult(albumId));
      }),
  );

  server.registerTool(
    "delete_album",
    {
      title: "Delete album",
      description:
        "Deletes a photo album. The photos stay in the library and on any pages that use them.",
      inputSchema: { albumId: z.string() },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ albumId }) =>
      runTool(() => {
        if (!repositories.albums.delete({ accountId, albumId })) {
          throw new Error(`Album ${albumId} was not found`);
        }

        return jsonResult({ deletedAlbumId: albumId });
      }),
  );

  server.registerTool(
    "add_photos_to_album",
    {
      title: "Add photos to album",
      description: "Adds library photos to an album. Photos already in the album are skipped.",
      inputSchema: { albumId: z.string(), photoIds: photoIdsSchema },
      annotations: { idempotentHint: true },
    },
    ({ albumId, photoIds }) =>
      runTool(() => {
        requireAlbum(albumId);
        requirePhotos(photoIds);

        const added = repositories.albums.addAssetsToAlbum({
          accountId,
          albumId,
          assetIds: [...new Set(photoIds)],
        });

        return jsonResult({
          added: added.map((record) => record.assetId),
          album: toAlbumResult(albumId),
        });
      }),
  );

  server.registerTool(
    "remove_photos_from_album",
    {
      title: "Remove photos from album",
      description:
        "Removes photos from an album. The photos stay in the library and on any pages that use them.",
      inputSchema: { albumId: z.string(), photoIds: photoIdsSchema },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    ({ albumId, photoIds }) =>
      runTool(() => {
        requireAlbum(albumId);

        const removed = photoIds.filter((assetId) =>
          repositories.albums.removeAssetFromAlbum({ accountId, albumId, assetId }),
        );

        return jsonResult({ removed, album: toAlbumResult(albumId) });
      }),
  );
};
