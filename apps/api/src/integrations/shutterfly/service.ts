import { editorFontDefinitions, defaultTextFontFamily, type StickerId } from "@zakka/editor-core";
import sharp from "sharp";

import { type AssetStorage, createAssetFromUpload } from "../../assets.js";
import { createCustomStickerFromUpload } from "../../custom-stickers.js";
import type { Repositories } from "../../persistence/repositories.js";
import type { BookRecord, IntegrationConnectionRecord } from "../../persistence/schema.js";
import type { CredentialCipher } from "../credential-cipher.js";
import {
  createShutterflyClient,
  normalizeShutterflyRefreshToken,
  parseShutterflyDate,
  ShutterflyAuthError,
  type ShutterflyClient,
  type ShutterflyMediaDetails,
  type ShutterflySession,
} from "./client.js";
import {
  collectShutterflyProjectReferences,
  mapShutterflyProject,
  type ShutterflyResolvedBackground,
} from "./map-project.js";
import {
  readMetadataValue,
  type ShutterflyDesignAsset,
  type ShutterflyProjectSummary,
} from "./schemas.js";

const provider = "shutterfly";
const stickerPackTitle = "Shutterfly";
const stickerPackSourceUrl = "https://www.shutterfly.com";
const sessionRefreshMarginMs = 5 * 60 * 1000;
const downloadConcurrency = 4;
const stickerRasterLongEdge = 1600;
const backgroundRasterLongEdge = 3600;
const rasterDesignFileTypes = new Set(["JPG", "JPEG", "PNG", "WEBP"]);

export class ShutterflyInvalidTokenError extends Error {
  constructor() {
    super("That does not look like a Shutterfly refresh token");
    this.name = "ShutterflyInvalidTokenError";
  }
}

export class ShutterflyNotConnectedError extends Error {
  constructor() {
    super("Connect your Shutterfly account in Settings first");
    this.name = "ShutterflyNotConnectedError";
  }
}

export class ShutterflyProjectNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShutterflyProjectNotSupportedError";
  }
}

export type ShutterflyConnectionStatus = {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
};

export type ShutterflyProjectListItem = {
  id: string;
  name: string;
  productName: string | null;
  thumbnailUrl: string | null;
  pageCount: number | null;
  updatedAt: string | null;
};

export type ShutterflyImportResult = {
  book: BookRecord;
  warnings: string[];
};

export type ShutterflyIntegration = ReturnType<typeof createShutterflyIntegration>;

type StoredCredentials = { refreshToken: string };

const normalizeFontName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const editorFontFamilies = new Set(editorFontDefinitions.map((font) => font.family));

const fontFamilyByName = new Map(
  editorFontDefinitions.flatMap((font) => [
    [normalizeFontName(font.family.split(",")[0] ?? font.family), font.family] as const,
    [normalizeFontName(font.label), font.family] as const,
  ]),
);

/** Finds the bundled Zakka font with the same name as a Shutterfly font, ignoring common foundry suffixes. */
export const matchZakkaFontFamily = (
  shutterflyFontName: string | null | undefined,
): string | null => {
  if (!shutterflyFontName) {
    return null;
  }

  // Zakka mirrors Shutterfly's font names, some of which differ only by spacing ("Anna Clara").
  if (editorFontFamilies.has(shutterflyFontName)) {
    return shutterflyFontName;
  }

  const candidates = [
    shutterflyFontName,
    shutterflyFontName.replace(/\b(pro|std|lt|com|regular|roman)\b/gi, ""),
  ];

  for (const candidate of candidates) {
    const family = fontFamilyByName.get(normalizeFontName(candidate));

    if (family) {
      return family;
    }
  }

  return null;
};

const maxFontReplacementHops = 5;

const fontReplacementId = (asset: ShutterflyDesignAsset | undefined): string | null =>
  asset?.assetType === "font" ? (asset.attributes?.validNewFontId ?? null) : null;

/**
 * Finds the Zakka font for a Shutterfly font asset. Retired Shutterfly fonts (often named
 * like "Mrs Eaves Roman - DUP2") are matched through the live font they were replaced with.
 */
export const matchShutterflyFontAsset = (
  assetId: string | null,
  designAssets: ReadonlyMap<string, ShutterflyDesignAsset>,
): string | null => {
  const chain: ShutterflyDesignAsset[] = [];
  let asset = assetId ? designAssets.get(assetId) : undefined;

  while (asset && !chain.includes(asset) && chain.length <= maxFontReplacementHops) {
    chain.push(asset);
    const replacementId = fontReplacementId(asset);
    asset = replacementId ? designAssets.get(replacementId) : undefined;
  }

  for (const candidate of chain.reverse()) {
    const family = matchZakkaFontFamily(candidate.name);

    if (family) {
      return family;
    }
  }

  return null;
};

