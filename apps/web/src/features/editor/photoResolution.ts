import type { PageDocument } from "@zakka/editor-core";
import {
  type BookPrintWarningGroup as BookPrintWarningGroupOf,
  type BookPrintWarningPhoto as BookPrintWarningPhotoOf,
  getBookPrintWarnings as getBookPrintWarningsForDocuments,
} from "@zakka/editor-core/photo-quality";

import type { Asset, PageDetail } from "../../types";

export {
  getNewPhotoFrameSize,
  getPhotoResolutionWarning,
  type PhotoResolutionWarning,
} from "@zakka/editor-core/photo-quality";

export type BookPrintWarningPhoto = BookPrintWarningPhotoOf<Asset>;

export type BookPrintWarningGroup = BookPrintWarningGroupOf<Asset>;

/** Collects every low-resolution photo in the book, grouped by the spread it appears on. */
export const getBookPrintWarnings = (
  spreads: readonly { pageIds: readonly string[] }[],
  orderedPageIds: readonly string[],
  pageDetails: ReadonlyMap<string, PageDetail>,
  assetById: ReadonlyMap<string, Asset>,
): BookPrintWarningGroup[] =>
  getBookPrintWarningsForDocuments(
    spreads,
    orderedPageIds,
    new Map<string, PageDocument>(
      [...pageDetails].map(([pageId, page]) => [pageId, page.document]),
    ),
    assetById,
  );
