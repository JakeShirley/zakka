import {
  createPageDocument,
  getCustomBackgroundStorageId,
  type PageDocument,
  pageDocumentSchema,
} from "@zakka/editor-core";

import type { Repositories } from "./persistence/repositories.js";
import type { BookRecord, PageRecord } from "./persistence/schema.js";

export const parseStoredPageDocument = (page: PageRecord): PageDocument => {
  try {
    return pageDocumentSchema.parse(JSON.parse(page.documentJson));
  } catch {
    return createPageDocument({ canvas: { width: page.width, height: page.height } });
  }
};

/** True when every photo layer and custom background in the document belongs to the account. */
export const validatePageDocumentAssets = (
  accountId: string,
  document: PageDocument,
  repositories: Repositories,
): boolean => {
  const assetIds = new Set(
    document.layers.flatMap((layer) =>
      layer.kind === "photo" && layer.assetId ? [layer.assetId] : [],
    ),
  );

  for (const assetId of assetIds) {
    if (!repositories.assets.findByIdForAccount(accountId, assetId)) {
      return false;
    }
  }

  const customBackgroundId = document.canvas.background
    ? getCustomBackgroundStorageId(document.canvas.background.backgroundId)
    : null;

  if (
    customBackgroundId &&
    !repositories.customBackgrounds.findByIdForAccount(accountId, customBackgroundId)
  ) {
    return false;
  }

  return true;
};

/** Creates a book with its blank front and back cover pages. */
export const createBookWithCovers = (input: {
  accountId: string;
  title: string;
  pageWidth: number;
  pageHeight: number;
  coverSpreadEnabled: boolean;
  repositories: Repositories;
}): BookRecord => {
  const { accountId, pageHeight, pageWidth, repositories } = input;
  const book = repositories.books.create({
    accountId,
    title: input.title,
    pageWidth,
    pageHeight,
    coverSpreadEnabled: input.coverSpreadEnabled,
  });
  const frontCover = repositories.pages.create({
    accountId,
    title: "Front cover",
    width: pageWidth,
    height: pageHeight,
  });
  const backCover = repositories.pages.create({
    accountId,
    title: "Back cover",
    width: pageWidth,
    height: pageHeight,
  });

  repositories.books.addPage({ accountId, bookId: book.id, pageId: frontCover.id, sortOrder: 0 });
  repositories.books.addPage({ accountId, bookId: book.id, pageId: backCover.id, sortOrder: 1 });

  return book;
};