const mapWithConcurrency = async <Input, Output>(
  inputs: readonly Input[],
  limit: number,
  worker: (input: Input) => Promise<Output>,
): Promise<Output[]> => {
  const results: Output[] = new Array(inputs.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, inputs.length) }, async () => {
      while (nextIndex < inputs.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(inputs[index] as Input);
      }
    }),
  );

  return results;
};

const isBookProject = (project: ShutterflyProjectSummary): boolean =>
  project.projectType?.group?.toLowerCase() === "books" ||
  project.productCategory?.toLowerCase() === "books";

const toProjectListItem = (project: ShutterflyProjectSummary): ShutterflyProjectListItem => {
  const pageCount = Number(readMetadataValue(project.projectMetadata, "PAGE_COUNT"));

  return {
    id: project._id,
    name: project.projectName,
    productName: project.projectType?.name ?? null,
    thumbnailUrl: project.thumbnailUrl ?? project.iconUrl ?? null,
    pageCount: Number.isInteger(pageCount) && pageCount > 0 ? pageCount : null,
    updatedAt: parseShutterflyDate(project.updateDate ?? project.createDate),
  };
};

const safeFileName = (value: string | null | undefined, fallback: string): string => {
  const cleaned = Array.from(value ?? "", (character) =>
    character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? "_" : character,
  )
    .join("")
    .trim();

  return cleaned.length > 0 ? cleaned.slice(0, 180) : fallback;
};

/** The signed render URL returns slightly upscaled images; shrink them back to Shutterfly's stored size. */
const fitToOriginalSize = async (
  buffer: Buffer,
  media: ShutterflyMediaDetails,
): Promise<Buffer> => {
  if (!media.width || !media.height) {
    return buffer;
  }

  const metadata = await sharp(buffer).metadata();

  if ((metadata.width ?? 0) <= media.width && (metadata.height ?? 0) <= media.height) {
    return buffer;
  }

  return sharp(buffer)
    .rotate()
    .resize({ width: media.width, height: media.height, fit: "inside" })
    .jpeg({ quality: 92 })
    .toBuffer();
};

const rasterizeSvg = async (svg: Buffer, targetLongEdge: number): Promise<Buffer> => {
  const metadata = await sharp(svg).metadata();
  const longEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0, 1);
  const density = Math.min(2400, Math.max(72, (72 * targetLongEdge) / longEdge));

  return sharp(svg, { density })
    .resize({ width: targetLongEdge, height: targetLongEdge, fit: "inside" })
    .png()
    .toBuffer();
};

const svgDrawingElementPattern =
  /<(rect|path|circle|ellipse|polygon|polyline|line|image|text|use|pattern|linearGradient|radialGradient)\b[^>]*>/gi;

const readSvgNumber = (element: string, attribute: string): number | null => {
  const match = new RegExp(`\\b${attribute}\\s*=\\s*"(-?[\\d.]+)`, "i").exec(element);

  return match?.[1] === undefined ? null : Number(match[1]);
};

/**
 * Many Shutterfly backgrounds are SVGs containing a single full-size rectangle. Returns that
 * rectangle's color so the importer can use a page background color instead of an image.
 */
export const readSolidSvgColor = (svg: string): string | null => {
  const drawings = svg.replace(/<!--[\s\S]*?-->/g, "").match(svgDrawingElementPattern) ?? [];
  const rect = drawings[0];

  if (drawings.length !== 1 || !rect || !/^<rect\b/i.test(rect)) {
    return null;
  }

  const viewBox = /\bviewBox\s*=\s*"([^"]+)"/i
    .exec(svg)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);

  if (viewBox?.length === 4) {
    const [minX = 0, minY = 0, width = 0, height = 0] = viewBox;
    const x = readSvgNumber(rect, "x") ?? 0;
    const y = readSvgNumber(rect, "y") ?? 0;
    const rectWidth = readSvgNumber(rect, "width") ?? 0;
    const rectHeight = readSvgNumber(rect, "height") ?? 0;

    if (
      x > minX + width * 0.01 ||
      y > minY + height * 0.01 ||
      x + rectWidth < minX + width * 0.99 ||
      y + rectHeight < minY + height * 0.99
    ) {
      return null;
    }
  }

  const fill =
    /\bfill\s*=\s*"(#[0-9a-f]{6})"/i.exec(rect)?.[1] ??
    /\bfill\s*:\s*(#[0-9a-f]{6})/i.exec(rect)?.[1];

  return fill?.toLowerCase() ?? null;
};

