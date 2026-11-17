import { z } from "@hono/zod-openapi";
import {
  type PageDocument,
  type PageLayer,
  type PhotoLayer,
  updateLayer,
} from "@zakka/editor-core";
import {
  type ArrangeSettings,
  defaultArrangeSettings,
  getSelectedLayersInOrder,
  planArrange,
} from "@zakka/editor-core/arrange";
import {
  applyPageLayout,
  decodePageLayouts,
  filterPageLayoutsForCanvas,
  getPageLayoutCategories,
  getPageLayoutFit,
  type PageLayout,
  pageLayoutCategories,
  zakkaPageLayouts,
} from "@zakka/editor-core/page-layouts";
import {
  getAutoEnhanceAdjustments,
  getBookPrintWarnings,
  getPhotoResolutionWarning,
  measurePhotoTones,
} from "@zakka/editor-core/photo-quality";
import { reconcileSpreadPageEdit, syncLayerAcrossSpread } from "@zakka/editor-core/spreads";
import sharp from "sharp";

import { parseStoredPageDocument } from "../library.js";
import type { AssetRecord } from "../persistence/schema.js";
import { findSpreadLayerCopyPageIds, jsonResult, type McpToolContext, runTool } from "./shared.js";

let allPageLayouts: readonly PageLayout[] | null = null;

// The Shutterfly catalog is large, so decode it on first use.
const loadPageLayouts = async (): Promise<readonly PageLayout[]> => {
  if (!allPageLayouts) {
    const { shutterflyPageLayouts } = await import("@zakka/editor-core/page-layouts-shutterfly");
    allPageLayouts = [...zakkaPageLayouts, ...decodePageLayouts(shutterflyPageLayouts)];
  }

  return allPageLayouts;
};

/** Natural width / height of a photo; EXIF orientations 5-8 display rotated a quarter turn. */
const getPhotoAspectRatio = (photo: AssetRecord | null | undefined) => {
  if (!photo?.width || !photo.height) {
    return null;
  }

  const isQuarterTurned =
    photo.orientation !== null && photo.orientation >= 5 && photo.orientation <= 8;

  return isQuarterTurned ? photo.height / photo.width : photo.width / photo.height;
};

const layerIdsSchema = z
  .array(z.string())
  .min(1)
  .max(200)
  .describe("Layer ids in selection order. Locked layers are never moved.");

