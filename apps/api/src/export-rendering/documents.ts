import type { ExportPreset } from "@zakka/api-contract";
import {
  builtInBackgroundIdPrefix,
  getBuiltInBackground,
  getCustomBackgroundStorageId,
  getMapLayerGeographyDetail,
  getMapLayerTiles,
  isCustomStickerId,
  type MapGeography,
  type MapGeographyDetail,
  type MapLayer,
  type MapTile,
  type PageDocument,
  type PhotoLayer,
  renderPageDocumentSvg,
  type WashiTapeLayer,
} from "@zakka/editor-core";
import { getStickerSvg } from "@zakka/editor-core/stickers";
import sharp from "sharp";

import { readBuiltInBackgroundTexture } from "../custom-backgrounds.js";
import { createSharpInputBuffer } from "../image-decoding.js";
import type { MapTileSource } from "../map-tiles.js";
import type { Repositories } from "../persistence/repositories.js";
import type { PageRecord } from "../persistence/schema.js";
import { type RasterRenderSettings, renderScaleForSettings } from "./raster.js";
import type { ExportStorage } from "./types.js";

const svgNativeImageMimeTypes = new Set(["image/jpeg", "image/png"]);
const maxOriginalDataUriByteSize = 2 * 1024 * 1024;

const targetPhotoDimension = (layer: PhotoLayer, settings: RasterRenderSettings): number => {
  const cropWidth = Math.max(layer.crop.width, 0.05);
  const cropHeight = Math.max(layer.crop.height, 0.05);
  const imageWidth = layer.width / cropWidth;
  const imageHeight = layer.height / cropHeight;
  const transformedDimension = Math.max(imageWidth, imageHeight) * layer.photoTransform.scale;

  return Math.max(1, Math.ceil(transformedDimension * renderScaleForSettings(settings)));
};

const targetWashiTapeDimension = (layer: WashiTapeLayer, settings: RasterRenderSettings): number =>
  Math.max(
    1,
    Math.ceil(
      Math.max(16, layer.height * layer.tile.scale) *
        Math.max(layer.tile.scaleX, layer.tile.scaleY) *
        renderScaleForSettings(settings),
    ),
  );

const createImageDataUri = async (input: {
  buffer: Buffer;
  mimeType: string;
  settings: RasterRenderSettings;
  targetDimension: number;
}): Promise<string> => {
  if (
    svgNativeImageMimeTypes.has(input.mimeType) &&
    input.buffer.byteLength <= maxOriginalDataUriByteSize
  ) {
    return `data:${input.mimeType};base64,${input.buffer.toString("base64")}`;
  }

  const sharpInputBuffer = await createSharpInputBuffer(input.buffer);
  const metadata = await sharp(sharpInputBuffer, {
    failOn: "warning",
    limitInputPixels: false,
  }).metadata();
  const image = sharp(sharpInputBuffer, { failOn: "warning", limitInputPixels: false })
    .rotate()
    .resize({
      fit: "inside",
      height: input.targetDimension,
      width: input.targetDimension,
      withoutEnlargement: true,
    });
  const rendered = metadata.hasAlpha
    ? {
        buffer: await image.png({ compressionLevel: 9 }).toBuffer(),
        mimeType: "image/png",
      }
    : {
        buffer: await image.jpeg({ mozjpeg: true, quality: 90 }).toBuffer(),
        mimeType: "image/jpeg",
      };

  return `data:${rendered.mimeType};base64,${rendered.buffer.toString("base64")}`;
};

const mapTileKey = (tile: MapTile): string => `${tile.provider}/${tile.z}/${tile.x}/${tile.y}`;

// Caps how long a cold tile cache or an unresponsive provider can hold up an export. Tiles
// still missing at the deadline are left as gaps.
const exportTileDeadlineMs = 60_000;

const loadMapGeography = async (detail: MapGeographyDetail): Promise<MapGeography> => {
  if (detail === "high") {
    const { getDetailedMapGeography } = await import("@zakka/editor-core/map-data-detailed");

    return getDetailedMapGeography();
  }

  const { getMapGeography } = await import("@zakka/editor-core/map-data");

  return getMapGeography();
};

/**
 * Resolves everything map layers need before the synchronous SVG render: the bundled
 * geography for vector styles and every raster tile inlined as a data URI, so the
 * rasterizer never reaches the network and exported tiles match the editor exactly.
 */
const prepareMapLayers = async (
  layers: MapLayer[],
  mapTiles: MapTileSource | undefined,
): Promise<{
  geography: Map<MapGeographyDetail, MapGeography>;
  tileHrefs: Map<string, string>;
}> => {
  const geography = new Map<MapGeographyDetail, MapGeography>();
  const tileHrefs = new Map<string, string>();
  const details = new Set<MapGeographyDetail>();
  const tiles = new Map<string, MapTile>();

  for (const layer of layers) {
    const detail = getMapLayerGeographyDetail(layer);

    if (detail) details.add(detail);
    if (!mapTiles) continue;

    for (const tile of getMapLayerTiles(layer)) tiles.set(mapTileKey(tile), tile);
  }

  const deadline = AbortSignal.timeout(exportTileDeadlineMs);

  await Promise.all([
    ...[...details].map(async (detail) => {
      geography.set(detail, await loadMapGeography(detail));
    }),
    ...[...tiles].map(async ([key, tile]) => {
      try {
        const image = await mapTiles?.getTile(tile, { signal: deadline });

        if (image) {
          tileHrefs.set(key, `data:${image.mimeType};base64,${image.buffer.toString("base64")}`);
        }
      } catch {
        // A missing tile leaves a gap rather than failing the whole export.
      }
    }),
  ]);

  return { geography, tileHrefs };
};