export const createShutterflyIntegration = (options: {
  apiKey: string;
  cipher: CredentialCipher;
  repositories: Repositories;
  storage?: AssetStorage | undefined;
  fetch?: typeof fetch;
  clock?: () => Date;
}) => {
  const client: ShutterflyClient = createShutterflyClient({
    apiKey: options.apiKey,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const clock = options.clock ?? (() => new Date());
  const sessions = new Map<string, ShutterflySession>();
  const { repositories } = options;

  const readConnection = (accountId: string): IntegrationConnectionRecord => {
    const connection = repositories.integrations.findConnection(accountId, provider);

    if (!connection) {
      throw new ShutterflyNotConnectedError();
    }

    return connection;
  };

  const storeSession = (accountId: string, session: ShutterflySession) => {
    sessions.set(accountId, session);
    repositories.integrations.upsertConnection({
      accountId,
      provider,
      externalAccountId: session.accountId,
      externalEmail: session.email,
      encryptedCredentials: options.cipher.encrypt(
        JSON.stringify({ refreshToken: session.refreshToken } satisfies StoredCredentials),
      ),
    });
  };

  const getSession = async (
    accountId: string,
    forceRefresh = false,
  ): Promise<ShutterflySession> => {
    const connection = readConnection(accountId);
    const cached = sessions.get(accountId);

    if (!forceRefresh && cached && cached.expiresAt - sessionRefreshMarginMs > clock().getTime()) {
      return cached;
    }

    const credentials = JSON.parse(
      options.cipher.decrypt(connection.encryptedCredentials),
    ) as StoredCredentials;
    const session = await client.refreshSession(credentials.refreshToken);

    // The user may have disconnected or reconnected while the refresh was in flight; never
    // resurrect a removed connection or cache a session for credentials that were replaced.
    const current = repositories.integrations.findConnection(accountId, provider);

    if (!current) {
      sessions.delete(accountId);
      throw new ShutterflyNotConnectedError();
    }

    if (current.encryptedCredentials !== connection.encryptedCredentials) {
      return getSession(accountId, true);
    }

    if (session.refreshToken !== credentials.refreshToken) {
      storeSession(accountId, session);
    } else {
      sessions.set(accountId, session);
    }

    return session;
  };

  /** Runs a Shutterfly call, refreshing the cached session once if Shutterfly rejects it. */
  const withSession = async <Output>(
    accountId: string,
    action: (session: ShutterflySession) => Promise<Output>,
  ): Promise<Output> => {
    try {
      return await action(await getSession(accountId));
    } catch (error) {
      if (!(error instanceof ShutterflyAuthError) || !sessions.has(accountId)) {
        throw error;
      }

      sessions.delete(accountId);

      return action(await getSession(accountId, true));
    }
  };

  const importPhoto = async (
    accountId: string,
    mediaId: string,
    media: ShutterflyMediaDetails | undefined,
  ): Promise<string | null> => {
    const externalId = `photo:${mediaId}`;
    const existing = repositories.integrations.findMediaLink(accountId, provider, externalId);

    if (existing?.assetId && repositories.assets.findByIdForAccount(accountId, existing.assetId)) {
      return existing.assetId;
    }

    if (!media || !options.storage) {
      return null;
    }

    try {
      const buffer = await fitToOriginalSize(await client.download(media.url), media);
      const { asset } = await createAssetFromUpload({
        accountId,
        file: new File([new Uint8Array(buffer)], safeFileName(media.fileName, `${mediaId}.jpg`), {
          type: "image/jpeg",
        }),
        repositories,
        storage: options.storage,
      });

      repositories.integrations.createMediaLink({
        accountId,
        provider,
        externalId,
        assetId: asset.id,
      });

      return asset.id;
    } catch {
      return null;
    }
  };

  const findOrCreateStickerPackId = (accountId: string): string => {
    const existing = repositories.stickerPacks
      .listForAccount(accountId)
      .find((pack) => pack.sourceUrl === stickerPackSourceUrl);

    return (
      existing?.id ??
      repositories.stickerPacks.create({
        accountId,
        title: stickerPackTitle,
        author: "Shutterfly",
        sourceUrl: stickerPackSourceUrl,
      }).id
    );
  };

  const downloadDesignImage = async (
    asset: ShutterflyDesignAsset,
    longEdge: number,
    printSvg?: Buffer | null,
  ): Promise<Buffer | null> => {
    const printFile = asset.files?.PRINT_RES;
    const printUrl = printFile?.location ? client.designFileUrl(printFile.location) : null;
    const printType = printFile?.fileType?.toUpperCase() ?? "";

    try {
      if (printSvg) {
        return await rasterizeSvg(printSvg, longEdge);
      }

      if (printUrl && printType === "SVG") {
        return await rasterizeSvg(await client.download(printUrl), longEdge);
      }

      if (printUrl && rasterDesignFileTypes.has(printType)) {
        return await sharp(await client.download(printUrl))
          .resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true })
          .png()
          .toBuffer();
      }
    } catch {
      // Fall back to the catalog preview below.
    }

    if (!asset.preview) {
      return null;
    }

    try {
      return await sharp(await client.download(asset.preview))
        .png()
        .toBuffer();
    } catch {
      return null;
    }
  };

  const importSticker = async (
    accountId: string,
    asset: ShutterflyDesignAsset | undefined,
    getPackId: () => string,
  ): Promise<StickerId | null> => {
    if (!asset || !options.storage) {
      return null;
    }

    const externalId = `design:${asset.id}`;
    const existing = repositories.integrations.findMediaLink(accountId, provider, externalId);

    if (
      existing?.customStickerId &&
      repositories.stickerPacks.findStickerByIdForAccount(accountId, existing.customStickerId)
    ) {
      return `custom:${existing.customStickerId}`;
    }

    const png = await downloadDesignImage(asset, stickerRasterLongEdge);

    if (!png) {
      return null;
    }

    try {
      const sticker = await createCustomStickerFromUpload({
        accountId,
        packId: getPackId(),
        file: new File([new Uint8Array(png)], `${safeFileName(asset.name, asset.id)}.png`, {
          type: "image/png",
        }),
        name: (asset.name ?? asset.id).slice(0, 120),
        repositories,
        storage: options.storage,
      });

      repositories.integrations.createMediaLink({
        accountId,
        provider,
        externalId,
        customStickerId: sticker.id,
      });

      return `custom:${sticker.id}`;
    } catch {
      return null;
    }
  };

  const importBackground = async (
    accountId: string,
    asset: ShutterflyDesignAsset | undefined,
  ): Promise<ShutterflyResolvedBackground | null> => {
    if (!asset) {
      return null;
    }

    const printFile = asset.files?.PRINT_RES;
    const printUrl = printFile?.location ? client.designFileUrl(printFile.location) : null;
    const printSvg =
      printUrl && printFile?.fileType?.toUpperCase() === "SVG"
        ? await client.download(printUrl).catch(() => null)
        : null;
    const color = printSvg ? readSolidSvgColor(printSvg.toString("utf8")) : null;

    if (color) {
      return { kind: "color", color };
    }

    if (!options.storage) {
      return null;
    }

    const externalId = `design:${asset.id}`;
    const existing = repositories.integrations.findMediaLink(accountId, provider, externalId);

    if (existing?.assetId && repositories.assets.findByIdForAccount(accountId, existing.assetId)) {
      return { kind: "image", assetId: existing.assetId };
    }

    const png = await downloadDesignImage(asset, backgroundRasterLongEdge, printSvg);

    if (!png) {
      return null;
    }

    try {
      const { asset: zakkaAsset } = await createAssetFromUpload({
        accountId,
        file: new File([new Uint8Array(png)], `${safeFileName(asset.name, asset.id)}.png`, {
          type: "image/png",
        }),
        repositories,
        storage: options.storage,
      });

      repositories.integrations.createMediaLink({
        accountId,
        provider,
        externalId,
        assetId: zakkaAsset.id,
      });

      return { kind: "image", assetId: zakkaAsset.id };
    } catch {
      return null;
    }
  };

  return {
    getStatus: (accountId: string): ShutterflyConnectionStatus => {
      const connection = repositories.integrations.findConnection(accountId, provider);

      return {
        connected: connection !== null,
        email: connection?.externalEmail ?? null,
        connectedAt: connection?.createdAt ?? null,
      };
    },

    connect: async (
      accountId: string,
      refreshTokenInput: string,
    ): Promise<ShutterflyConnectionStatus> => {
      const refreshToken = normalizeShutterflyRefreshToken(refreshTokenInput);

      if (!refreshToken) {
        throw new ShutterflyInvalidTokenError();
      }

      storeSession(accountId, await client.refreshSession(refreshToken));

      const connection = readConnection(accountId);

      return {
        connected: true,
        email: connection.externalEmail,
        connectedAt: connection.createdAt,
      };
    },

    disconnect: (accountId: string): boolean => {
      sessions.delete(accountId);

      return repositories.integrations.deleteConnection(accountId, provider);
    },

    listProjects: async (accountId: string): Promise<ShutterflyProjectListItem[]> =>
      (await withSession(accountId, (session) => client.listProjects(session)))
        .filter(isBookProject)
        .map(toProjectListItem),

    importProject: async (
      accountId: string,
      projectId: string,
    ): Promise<ShutterflyImportResult> => {
      const project = await withSession(accountId, (session) =>
        client.getProject(session, projectId),
      );

      if (!isBookProject(project)) {
        throw new ShutterflyProjectNotSupportedError("Only Shutterfly photo books can be imported");
      }

      const references = collectShutterflyProjectReferences(project);
      const mediaDetails = references.photos.length
        ? await withSession(accountId, (session) =>
            client.getMediaDetails(session, references.photos),
          )
        : new Map<string, ShutterflyMediaDetails>();
      const designAssetIds = [
        ...references.fontAssetIds,
        ...references.stickerAssetIds,
        ...references.backgroundAssetIds,
      ];
      const designAssets = designAssetIds.length
        ? await withSession(accountId, (session) => client.getDesignAssets(session, designAssetIds))
        : new Map<string, ShutterflyDesignAsset>();

      // The catalog can omit a replacement, so remember every requested id to fetch each once.
      const requestedDesignAssetIds = new Set(designAssetIds);

      for (let hop = 0; hop < maxFontReplacementHops; hop += 1) {
        const replacementIds = [
          ...new Set(
            [...designAssets.values()]
              .map(fontReplacementId)
              .filter((id): id is string => id !== null && !requestedDesignAssetIds.has(id)),
          ),
        ];

        if (replacementIds.length === 0) {
          break;
        }

        for (const id of replacementIds) {
          requestedDesignAssetIds.add(id);
        }

        const replacements = await withSession(accountId, (session) =>
          client.getDesignAssets(session, replacementIds),
        );

        for (const [id, asset] of replacements) {
          designAssets.set(id, asset);
        }
      }

      const photoAssetIds = new Map(
        await mapWithConcurrency(
          references.photos,
          downloadConcurrency,
          async (photo) =>
            [
              photo.mediaId,
              await importPhoto(accountId, photo.mediaId, mediaDetails.get(photo.mediaId)),
            ] as const,
        ),
      );
      let stickerPackId: string | null = null;
      const getPackId = () => {
        stickerPackId ??= findOrCreateStickerPackId(accountId);
        return stickerPackId;
      };
      const stickerIds = new Map(
        await mapWithConcurrency(
          references.stickerAssetIds,
          downloadConcurrency,
          async (id) =>
            [id, await importSticker(accountId, designAssets.get(id), getPackId)] as const,
        ),
      );
      const backgrounds = new Map(
        await mapWithConcurrency(
          references.backgroundAssetIds,
          downloadConcurrency,
          async (id) => [id, await importBackground(accountId, designAssets.get(id))] as const,
        ),
      );

      let mapped: ReturnType<typeof mapShutterflyProject>;

      try {
        mapped = mapShutterflyProject(project, {
          photoAssetId: (mediaId) => photoAssetIds.get(mediaId) ?? null,
          stickerId: (id) => stickerIds.get(id) ?? null,
          background: (id) => backgrounds.get(id) ?? null,
          fontFamily: (id) => {
            const family = matchShutterflyFontAsset(id, designAssets);

            return family
              ? { family, matched: true }
              : { family: defaultTextFontFamily, matched: false };
          },
        });
      } catch (error) {
        throw new ShutterflyProjectNotSupportedError(
          error instanceof Error ? error.message : "This Shutterfly project cannot be imported",
        );
      }

      const book = repositories.books.create({
        accountId,
        title: mapped.title,
        pageWidth: mapped.pageWidth,
        pageHeight: mapped.pageHeight,
        coverSpreadEnabled: true,
      });

      for (const [sortOrder, page] of mapped.pages.entries()) {
        const record = repositories.pages.create({
          accountId,
          title: page.title,
          width: mapped.pageWidth,
          height: mapped.pageHeight,
          documentJson: JSON.stringify(page.document),
        });

        repositories.books.addPage({ accountId, bookId: book.id, pageId: record.id, sortOrder });
      }

      const importedAssetIds = [
        ...photoAssetIds.values(),
        ...[...backgrounds.values()].map((background) =>
          background?.kind === "image" ? background.assetId : null,
        ),
      ].filter((assetId): assetId is string => assetId !== null);

      if (importedAssetIds.length > 0) {
        repositories.books.addAssetsToBook({
          accountId,
          bookId: book.id,
          assetIds: importedAssetIds,
        });
      }

      return { book, warnings: mapped.warnings };
    },
  };
};