/** Registers tools for page layouts, arranging layers, print checks and photo enhancement. */
export const registerEditorTools = (ctx: McpToolContext) => {
  const { accountId, repositories, server } = ctx;

  const findPhoto = (assetId: string | undefined) =>
    assetId ? repositories.assets.findByIdForAccount(accountId, assetId) : null;

  /** Saves an edited page, moving shared spread layers on facing pages to match. */
  const saveWithSpread = (
    pageId: string,
    document: PageDocument,
    syncLayerIds: readonly string[],
    bookId?: string,
  ) => {
    const spreadPageIds = ctx.getSpreadPageIds(pageId, bookId);

    if (spreadPageIds.length < 2) {
      ctx.savePageDocuments(new Map([[pageId, document]]));
      return [pageId];
    }

    const previous = ctx.loadPageDocuments(spreadPageIds);
    let documents = new Map(previous);

    for (const [changedPageId, changedDocument] of reconcileSpreadPageEdit({
      documents: previous,
      nextDocument: document,
      sourcePageId: pageId,
      spreadPageIds,
    })) {
      documents.set(changedPageId, changedDocument);
    }

    for (const layerId of syncLayerIds) {
      const sourceLayer = documents.get(pageId)?.layers.find((layer) => layer.id === layerId);

      if (sourceLayer) {
        documents = syncLayerAcrossSpread({
          documents,
          removeNonOverlappingSource: true,
          sourceLayer,
          sourcePageId: pageId,
          spreadPageIds,
        }).documents;
      }
    }

    const changed = new Map(
      [...documents].filter(([candidateId, candidate]) => candidate !== previous.get(candidateId)),
    );
    ctx.savePageDocuments(changed);

    return [...changed.keys()];
  };

  server.registerTool(
    "list_page_layouts",
    {
      title: "List page layouts",
      description:
        "Lists ready-made page layouts (photo and text slot arrangements). With a pageId, only layouts that suit the page's shape are listed, with whether each fits the page's current photos. Apply one with apply_page_layout.",
      inputSchema: {
        pageId: z.string().optional().describe("Only list layouts that suit this page."),
        photoCount: z.number().int().min(0).max(40).optional().describe("Number of photo slots."),
        category: z
          .enum(pageLayoutCategories.map((category) => category.id) as [string, ...string[]])
          .optional(),
        source: z.enum(["zakka", "shutterfly"]).optional(),
        limit: z.number().int().min(1).max(200).optional().describe("Defaults to 50."),
        offset: z.number().int().min(0).optional().describe("Defaults to 0."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ category, limit = 50, offset = 0, pageId, photoCount, source }) =>
      runTool(async () => {
        const document = pageId ? parseStoredPageDocument(ctx.requirePage(pageId)) : null;
        let layouts = await loadPageLayouts();

        if (document) {
          layouts = filterPageLayoutsForCanvas(layouts, document.canvas);
        }

        const matches = layouts.filter((layout) => {
          if (source && layout.source !== source) return false;
          if (photoCount !== undefined && layout.photoSlotCount !== photoCount) return false;
          return !category || getPageLayoutCategories(layout).has(category as never);
        });

        return jsonResult({
          layouts: matches.slice(offset, offset + limit).map((layout) => ({
            id: layout.id,
            name: layout.name,
            source: layout.source,
            orientation: layout.orientation,
            photoSlotCount: layout.photoSlotCount,
            textSlotCount: layout.textSlotCount,
            categories: [...getPageLayoutCategories(layout)],
            ...(document ? { fitsPage: getPageLayoutFit(document, layout).fits } : {}),
          })),
          total: matches.length,
        });
      }),
  );

  server.registerTool(
    "apply_page_layout",
    {
      title: "Apply page layout",
      description:
        "Rearranges a page into a layout. Existing photos move into the photo slots that best match their shape, text moves into text slots, and unfilled slots become empty photo frames or placeholder text. Stickers, washi tape, maps, locked layers and layers hanging off the page are left alone. Photos beyond the layout's slots are removed.",
      inputSchema: {
        pageId: z.string(),
        layoutId: z.string().describe("A layout id from list_page_layouts."),
      },
    },
    ({ layoutId, pageId }) =>
      runTool(async () => {
        const page = ctx.requirePage(pageId);
        const layout = (await loadPageLayouts()).find((candidate) => candidate.id === layoutId);

        if (!layout) {
          throw new Error(`Page layout ${layoutId} was not found`);
        }

        const { document, removedPhotoLayerIds } = applyPageLayout(
          parseStoredPageDocument(page),
          layout,
          {
            getPhotoAspectRatio: (layer) => getPhotoAspectRatio(findPhoto(layer.assetId)),
          },
        );
        const changedPageIds = saveWithSpread(pageId, document, []);

        return jsonResult({
          ...ctx.toPageSummary(ctx.requirePage(pageId)),
          changedPageIds,
          removedPhotoLayerIds,
          document,
        });
      }),
  );

  server.registerTool(
    "arrange_layers",
    {
      title: "Arrange layers",
      description:
        "Aligns, spreads out or grids layers on a page, like the editor's Arrange panel. Layers are measured by their visible bounds, including rotation. Use mode align with relativeTo page to align a single layer to the page.",
      inputSchema: {
        pageId: z.string(),
        layerIds: layerIdsSchema,
        mode: z.enum(["align", "spread", "grid"]),
        align: z
          .object({
            horizontal: z.enum(["none", "left", "center", "right"]).optional(),
            vertical: z.enum(["none", "top", "middle", "bottom"]).optional(),
            relativeTo: z
              .enum(["lastSelected", "firstSelected", "largest", "smallest", "page", "selection"])
              .optional()
              .describe("What to align to. Defaults to lastSelected."),
            asGroup: z
              .boolean()
              .optional()
              .describe("With relativeTo page, move the layers together as one block."),
          })
          .optional(),
        spread: z
          .object({
            mode: z
              .enum([
                "gapsHorizontal",
                "gapsVertical",
                "left",
                "centerX",
                "right",
                "top",
                "centerY",
                "bottom",
              ])
              .optional()
              .describe(
                "gaps* evens out the space between layers; the others evenly space that edge or center. Defaults to gapsHorizontal.",
              ),
            within: z
              .enum(["selection", "page"])
              .optional()
              .describe("selection keeps the outer layers in place; page uses the page edges."),
            gapMode: z.enum(["even", "fixed"]).optional(),
            gap: z.number().min(0).max(2000).optional().describe("Gap in pixels for fixed mode."),
          })
          .optional(),
        grid: z
          .object({
            columns: z.number().int().min(1).max(20).nullable().optional(),
            gapX: z.number().min(0).max(2000).optional(),
            gapY: z.number().min(0).max(2000).optional(),
            area: z.enum(["selection", "page"]).optional(),
            cellSize: z.enum(["largest", "fit"]).optional(),
            cellAlignX: z.enum(["start", "center", "end"]).optional(),
            cellAlignY: z.enum(["start", "center", "end"]).optional(),
            order: z
              .enum(["reading", "selection"])
              .optional()
              .describe("reading orders by position on the page; selection uses layerIds order."),
          })
          .optional(),
      },
    },
    ({ align, grid, layerIds, mode, pageId, spread }) =>
      runTool(() => {
        const page = ctx.requirePage(pageId);
        const document = parseStoredPageDocument(page);
        const missing = layerIds.filter(
          (layerId) => !document.layers.some((layer) => layer.id === layerId),
        );

        if (missing.length > 0) {
          throw new Error(`Layers not found on page ${pageId}: ${missing.join(", ")}`);
        }

        const withDefaults = <T extends object>(defaults: T, overrides: object | undefined): T => ({
          ...defaults,
          ...Object.fromEntries(
            Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined),
          ),
        });
        const settings: ArrangeSettings = {
          tab: mode,
          align: withDefaults(defaultArrangeSettings.align, align),
          spread: withDefaults(defaultArrangeSettings.spread, spread),
          grid: withDefaults(defaultArrangeSettings.grid, grid),
        };
        const plan = planArrange(
          getSelectedLayersInOrder(document, layerIds),
          document.canvas,
          settings,
        );

        if (!plan || plan.updates.length === 0) {
          return jsonResult({
            movedLayerIds: [],
            message:
              "Nothing to arrange. Spreading needs at least 3 unlocked layers (2 within the page or with a fixed gap), and aligning to another layer needs at least 2.",
          });
        }

        let nextDocument = document;

        for (const { layerId, update } of plan.updates) {
          nextDocument = updateLayer(nextDocument, layerId, update);
        }

        const movedLayerIds = plan.updates.map((update) => update.layerId);
        const changedPageIds = saveWithSpread(pageId, nextDocument, movedLayerIds);
        const saved = parseStoredPageDocument(ctx.requirePage(pageId));

        return jsonResult({
          movedLayerIds,
          changedPageIds,
          layers: saved.layers
            .filter((layer) => movedLayerIds.includes(layer.id))
            .map(({ height, id, rotation, width, x, y }) => ({
              id,
              x,
              y,
              width,
              height,
              rotation,
            })),
        });
      }),
  );

  server.registerTool(
    "get_print_warnings",
    {
      title: "Get print warnings",
      description:
        "Finds photos placed too large for their resolution, which will look blurry in print. Checks a whole book (grouped by spread) or one page.",
      inputSchema: {
        bookId: z.string().optional(),
        pageId: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ bookId, pageId }) =>
      runTool(() => {
        if (Boolean(bookId) === Boolean(pageId)) {
          throw new Error("Provide either a bookId or a pageId");
        }

        const photoById = new Map(
          repositories.assets.listForAccount(accountId).map((photo) => [photo.id, photo]),
        );
        const toWarning = (warning: {
          asset: AssetRecord;
          dpi: number;
          layerId: string;
          pageId: string;
          quality: string;
        }) => ({
          pageId: warning.pageId,
          layerId: warning.layerId,
          photoId: warning.asset.id,
          filename: warning.asset.originalFilename,
          effectiveDpi: Math.round(warning.dpi),
          quality: warning.quality,
        });

        if (pageId) {
          const document = parseStoredPageDocument(ctx.requirePage(pageId));
          const warnings = document.layers.flatMap((layer) => {
            const photo = layer.kind === "photo" && layer.assetId && photoById.get(layer.assetId);
            const warning = photo ? getPhotoResolutionWarning(layer as PhotoLayer, photo) : null;

            return photo && warning
              ? [toWarning({ ...warning, asset: photo, layerId: layer.id, pageId })]
              : [];
          });

          return jsonResult({ warnings });
        }

        const book = ctx.requireBook(bookId ?? "");
        const entries = repositories.books.listPagesForBook(accountId, book.id);
        const orderedPageIds = entries.map(({ page }) => page.id);
        const groups = getBookPrintWarnings(
          ctx.getBookSpreads(book),
          orderedPageIds,
          ctx.loadPageDocuments(orderedPageIds),
          photoById,
        );

        return jsonResult({
          groups: groups.map((group) => ({
            label: group.label,
            pageIds: group.pageIds,
            photos: group.photos.map(toWarning),
          })),
        });
      }),
  );

  server.registerTool(
    "auto_enhance_photo",
    {
      title: "Auto enhance photo",
      description:
        "Measures a placed photo's tones and sets its brightness, contrast, saturation, shadows and highlights to balance it, like the editor's Auto enhance switch. Copies of the photo across a spread are updated too.",
      inputSchema: { pageId: z.string(), layerId: z.string() },
      annotations: { idempotentHint: true },
    },
    ({ layerId, pageId }) =>
      runTool(async () => {
        const document = parseStoredPageDocument(ctx.requirePage(pageId));
        const layer = document.layers.find((candidate) => candidate.id === layerId);

        if (layer?.kind !== "photo") {
          throw new Error(`Photo layer ${layerId} was not found on page ${pageId}`);
        }

        if (!layer.assetId) {
          throw new Error("The photo frame is empty; put a photo in it first");
        }

        const variant =
          repositories.assets.findVariantByKindForAccount(accountId, layer.assetId, "preview") ??
          repositories.assets.findVariantByKindForAccount(accountId, layer.assetId, "thumbnail");

        if (!variant) {
          throw new Error(`Photo ${layer.assetId} was not found`);
        }

        const pixels = await sharp(await ctx.storage.read(variant.storageKey))
          .resize(96, 96, { fit: "inside" })
          .ensureAlpha()
          .raw()
          .toBuffer();
        const stats = measurePhotoTones(new Uint8Array(pixels));

        if (!stats) {
          throw new Error("Could not measure the photo's tones");
        }

        const filter = { ...layer.filter, ...getAutoEnhanceAdjustments(stats) };
        const spreadPageIds = ctx.getSpreadPageIds(pageId);
        const spreadDocuments = ctx.loadPageDocuments(spreadPageIds);
        const documents = new Map([
          [pageId, updateLayer(document, layerId, { filter } as Partial<PageLayer>)],
        ]);

        for (const copyPageId of findSpreadLayerCopyPageIds(
          spreadDocuments,
          spreadPageIds,
          pageId,
          layer,
        )) {
          const copyDocument = spreadDocuments.get(copyPageId);

          if (copyDocument) {
            documents.set(
              copyPageId,
              updateLayer(copyDocument, layerId, { filter } as Partial<PageLayer>),
            );
          }
        }

        ctx.savePageDocuments(documents);

        return jsonResult({ layerId, filter, changedPageIds: [...documents.keys()] });
      }),
  );
};