export const parsePageDocument = async (page: PageRecord): Promise<PageDocument> => {
  const { pageDocumentSchema } = await import("@zakka/editor-core");

  return pageDocumentSchema.parse(JSON.parse(page.documentJson));
};

/** Inlines the page's background image (built-in texture or custom upload) for rasterizing. */
const resolveBackgroundDataUri = async (
  input: {
    accountId: string;
    document: PageDocument;
    repositories: Repositories;
    storage: ExportStorage;
  },
  settings: RasterRenderSettings,
): Promise<string | undefined> => {
  const background = input.document.canvas.background;

  if (!background) return undefined;

  const customBackgroundId = getCustomBackgroundStorageId(background.backgroundId);

  if (customBackgroundId) {
    const record = input.repositories.customBackgrounds.findByIdForAccount(
      input.accountId,
      customBackgroundId,
    );

    if (!record) return undefined;

    return createImageDataUri({
      buffer: await input.storage.read(record.storageKey),
      mimeType: record.mimeType,
      settings,
      targetDimension: Math.max(
        1,
        Math.ceil(Math.max(background.width, background.height) * renderScaleForSettings(settings)),
      ),
    });
  }

  const builtIn = getBuiltInBackground(background.backgroundId);

  if (builtIn?.kind !== "texture") return undefined;

  const buffer = await readBuiltInBackgroundTexture(
    builtIn.id.slice(builtInBackgroundIdPrefix.length),
    "content",
  );

  return buffer ? `data:image/jpeg;base64,${buffer.toString("base64")}` : undefined;
};

export const renderPageSvg = async (input: {
  accountId: string;
  document: PageDocument;
  dpi?: number;
  includeBackground?: boolean;
  mapTiles?: MapTileSource;
  preset: ExportPreset;
  repositories: Repositories;
  storage: ExportStorage;
}): Promise<string> => {
  const settings: RasterRenderSettings =
    input.dpi === undefined ? { preset: input.preset } : { dpi: input.dpi, preset: input.preset };
  const photoHrefs = new Map<string, string>();
  const washiTapeHrefs = new Map<string, string>();
  const stickerHrefs = new Map<string, string>();

  for (const layer of input.document.layers) {
    if (layer.kind === "photo") {
      // Empty photo placeholders have no asset and are left out of exports.
      if (!layer.assetId) {
        continue;
      }

      const asset = input.repositories.assets.findByIdForAccount(input.accountId, layer.assetId);

      if (!asset) {
        continue;
      }

      const buffer = await input.storage.read(asset.originalStorageKey);
      photoHrefs.set(
        layer.id,
        await createImageDataUri({
          buffer,
          mimeType: asset.mimeType,
          settings,
          targetDimension: targetPhotoDimension(layer, settings),
        }),
      );

      continue;
    }

    if (layer.kind === "sticker" && isCustomStickerId(layer.stickerId)) {
      const customStickerId = layer.stickerId.slice("custom:".length);
      const sticker = input.repositories.stickerPacks.findStickerByIdForAccount(
        input.accountId,
        customStickerId,
      );

      if (!sticker) {
        continue;
      }

      const buffer = await input.storage.read(sticker.storageKey);
      stickerHrefs.set(layer.id, `data:${sticker.mimeType};base64,${buffer.toString("base64")}`);

      continue;
    }

    if (layer.kind === "washiTape" && layer.pattern.kind === "customPhoto") {
      const assetId = layer.pattern.assetId ?? layer.assetId;

      if (!assetId) {
        continue;
      }

      const asset = input.repositories.assets.findByIdForAccount(input.accountId, assetId);

      if (!asset) {
        continue;
      }

      const buffer = await input.storage.read(asset.originalStorageKey);

      washiTapeHrefs.set(
        layer.id,
        await createImageDataUri({
          buffer,
          mimeType: asset.mimeType,
          settings,
          targetDimension: targetWashiTapeDimension(layer, settings),
        }),
      );
    }
  }

  const maps = await prepareMapLayers(
    input.document.layers.filter((layer): layer is MapLayer => layer.kind === "map"),
    input.mapTiles,
  );
  const backgroundHref =
    input.includeBackground === false ? undefined : await resolveBackgroundDataUri(input, settings);

  return renderPageDocumentSvg(input.document, {
    ...(input.includeBackground === undefined
      ? {}
      : { includeBackground: input.includeBackground }),
    resolveBackgroundHref: () => backgroundHref,
    resolveMapGeography: (detail) => maps.geography.get(detail),
    resolveMapTileHref: (tile) => maps.tileHrefs.get(mapTileKey(tile)),
    resolvePhotoHref: (layer: PhotoLayer) => photoHrefs.get(layer.id),
    resolveStickerSvg: (layer) =>
      isCustomStickerId(layer.stickerId) ? null : getStickerSvg(layer.stickerId),
    resolveStickerHref: (layer) => stickerHrefs.get(layer.id),
    resolveWashiTapeHref: (layer: WashiTapeLayer) => washiTapeHrefs.get(layer.id),
  });
};
