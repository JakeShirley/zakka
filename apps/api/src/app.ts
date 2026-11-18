import { createRequire } from "node:module";
import { Readable } from "node:stream";

import { OpenAPIHono } from "@hono/zod-openapi";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  type AccessTokenResponse,
  type AccountPreferencesResponse,
  type AccountResponse,
  type AlbumResponse,
  type AssetResponse,
  type AuthSessionResponse,
  accessTokenCreateResponseSchema,
  accessTokenCreateRoute,
  accessTokenDeleteRoute,
  accessTokenListResponseSchema,
  accessTokenListRoute,
  accessTokenResponseSchema,
  accountPreferencesPatchRoute,
  accountPreferencesResponseSchema,
  accountPreferencesRoute,
  albumAssetListRoute,
  albumAssetRemoveRoute,
  albumAssetsAddRoute,
  albumCreateRoute,
  albumDeleteRoute,
  albumDetailRoute,
  albumListResponseSchema,
  albumListRoute,
  albumPatchRoute,
  albumResponseSchema,
  assetAlbumsListRoute,
  assetDetailRoute,
  assetListResponseSchema,
  assetListRoute,
  assetOriginalContentRoute,
  assetResponseSchema,
  assetUploadRoute,
  assetVariantContentRoute,
  authSessionResponseSchema,
  type BookPageResponse,
  type BookResponse,
  type BookSummaryResponse,
  bookAssetListRoute,
  bookAssetRemoveRoute,
  bookAssetsAddRoute,
  bookCreateRoute,
  bookDeleteRoute,
  bookDetailRoute,
  bookListResponseSchema,
  bookListRoute,
  bookPatchRoute,
  bookResponseSchema,
  bookSetPagesRoute,
  bookSummaryResponseSchema,
  builtInBackgroundContentRoute,
  builtInBackgroundThumbnailRoute,
  type CustomBackgroundResponse,
  type CustomStickerResponse,
  type CustomWashiTapeResponse,
  currentSessionRoute,
  customBackgroundContentRoute,
  customBackgroundDeleteRoute,
  customBackgroundListResponseSchema,
  customBackgroundListRoute,
  customBackgroundPatchRoute,
  customBackgroundResponseSchema,
  customBackgroundThumbnailRoute,
  customBackgroundUploadRoute,
  customStickerContentRoute,
  customStickerFavoriteRoute,
  customStickerListResponseSchema,
  customStickerListRoute,
  customStickerResponseSchema,
  customWashiTapeCreateRoute,
  customWashiTapeDeleteRoute,
  customWashiTapeListResponseSchema,
  customWashiTapeListRoute,
  customWashiTapePatchRoute,
  customWashiTapeResponseSchema,
  defaultBookPageSize,
  defaultUiThemePreference,
  type ErrorResponse,
  type ExportJobResponse,
  exportContentRoute,
  exportCreateRoute,
  exportDetailRoute,
  exportJobResponseSchema,
  healthResponseSchema,
  healthRoute,
  isUiThemePreference,
  loginRoute,
  logoutRoute,
  mapTileRoute,
  mcpEndpointPath,
  type PageResponse,
  type PageSummaryResponse,
  pageCreateRoute,
  pageDeleteRoute,
  pageDetailRoute,
  pageDuplicateRoute,
  pageListResponseSchema,
  pageListRoute,
  pagePatchRoute,
  pageResponseSchema,
  pageSummaryResponseSchema,
  registerRoute,
  type ServerLogEntryResponse,
  type ServerLogLevel,
  type SessionResponse,
  type ShutterflyImportResponse,
  type StickerPackResponse,
  serverLogEntryResponseSchema,
  serverLogListResponseSchema,
  serverLogListRoute,
  shutterflyArchiveDeleteRoute,
  shutterflyArchiveDownloadRoute,
  shutterflyArchiveListResponseSchema,
  shutterflyArchiveListRoute,
  shutterflyArchiveResponseSchema,
  shutterflyArchiveResumeRoute,
  shutterflyArchiveRoute,
  shutterflyArchiveStartRoute,
  shutterflyConnectionResponseSchema,
  shutterflyConnectionRoute,
  shutterflyConnectRoute,
  shutterflyDisconnectRoute,
  shutterflyImportJobResponseSchema,
  shutterflyImportJobRoute,
  shutterflyImportResponseSchema,
  shutterflyProjectImportJobRoute,
  shutterflyProjectImportRoute,
  shutterflyProjectListResponseSchema,
  shutterflyProjectListRoute,
  stickerPackCreateRoute,
  stickerPackDeleteRoute,
  stickerPackDetailRoute,
  stickerPackListResponseSchema,
  stickerPackListRoute,
  stickerPackPatchRoute,
  stickerPackResponseSchema,
  stickerPackStickerListRoute,
  stickerPackStickerRemoveRoute,
  stickerPackStickerUploadRoute,
  systemInfoResponseSchema,
  systemInfoRoute,
} from "@zakka/api-contract";
import {
  createBookSpreads,
  createPageDocument,
  toCustomBackgroundId,
  washiTapeDesignSchema,
} from "@zakka/editor-core";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  type AssetStorage,
  AssetUploadError,
  browserNativeImageMimeTypes,
  createAssetFromUpload,
  ensureBrowserPreviewVariant,
} from "./assets.js";
import {
  createAccessTokenSecret,
  createSessionCookieValue,
  createSessionSecret,
  defaultSessionTtlMs,
  hashAccessTokenSecret,
  hashPassword,
  hashSessionSecret,
  normalizeEmail,
  parseBearerAccessToken,
  parseSessionCookieValue,
  sessionCookieName,
  verifyPassword,
} from "./auth.js";
import {
  CustomBackgroundUploadError,
  createCustomBackgroundFromUpload,
  deleteCustomBackground,
  readBuiltInBackgroundTexture,
} from "./custom-backgrounds.js";
import { CustomStickerUploadError, createCustomStickerFromUpload } from "./custom-stickers.js";
import {
  ExportRenderError,
  getExportContentType,
  getExportDownloadFilename,
  runExportJob,
} from "./exports.js";
import { CredentialDecryptError } from "./integrations/credential-cipher.js";
import {
  createShutterflyArchives,
  ShutterflyArchiveBusyError,
  ShutterflyArchiveNotFoundError,
} from "./integrations/shutterfly/archive-jobs.js";
import { ShutterflyAuthError, ShutterflyRequestError } from "./integrations/shutterfly/client.js";
import {
  createShutterflyImportJobs,
  type ShutterflyImportJob,
} from "./integrations/shutterfly/import-jobs.js";
import {
  type ShutterflyIntegration,
  ShutterflyInvalidTokenError,
  ShutterflyNotConnectedError,
  ShutterflyProjectNotSupportedError,
} from "./integrations/shutterfly/service.js";
import {
  createBookWithCovers,
  parseStoredPageDocument,
  validatePageDocumentAssets,
} from "./library.js";
import { isMapTileInRange, type MapTileImage, type MapTileSource } from "./map-tiles.js";
import type { McpShutterflyAccess } from "./mcp/integration-tools.js";
import { createZakkaMcpServer, maxMcpRequestByteSize } from "./mcp/server.js";
import type {
  AlbumWithCountRecord,
  StickerPackWithCountRecord,
} from "./persistence/repositories.js";
import {
  OwnershipError,
  type Repositories,
  type RepositoryClock,
} from "./persistence/repositories.js";
import type {
  AccessTokenRecord,
  AccountPreferencesRecord,
  AccountRecord,
  AssetRecord,
  AssetVariantRecord,
  BookPageRecord,
  BookRecord,
  CustomBackgroundRecord,
  CustomStickerRecord,
  CustomWashiTapeRecord,
  ExportJobRecord,
  PageRecord,
  SessionRecord,
} from "./persistence/schema.js";
import { readStaticAsset } from "./static.js";
import { validateWashiTapeDesign, washiTapeDesignErrorMessages } from "./washi-tapes.js";
import { createZipStream } from "./zip-stream.js";

type ApiBindings = {
  Variables: {
    requestId: string;
  };
};

const readPackageVersion = (): string => {
  const packageJson = createRequire(import.meta.url)("../package.json") as { version?: unknown };

  return typeof packageJson.version === "string" && packageJson.version.length > 0
    ? packageJson.version
    : "0.0.0-development";
};

const packageVersion = readPackageVersion();
const maxServerLogEntries = 500;
const serverLogLevelRank: Record<ServerLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type CreateAppOptions = {
  repositories?: Repositories;
  storage?: AssetStorage;
  clock?: RepositoryClock;
  sessionCookieSecure?: boolean;
  sessionTtlMs?: number;
  staticAssetsDir?: string;
  /** Present only when SHUTTERFLY_API_KEY is configured. */
  shutterfly?: ShutterflyIntegration;
  /** Where Shutterfly account archives are built; archiving is unavailable without it. */
  shutterflyArchiveDir?: string;
  /** Proxies and caches raster tiles for tile-style map layers. */
  mapTiles?: MapTileSource;
};

type ApiContext = Context<ApiBindings>;

type AuthenticatedSession = {
  account: AccountRecord;
  session: SessionRecord;
};

type ServerLogEntryInput = Omit<ServerLogEntryResponse, "id" | "timestamp">;

const defaultClock: RepositoryClock = () => new Date();

const readForwardedProto = (context: ApiContext): string | null => {
  const forwardedProto = context.req.header("x-forwarded-proto");

  return forwardedProto?.split(",")[0]?.trim().toLowerCase() || null;
};

const requestUsesHttps = (context: ApiContext): boolean =>
  readForwardedProto(context) === "https" || new URL(context.req.url).protocol === "https:";

const resolveSessionCookieSecure = (
  context: ApiContext,
  sessionCookieSecure: CreateAppOptions["sessionCookieSecure"],
): boolean => sessionCookieSecure ?? requestUsesHttps(context);

const getRequestPath = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

const getRequestLogLevel = (status: number): ServerLogLevel => {
  if (status >= 500) {
    return "error";
  }

  if (status >= 400) {
    return "warn";
  }

  return "info";
};

const appendServerLogEntry = (
  entries: ServerLogEntryResponse[],
  clock: RepositoryClock,
  input: ServerLogEntryInput,
) => {
  entries.push(
    serverLogEntryResponseSchema.parse({
      ...input,
      id: crypto.randomUUID(),
      timestamp: clock().toISOString(),
    }),
  );

  if (entries.length > maxServerLogEntries) {
    entries.splice(0, entries.length - maxServerLogEntries);
  }
};

const createErrorResponse = (
  context: ApiContext,
  code: string,
  message: string,
): ErrorResponse => ({
  error: {
    code,
    message,
    requestId: context.get("requestId"),
  },
});

const toAccountResponse = (account: AccountRecord): AccountResponse => ({
  id: account.id,
  displayName: account.displayName,
  primaryEmail: account.primaryEmail,
});

const toSessionResponse = (session: SessionRecord): SessionResponse => ({
  id: session.id,
  expiresAt: session.expiresAt,
  createdAt: session.createdAt,
});

const toAuthSessionResponse = (authSession: AuthenticatedSession): AuthSessionResponse =>
  authSessionResponseSchema.parse({
    account: toAccountResponse(authSession.account),
    session: toSessionResponse(authSession.session),
  });

const toAccountPreferencesResponse = (
  preferences: Pick<AccountPreferencesRecord, "uiTheme"> | null,
): AccountPreferencesResponse =>
  accountPreferencesResponseSchema.parse({
    uiTheme: isUiThemePreference(preferences?.uiTheme)
      ? preferences.uiTheme
      : defaultUiThemePreference,
  });

const toAccessTokenResponse = (token: AccessTokenRecord): AccessTokenResponse =>
  accessTokenResponseSchema.parse({
    id: token.id,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    lastUsedAt: token.lastUsedAt,
    createdAt: token.createdAt,
  });

const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

const buildAssetOriginalContentUrl = (assetId: string): string =>
  `/api/v1/assets/${assetId}/content`;

const buildAssetVariantContentUrl = (assetId: string, variantId: string): string =>
  `/api/v1/assets/${assetId}/variants/${variantId}`;

const toAssetResponse = (asset: AssetRecord, variants: AssetVariantRecord[]): AssetResponse => {
  const thumbnail = variants.find((variant) => variant.kind === "thumbnail");

  return assetResponseSchema.parse({
    id: asset.id,
    byteSize: asset.byteSize,
    checksumSha256: asset.checksumSha256,
    createdAt: asset.createdAt,
    dateTaken: asset.dateTaken,
    cameraMake: asset.cameraMake,
    cameraModel: asset.cameraModel,
    lensModel: asset.lensModel,
    isoSpeed: asset.isoSpeed,
    fNumber: asset.fNumber,
    exposureTimeSeconds: asset.exposureTimeSeconds,
    focalLengthMm: asset.focalLengthMm,
    focalLength35mmMm: asset.focalLength35mmMm,
    orientation: asset.orientation,
    gpsLatitude: asset.gpsLatitude,
    gpsLongitude: asset.gpsLongitude,
    gpsAltitudeMeters: asset.gpsAltitudeMeters,
    height: asset.height,
    mimeType: asset.mimeType,
    originalContentUrl: buildAssetOriginalContentUrl(asset.id),
    originalFilename: asset.originalFilename,
    thumbnailUrl: thumbnail ? buildAssetVariantContentUrl(asset.id, thumbnail.id) : null,
    updatedAt: asset.updatedAt,
    variants: variants.map((variant) => ({
      id: variant.id,
      assetId: variant.assetId,
      byteSize: variant.byteSize,
      checksumSha256: variant.checksumSha256,
      contentUrl: buildAssetVariantContentUrl(asset.id, variant.id),
      createdAt: variant.createdAt,
      height: variant.height,
      kind: variant.kind,
      mimeType: variant.mimeType,
      updatedAt: variant.updatedAt,
      width: variant.width,
    })),
    width: asset.width,
  });
};

const listAssetVariantsForResponse = async (input: {
  accountId: string;
  asset: AssetRecord;
  repositories: Repositories;
  storage: AssetStorage | undefined;
}): Promise<AssetVariantRecord[]> => {
  const variants = input.repositories.assets.listVariantsForAsset(input.accountId, input.asset.id);

  if (
    !input.storage ||
    browserNativeImageMimeTypes.has(input.asset.mimeType) ||
    variants.some((variant) => variant.kind === "preview")
  ) {
    return variants;
  }

  const preview = await ensureBrowserPreviewVariant({
    accountId: input.accountId,
    asset: input.asset,
    repositories: input.repositories,
    storage: input.storage,
  });

  return [...variants, preview];
};

const toPageSummaryResponse = (page: PageRecord): PageSummaryResponse => {
  const document = parseStoredPageDocument(page);

  return pageSummaryResponseSchema.parse({
    id: page.id,
    title: page.title,
    width: page.width,
    height: page.height,
    layerCount: document.layers.length,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  });
};

const toPageResponse = (page: PageRecord): PageResponse => {
  const document = parseStoredPageDocument(page);

  return pageResponseSchema.parse({
    ...toPageSummaryResponse(page),
    document,
  });
};

const toBookPageResponse = (bookPage: BookPageRecord, page: PageRecord): BookPageResponse => ({
  id: bookPage.id,
  bookId: bookPage.bookId,
  pageId: bookPage.pageId,
  sortOrder: bookPage.sortOrder,
  page: toPageSummaryResponse(page),
  createdAt: bookPage.createdAt,
  updatedAt: bookPage.updatedAt,
});

const toAlbumResponse = (album: AlbumWithCountRecord): AlbumResponse =>
  albumResponseSchema.parse({
    id: album.id,
    title: album.title,
    photoCount: album.photoCount,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
  });

const buildCustomStickerContentUrl = (stickerId: string): string =>
  `/api/v1/custom-stickers/${stickerId}/content`;

const toStickerPackResponse = (pack: StickerPackWithCountRecord): StickerPackResponse =>
  stickerPackResponseSchema.parse({
    id: pack.id,
    title: pack.title,
    author: pack.author,
    sourceUrl: pack.sourceUrl,
    stickerCount: pack.stickerCount,
    createdAt: pack.createdAt,
    updatedAt: pack.updatedAt,
  });

const toCustomStickerResponse = (sticker: CustomStickerRecord): CustomStickerResponse =>
  customStickerResponseSchema.parse({
    id: sticker.id,
    packId: sticker.packId,
    name: sticker.name,
    mimeType: sticker.mimeType,
    byteSize: sticker.byteSize,
    width: sticker.width,
    height: sticker.height,
    isFavorite: sticker.isFavorite,
    contentUrl: buildCustomStickerContentUrl(sticker.id),
    createdAt: sticker.createdAt,
    updatedAt: sticker.updatedAt,
  });

const toCustomWashiTapeResponse = (washiTape: CustomWashiTapeRecord): CustomWashiTapeResponse =>
  customWashiTapeResponseSchema.parse({
    id: washiTape.id,
    name: washiTape.name,
    design: washiTapeDesignSchema.parse(JSON.parse(washiTape.designJson)),
    createdAt: washiTape.createdAt,
    updatedAt: washiTape.updatedAt,
  });

const toCustomBackgroundResponse = (background: CustomBackgroundRecord): CustomBackgroundResponse =>
  customBackgroundResponseSchema.parse({
    id: background.id,
    backgroundId: toCustomBackgroundId(background.id),
    name: background.name,
    mimeType: background.mimeType,
    byteSize: background.byteSize,
    width: background.width,
    height: background.height,
    source: background.source,
    contentUrl: `/api/v1/custom-backgrounds/${background.id}/content`,
    thumbnailUrl: `/api/v1/custom-backgrounds/${background.id}/thumbnail`,
    createdAt: background.createdAt,
    updatedAt: background.updatedAt,
  });

const toBookSummaryResponse = (
  book: BookRecord,
  pages: Array<{ bookPage: BookPageRecord; page: PageRecord }>,
): BookSummaryResponse =>
  bookSummaryResponseSchema.parse({
    id: book.id,
    title: book.title,
    pageWidth: book.pageWidth,
    pageHeight: book.pageHeight,
    coverSpreadEnabled: book.coverSpreadEnabled,
    pageCount: pages.length,
    spreadCount: createBookSpreads(
      pages.map(({ bookPage }) => ({ pageId: bookPage.pageId, sortOrder: bookPage.sortOrder })),
      { coverSpreadEnabled: book.coverSpreadEnabled },
    ).length,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  });

const toBookResponse = (book: BookRecord, repositories: Repositories): BookResponse => {
  const pages = repositories.books.listPagesForBook(book.accountId, book.id);
  const spreads = createBookSpreads(
    pages.map(({ bookPage }) => ({ pageId: bookPage.pageId, sortOrder: bookPage.sortOrder })),
    { coverSpreadEnabled: book.coverSpreadEnabled },
  );

  return bookResponseSchema.parse({
    ...toBookSummaryResponse(book, pages),
    pages: pages.map(({ bookPage, page }) => toBookPageResponse(bookPage, page)),
    spreads,
  });
};

const buildExportContentUrl = (exportId: string): string => `/api/v1/exports/${exportId}/content`;

const toExportJobResponse = (exportJob: ExportJobRecord): ExportJobResponse =>
  exportJobResponseSchema.parse({
    id: exportJob.id,
    status: exportJob.status,
    format: exportJob.format,
    preset: exportJob.preset,
    targetKind: exportJob.pageId ? "page" : "book",
    pageId: exportJob.pageId,
    bookId: exportJob.bookId,
    outputContentUrl:
      exportJob.status === "completed" && exportJob.outputStorageKey
        ? buildExportContentUrl(exportJob.id)
        : null,
    errorMessage: exportJob.errorMessage,
    createdAt: exportJob.createdAt,
    updatedAt: exportJob.updatedAt,
  });

const readClientIp = (context: ApiContext): string | null => {
  const forwardedFor = context.req.header("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  return context.req.header("x-real-ip") ?? null;
};

const startBrowserSession = (
  context: ApiContext,
  accountId: string,
  options: Required<Pick<CreateAppOptions, "clock" | "sessionTtlMs">> & {
    repositories: Repositories;
    sessionCookieSecure: CreateAppOptions["sessionCookieSecure"];
  },
): SessionRecord => {
  const secret = createSessionSecret();
  const expiresAt = new Date(options.clock().getTime() + options.sessionTtlMs).toISOString();
  const session = options.repositories.sessions.create({
    accountId,
    secretHash: hashSessionSecret(secret),
    expiresAt,
    userAgent: context.req.header("user-agent") ?? null,
    ipAddress: readClientIp(context),
  });

  setCookie(
    context,
    sessionCookieName,
    createSessionCookieValue({ sessionId: session.id, secret }),
    {
      expires: new Date(expiresAt),
      httpOnly: true,
      path: "/",
      sameSite: "Lax",
      secure: resolveSessionCookieSecure(context, options.sessionCookieSecure),
    },
  );

  return session;
};

const getAuthenticatedSession = (
  context: ApiContext,
  repositories: Repositories,
): AuthenticatedSession | null => {
  const cookieParts = parseSessionCookieValue(getCookie(context, sessionCookieName));

  if (!cookieParts) {
    return null;
  }

  const session = repositories.sessions.findActiveById(cookieParts.sessionId);

  if (!session || session.secretHash !== hashSessionSecret(cookieParts.secret)) {
    return null;
  }

  const account = repositories.accounts.findById(session.accountId);

  if (!account) {
    return null;
  }

  return { account, session };
};

export const createApp = (createOptions: CreateAppOptions = {}) => {
  const app = new OpenAPIHono<ApiBindings>();
  const serverLogEntries: ServerLogEntryResponse[] = [];
  const options = {
    clock: createOptions.clock ?? defaultClock,
    mapTiles: createOptions.mapTiles,
    repositories: createOptions.repositories,
    sessionCookieSecure: createOptions.sessionCookieSecure,
    sessionTtlMs: createOptions.sessionTtlMs ?? defaultSessionTtlMs,
    shutterfly: createOptions.shutterfly,
    shutterflyArchiveDir: createOptions.shutterflyArchiveDir,
    staticAssetsDir: createOptions.staticAssetsDir,
    storage: createOptions.storage,
  };
  const startedAt = options.clock();

  const listServerLogs = (level: ServerLogLevel, limit: number) => {
    const minimumRank = serverLogLevelRank[level];

    return serverLogEntries
      .filter((entry) => serverLogLevelRank[entry.level] >= minimumRank)
      .slice(-limit)
      .reverse();
  };

  const getSystemInfo = () =>
    systemInfoResponseSchema.parse({
      service: "zakka-api",
      version: packageVersion,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.max(
        0,
        Math.floor((options.clock().getTime() - startedAt.getTime()) / 1000),
      ),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    });

  app.use("*", async (context, next) => {
    const requestId = context.req.header("x-request-id") ?? crypto.randomUUID();
    const startedAt = performance.now();
    const path = getRequestPath(context.req.url);

    context.set("requestId", requestId);
    try {
      await next();
    } catch (error) {
      appendServerLogEntry(serverLogEntries, options.clock, {
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
        level: "error",
        message: error instanceof Error ? error.message : "Unhandled server error",
        method: context.req.method,
        path,
        requestId,
        status: 500,
      });
      throw error;
    } finally {
      context.header("x-request-id", requestId);
    }

    const status = context.res.status;
    appendServerLogEntry(serverLogEntries, options.clock, {
      durationMs: Number((performance.now() - startedAt).toFixed(1)),
      level: getRequestLogLevel(status),
      message: `${context.req.method} ${path} completed with ${status}`,
      method: context.req.method,
      path,
      requestId,
      status,
    });
  });

  app.openapi(healthRoute, (context) => {
    const body = healthResponseSchema.parse({
      status: "ok",
      service: "zakka-api",
      version: packageVersion,
      timestamp: new Date().toISOString(),
    });

    return context.json(body, 200);
  });

  app.openapi(serverLogListRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "auth_unavailable", "Auth is unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { level, limit } = context.req.valid("query");

    return context.json(
      serverLogListResponseSchema.parse({ level, logs: listServerLogs(level, limit) }),
      200,
    );
  });

  app.openapi(systemInfoRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "auth_unavailable", "Auth is unavailable"),
        500,
      );
    }

    if (!getAuthenticatedSession(context, options.repositories)) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    return context.json(getSystemInfo(), 200);
  });

  app.openapi(registerRoute, async (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "auth_unavailable", "Auth is unavailable"),
        500,
      );
    }

    const input = context.req.valid("json");
    const email = normalizeEmail(input.email);
    const displayName = input.displayName.trim();
    const existingAccount = options.repositories.accounts.findByPrimaryEmail(email);
    const existingIdentity = options.repositories.authIdentities.findByProviderSubject(
      "email_password",
      email,
    );

    if (existingAccount || existingIdentity) {
      return context.json(
        createErrorResponse(
          context,
          "email_already_registered",
          "An account already exists for this email",
        ),
        409,
      );
    }

    const account = options.repositories.accounts.create({ displayName, primaryEmail: email });
    options.repositories.authIdentities.create({
      accountId: account.id,
      provider: "email_password",
      providerSubject: email,
      passwordHash: await hashPassword(input.password),
    });
    const session = startBrowserSession(context, account.id, {
      ...options,
      repositories: options.repositories,
    });

    return context.json(toAuthSessionResponse({ account, session }), 201);
  });

  app.openapi(loginRoute, async (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "auth_unavailable", "Auth is unavailable"),
        500,
      );
    }

    const input = context.req.valid("json");
    const email = normalizeEmail(input.email);
    const identity = options.repositories.authIdentities.findByProviderSubject(
      "email_password",
      email,
    );
    const account = identity ? options.repositories.accounts.findById(identity.accountId) : null;
    const passwordMatches = identity?.passwordHash
      ? await verifyPassword(input.password, identity.passwordHash)
      : false;

    if (!identity || !account || !passwordMatches) {
      return context.json(
        createErrorResponse(context, "invalid_credentials", "Email or password is incorrect"),
        401,
      );
    }

    const session = startBrowserSession(context, account.id, {
      ...options,
      repositories: options.repositories,
    });

    return context.json(toAuthSessionResponse({ account, session }), 200);
  });

  app.openapi(currentSessionRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "auth_unavailable", "Auth is unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    return context.json(toAuthSessionResponse(authSession), 200);
  });

  app.openapi(logoutRoute, (context) => {
    if (options.repositories) {
      const authSession = getAuthenticatedSession(context, options.repositories);

      if (authSession) {
        options.repositories.sessions.revokeByIdForAccount(
          authSession.account.id,
          authSession.session.id,
        );
      }
    }

    deleteCookie(context, sessionCookieName, { path: "/" });

    return context.body(null, 204);
  });

  app.openapi(accountPreferencesRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "auth_unavailable", "Auth is unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    return context.json(
      toAccountPreferencesResponse(
        options.repositories.accountPreferences.findByAccountId(authSession.account.id),
      ),
      200,
    );
  });

  app.openapi(accountPreferencesPatchRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "auth_unavailable", "Auth is unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const input = context.req.valid("json");
    const record = options.repositories.accountPreferences.upsert(authSession.account.id, {
      ...(input.uiTheme ? { uiTheme: input.uiTheme } : {}),
    });

    return context.json(toAccountPreferencesResponse(record), 200);
  });

  app.openapi(accessTokenListRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "auth_unavailable", "Auth is unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const tokens = options.repositories.accessTokens.listForAccount(authSession.account.id);

    return context.json(
      accessTokenListResponseSchema.parse({ tokens: tokens.map(toAccessTokenResponse) }),
      200,
    );
  });

  app.openapi(accessTokenCreateRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "auth_unavailable", "Auth is unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const input = context.req.valid("json");
    const { displayPrefix, secret } = createAccessTokenSecret();
    const record = options.repositories.accessTokens.create({
      accountId: authSession.account.id,
      name: input.name,
      tokenHash: hashAccessTokenSecret(secret),
      tokenPrefix: displayPrefix,
    });

    return context.json(
      accessTokenCreateResponseSchema.parse({ token: toAccessTokenResponse(record), secret }),
      201,
    );
  });

  app.openapi(accessTokenDeleteRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "auth_unavailable", "Auth is unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const deleted = options.repositories.accessTokens.deleteByIdForAccount(
      authSession.account.id,
      context.req.valid("param").tokenId,
    );

    if (!deleted) {
      return context.json(
        createErrorResponse(context, "access_token_not_found", "Access token not found"),
        404,
      );
    }

    return context.body(null, 204);
  });

  app.openapi(assetUploadRoute, async (context) => {
    if (!options.repositories || !options.storage) {
      return context.json(
        createErrorResponse(context, "assets_unavailable", "Asset storage is unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    let body: Record<string, unknown>;

    try {
      body = await context.req.parseBody();
    } catch {
      return context.json(
        createErrorResponse(context, "invalid_upload", "Upload must be multipart form data"),
        400,
      );
    }

    try {
      const result = await createAssetFromUpload({
        accountId: authSession.account.id,
        file: body.file,
        repositories: options.repositories,
        storage: options.storage,
      });

      return context.json(toAssetResponse(result.asset, result.variants), 201);
    } catch (error) {
      if (error instanceof AssetUploadError) {
        return context.json(createErrorResponse(context, error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.openapi(assetListRoute, async (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "assets_unavailable", "Asset storage is unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const repositories = options.repositories;

    const assets = await Promise.all(
      repositories.assets.listForAccount(authSession.account.id).map(async (asset) =>
        toAssetResponse(
          asset,
          await listAssetVariantsForResponse({
            accountId: authSession.account.id,
            asset,
            repositories,
            storage: options.storage,
          }),
        ),
      ),
    );

    return context.json(assetListResponseSchema.parse({ assets }), 200);
  });

  app.openapi(assetDetailRoute, async (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "assets_unavailable", "Asset storage is unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { assetId } = context.req.valid("param");
    const asset = options.repositories.assets.findByIdForAccount(authSession.account.id, assetId);

    if (!asset) {
      return context.json(createErrorResponse(context, "asset_not_found", "Asset not found"), 404);
    }

    const repositories = options.repositories;

    return context.json(
      toAssetResponse(
        asset,
        await listAssetVariantsForResponse({
          accountId: authSession.account.id,
          asset,
          repositories,
          storage: options.storage,
        }),
      ),
      200,
    );
  });

  app.openapi(assetOriginalContentRoute, async (context) => {
    if (!options.repositories || !options.storage) {
      return context.json(
        createErrorResponse(context, "assets_unavailable", "Asset storage is unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { assetId } = context.req.valid("param");
    const asset = options.repositories.assets.findByIdForAccount(authSession.account.id, assetId);

    if (!asset) {
      return context.json(createErrorResponse(context, "asset_not_found", "Asset not found"), 404);
    }

    const buffer = await options.storage.read(asset.originalStorageKey);

    return context.body(toArrayBuffer(buffer), 200, {
      "cache-control": "private, max-age=86400",
      "content-length": String(buffer.byteLength),
      "content-type": asset.mimeType,
    });
  });

  app.openapi(assetVariantContentRoute, async (context) => {
    if (!options.repositories || !options.storage) {
      return context.json(
        createErrorResponse(context, "assets_unavailable", "Asset storage is unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { assetId, variantId } = context.req.valid("param");
    const asset = options.repositories.assets.findByIdForAccount(authSession.account.id, assetId);
    const variant = asset
      ? options.repositories.assets.findVariantByIdForAccount(
          authSession.account.id,
          asset.id,
          variantId,
        )
      : null;

    if (!asset || !variant) {
      return context.json(createErrorResponse(context, "asset_not_found", "Asset not found"), 404);
    }

    const buffer = await options.storage.read(variant.storageKey);

    return context.body(toArrayBuffer(buffer), 200, {
      "cache-control": "private, max-age=86400",
      "content-length": String(buffer.byteLength),
      "content-type": variant.mimeType,
    });
  });

  app.openapi(pageCreateRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "pages_unavailable", "Pages are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const input = context.req.valid("json");
    const document = input.document ?? createPageDocument();

    if (!validatePageDocumentAssets(authSession.account.id, document, options.repositories)) {
      return context.json(
        createErrorResponse(
          context,
          "page_asset_not_found",
          "Photo layers and backgrounds must reference assets owned by the account",
        ),
        400,
      );
    }

    const page = options.repositories.pages.create({
      accountId: authSession.account.id,
      title: input.title?.trim() || "Untitled page",
      width: document.canvas.width,
      height: document.canvas.height,
      documentJson: JSON.stringify(document),
    });

    return context.json(toPageResponse(page), 201);
  });

  app.openapi(pageListRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "pages_unavailable", "Pages are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const pages = options.repositories.pages
      .listForAccount(authSession.account.id)
      .map((page) => toPageSummaryResponse(page));

    return context.json(pageListResponseSchema.parse({ pages }), 200);
  });

  app.openapi(pageDetailRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "pages_unavailable", "Pages are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { pageId } = context.req.valid("param");
    const page = options.repositories.pages.findByIdForAccount(authSession.account.id, pageId);

    if (!page) {
      return context.json(createErrorResponse(context, "page_not_found", "Page not found"), 404);
    }

    return context.json(toPageResponse(page), 200);
  });

  app.openapi(pagePatchRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "pages_unavailable", "Pages are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { pageId } = context.req.valid("param");
    const input = context.req.valid("json");
    const existing = options.repositories.pages.findByIdForAccount(authSession.account.id, pageId);

    if (!existing) {
      return context.json(createErrorResponse(context, "page_not_found", "Page not found"), 404);
    }

    if (
      input.document &&
      !validatePageDocumentAssets(authSession.account.id, input.document, options.repositories)
    ) {
      return context.json(
        createErrorResponse(
          context,
          "page_asset_not_found",
          "Photo layers and backgrounds must reference assets owned by the account",
        ),
        400,
      );
    }

    const pageUpdate: Partial<Pick<PageRecord, "documentJson" | "height" | "title" | "width">> = {};

    if (input.title !== undefined) {
      pageUpdate.title = input.title.trim();
    }

    if (input.document) {
      pageUpdate.width = input.document.canvas.width;
      pageUpdate.height = input.document.canvas.height;
      pageUpdate.documentJson = JSON.stringify(input.document);
    }

    const page = options.repositories.pages.updateForAccount(
      authSession.account.id,
      pageId,
      pageUpdate,
    );

    if (!page) {
      return context.json(createErrorResponse(context, "page_not_found", "Page not found"), 404);
    }

    return context.json(toPageResponse(page), 200);
  });

  app.openapi(pageDuplicateRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "pages_unavailable", "Pages are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { pageId } = context.req.valid("param");
    const input = context.req.valid("json");
    const existing = options.repositories.pages.findByIdForAccount(authSession.account.id, pageId);

    if (!existing) {
      return context.json(createErrorResponse(context, "page_not_found", "Page not found"), 404);
    }

    const document = parseStoredPageDocument(existing);
    const page = options.repositories.pages.create({
      accountId: authSession.account.id,
      title: input.title?.trim() || `${existing.title} copy`,
      width: document.canvas.width,
      height: document.canvas.height,
      documentJson: JSON.stringify(document),
    });

    return context.json(toPageResponse(page), 201);
  });

  app.openapi(pageDeleteRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "pages_unavailable", "Pages are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { pageId } = context.req.valid("param");
    const deleted = options.repositories.pages.deleteByIdForAccount(authSession.account.id, pageId);

    if (!deleted) {
      return context.json(createErrorResponse(context, "page_not_found", "Page not found"), 404);
    }

    return context.body(null, 204);
  });

  app.openapi(bookCreateRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "books_unavailable", "Books are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const input = context.req.valid("json");
    const book = createBookWithCovers({
      accountId: authSession.account.id,
      title: input.title.trim(),
      pageWidth: input.pageWidth ?? defaultBookPageSize.width,
      pageHeight: input.pageHeight ?? defaultBookPageSize.height,
      coverSpreadEnabled: input.coverSpreadEnabled ?? true,
      repositories: options.repositories,
    });

    return context.json(toBookResponse(book, options.repositories), 201);
  });

  app.openapi(bookListRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "books_unavailable", "Books are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const books = options.repositories.books
      .listForAccount(authSession.account.id)
      .map((book) =>
        toBookSummaryResponse(
          book,
          options.repositories?.books.listPagesForBook(authSession.account.id, book.id) ?? [],
        ),
      );

    return context.json(bookListResponseSchema.parse({ books }), 200);
  });

  app.openapi(bookDetailRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "books_unavailable", "Books are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { bookId } = context.req.valid("param");
    const book = options.repositories.books.findByIdForAccount(authSession.account.id, bookId);

    if (!book) {
      return context.json(createErrorResponse(context, "book_not_found", "Book not found"), 404);
    }

    return context.json(toBookResponse(book, options.repositories), 200);
  });

  app.openapi(bookPatchRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "books_unavailable", "Books are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { bookId } = context.req.valid("param");
    const input = context.req.valid("json");
    const bookUpdate: Partial<
      Pick<BookRecord, "coverSpreadEnabled" | "pageHeight" | "pageWidth" | "title">
    > = {};

    if (input.title !== undefined) {
      bookUpdate.title = input.title.trim();
    }

    if (input.pageWidth !== undefined && input.pageHeight !== undefined) {
      bookUpdate.pageWidth = input.pageWidth;
      bookUpdate.pageHeight = input.pageHeight;
    }

    if (input.coverSpreadEnabled !== undefined) {
      bookUpdate.coverSpreadEnabled = input.coverSpreadEnabled;
    }

    const book = options.repositories.books.updateForAccount(
      authSession.account.id,
      bookId,
      bookUpdate,
    );

    if (!book) {
      return context.json(createErrorResponse(context, "book_not_found", "Book not found"), 404);
    }

    return context.json(toBookResponse(book, options.repositories), 200);
  });

  app.openapi(bookDeleteRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "books_unavailable", "Books are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { bookId } = context.req.valid("param");
    const deleted = options.repositories.books.deleteByIdForAccount(authSession.account.id, bookId);

    if (!deleted) {
      return context.json(createErrorResponse(context, "book_not_found", "Book not found"), 404);
    }

    return context.body(null, 204);
  });

  app.openapi(bookSetPagesRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "books_unavailable", "Books are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { bookId } = context.req.valid("param");
    const input = context.req.valid("json");
    const existing = options.repositories.books.findByIdForAccount(authSession.account.id, bookId);

    if (!existing) {
      return context.json(createErrorResponse(context, "book_not_found", "Book not found"), 404);
    }

    try {
      options.repositories.books.replacePages({
        accountId: authSession.account.id,
        bookId,
        pageIds: input.pageIds,
      });
    } catch (error) {
      if (error instanceof OwnershipError) {
        return context.json(
          createErrorResponse(
            context,
            "book_page_not_found",
            "Book pages must belong to the account",
          ),
          400,
        );
      }

      throw error;
    }

    const book = options.repositories.books.findByIdForAccount(authSession.account.id, bookId);

    if (!book) {
      return context.json(createErrorResponse(context, "book_not_found", "Book not found"), 404);
    }

    return context.json(toBookResponse(book, options.repositories), 200);
  });

  app.openapi(bookAssetListRoute, async (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "books_unavailable", "Books are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const repositories = options.repositories;
    const { bookId } = context.req.valid("param");
    const book = repositories.books.findByIdForAccount(authSession.account.id, bookId);

    if (!book) {
      return context.json(createErrorResponse(context, "book_not_found", "Book not found"), 404);
    }

    const referencedAssets = repositories.books.listAssetsForBook(authSession.account.id, bookId);

    const assets = await Promise.all(
      referencedAssets.map(async (asset) =>
        toAssetResponse(
          asset,
          await listAssetVariantsForResponse({
            accountId: authSession.account.id,
            asset,
            repositories,
            storage: options.storage,
          }),
        ),
      ),
    );

    return context.json(assetListResponseSchema.parse({ assets }), 200);
  });

  app.openapi(bookAssetsAddRoute, async (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "books_unavailable", "Books are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const repositories = options.repositories;
    const { bookId } = context.req.valid("param");
    const input = context.req.valid("json");

    try {
      repositories.books.addAssetsToBook({
        accountId: authSession.account.id,
        bookId,
        assetIds: input.assetIds,
      });
    } catch (error) {
      if (error instanceof OwnershipError) {
        const isBookOwnership = error.message.startsWith("Book does not belong");

        return context.json(
          createErrorResponse(
            context,
            isBookOwnership ? "book_not_found" : "book_asset_not_found",
            isBookOwnership ? "Book not found" : "Book assets must belong to the account",
          ),
          isBookOwnership ? 404 : 400,
        );
      }

      throw error;
    }

    const referencedAssets = repositories.books.listAssetsForBook(authSession.account.id, bookId);

    const assets = await Promise.all(
      referencedAssets.map(async (asset) =>
        toAssetResponse(
          asset,
          await listAssetVariantsForResponse({
            accountId: authSession.account.id,
            asset,
            repositories,
            storage: options.storage,
          }),
        ),
      ),
    );

    return context.json(assetListResponseSchema.parse({ assets }), 200);
  });

  app.openapi(bookAssetRemoveRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "books_unavailable", "Books are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { bookId, assetId } = context.req.valid("param");

    try {
      const removed = options.repositories.books.removeAssetFromBook({
        accountId: authSession.account.id,
        bookId,
        assetId,
      });

      if (!removed) {
        return context.json(
          createErrorResponse(context, "book_asset_not_found", "Book asset not found"),
          404,
        );
      }
    } catch (error) {
      if (error instanceof OwnershipError) {
        return context.json(createErrorResponse(context, "book_not_found", "Book not found"), 404);
      }

      throw error;
    }

    return context.body(null, 204);
  });

  app.openapi(albumListRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "albums_unavailable", "Albums are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const records = options.repositories.albums.listForAccount(authSession.account.id);

    return context.json(
      albumListResponseSchema.parse({ albums: records.map(toAlbumResponse) }),
      200,
    );
  });

  app.openapi(albumCreateRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "albums_unavailable", "Albums are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const input = context.req.valid("json");
    const album = options.repositories.albums.create({
      accountId: authSession.account.id,
      title: input.title,
    });

    return context.json(toAlbumResponse({ ...album, photoCount: 0 }), 201);
  });

  app.openapi(albumDetailRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "albums_unavailable", "Albums are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { albumId } = context.req.valid("param");
    const records = options.repositories.albums.listForAccount(authSession.account.id);
    const match = records.find((record) => record.id === albumId);

    if (!match) {
      return context.json(createErrorResponse(context, "album_not_found", "Album not found"), 404);
    }

    return context.json(toAlbumResponse(match), 200);
  });

  app.openapi(albumPatchRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "albums_unavailable", "Albums are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { albumId } = context.req.valid("param");
    const input = context.req.valid("json");
    const updated = options.repositories.albums.update({
      accountId: authSession.account.id,
      albumId,
      title: input.title,
    });

    if (!updated) {
      return context.json(createErrorResponse(context, "album_not_found", "Album not found"), 404);
    }

    const records = options.repositories.albums.listForAccount(authSession.account.id);
    const match = records.find((record) => record.id === albumId);

    return context.json(toAlbumResponse(match ?? { ...updated, photoCount: 0 }), 200);
  });

  app.openapi(albumDeleteRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "albums_unavailable", "Albums are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { albumId } = context.req.valid("param");
    const removed = options.repositories.albums.delete({
      accountId: authSession.account.id,
      albumId,
    });

    if (!removed) {
      return context.json(createErrorResponse(context, "album_not_found", "Album not found"), 404);
    }

    return context.body(null, 204);
  });

  app.openapi(albumAssetListRoute, async (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "albums_unavailable", "Albums are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const repositories = options.repositories;
    const { albumId } = context.req.valid("param");
    const album = repositories.albums.findByIdForAccount(authSession.account.id, albumId);

    if (!album) {
      return context.json(createErrorResponse(context, "album_not_found", "Album not found"), 404);
    }

    const records = repositories.albums.listAssetsForAlbum(authSession.account.id, albumId);

    const assets = await Promise.all(
      records.map(async (asset) =>
        toAssetResponse(
          asset,
          await listAssetVariantsForResponse({
            accountId: authSession.account.id,
            asset,
            repositories,
            storage: options.storage,
          }),
        ),
      ),
    );

    return context.json(assetListResponseSchema.parse({ assets }), 200);
  });

  app.openapi(albumAssetsAddRoute, async (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "albums_unavailable", "Albums are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const repositories = options.repositories;
    const { albumId } = context.req.valid("param");
    const input = context.req.valid("json");

    try {
      repositories.albums.addAssetsToAlbum({
        accountId: authSession.account.id,
        albumId,
        assetIds: input.assetIds,
      });
    } catch (error) {
      if (error instanceof OwnershipError) {
        const isAlbumOwnership = error.message.startsWith("Album does not belong");

        return context.json(
          createErrorResponse(
            context,
            isAlbumOwnership ? "album_not_found" : "album_asset_not_found",
            isAlbumOwnership ? "Album not found" : "Album assets must belong to the account",
          ),
          isAlbumOwnership ? 404 : 400,
        );
      }

      throw error;
    }

    const records = repositories.albums.listAssetsForAlbum(authSession.account.id, albumId);

    const assets = await Promise.all(
      records.map(async (asset) =>
        toAssetResponse(
          asset,
          await listAssetVariantsForResponse({
            accountId: authSession.account.id,
            asset,
            repositories,
            storage: options.storage,
          }),
        ),
      ),
    );

    return context.json(assetListResponseSchema.parse({ assets }), 200);
  });

  app.openapi(albumAssetRemoveRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "albums_unavailable", "Albums are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { albumId, assetId } = context.req.valid("param");

    try {
      const removed = options.repositories.albums.removeAssetFromAlbum({
        accountId: authSession.account.id,
        albumId,
        assetId,
      });

      if (!removed) {
        return context.json(
          createErrorResponse(context, "album_asset_not_found", "Album asset not found"),
          404,
        );
      }
    } catch (error) {
      if (error instanceof OwnershipError) {
        return context.json(
          createErrorResponse(context, "album_not_found", "Album not found"),
          404,
        );
      }

      throw error;
    }

    return context.body(null, 204);
  });

  app.openapi(assetAlbumsListRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "albums_unavailable", "Albums are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { assetId } = context.req.valid("param");
    const asset = options.repositories.assets.findByIdForAccount(authSession.account.id, assetId);

    if (!asset) {
      return context.json(createErrorResponse(context, "asset_not_found", "Asset not found"), 404);
    }

    const records = options.repositories.albums.listAlbumsForAsset(authSession.account.id, assetId);

    return context.json(
      albumListResponseSchema.parse({ albums: records.map(toAlbumResponse) }),
      200,
    );
  });

  app.openapi(stickerPackListRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "sticker_packs_unavailable", "Sticker packs are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const records = options.repositories.stickerPacks.listForAccount(authSession.account.id);

    return context.json(
      stickerPackListResponseSchema.parse({ packs: records.map(toStickerPackResponse) }),
      200,
    );
  });

  app.openapi(stickerPackCreateRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "sticker_packs_unavailable", "Sticker packs are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const input = context.req.valid("json");
    const pack = options.repositories.stickerPacks.create({
      accountId: authSession.account.id,
      title: input.title,
      author: input.author ?? null,
      sourceUrl: input.sourceUrl ?? null,
    });

    return context.json(toStickerPackResponse({ ...pack, stickerCount: 0 }), 201);
  });

  app.openapi(stickerPackDetailRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "sticker_packs_unavailable", "Sticker packs are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { packId } = context.req.valid("param");
    const records = options.repositories.stickerPacks.listForAccount(authSession.account.id);
    const match = records.find((record) => record.id === packId);

    if (!match) {
      return context.json(
        createErrorResponse(context, "sticker_pack_not_found", "Sticker pack not found"),
        404,
      );
    }

    return context.json(toStickerPackResponse(match), 200);
  });

  app.openapi(stickerPackPatchRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "sticker_packs_unavailable", "Sticker packs are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { packId } = context.req.valid("param");
    const input = context.req.valid("json");
    const updated = options.repositories.stickerPacks.update({
      accountId: authSession.account.id,
      packId,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.author === undefined ? {} : { author: input.author }),
      ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
    });

    if (!updated) {
      return context.json(
        createErrorResponse(context, "sticker_pack_not_found", "Sticker pack not found"),
        404,
      );
    }

    const records = options.repositories.stickerPacks.listForAccount(authSession.account.id);
    const match = records.find((record) => record.id === packId);

    return context.json(toStickerPackResponse(match ?? { ...updated, stickerCount: 0 }), 200);
  });

  app.openapi(stickerPackDeleteRoute, async (context) => {
    if (!options.repositories || !options.storage) {
      return context.json(
        createErrorResponse(context, "sticker_packs_unavailable", "Sticker packs are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { packId } = context.req.valid("param");
    const { deleted, removedStickers } = options.repositories.stickerPacks.delete({
      accountId: authSession.account.id,
      packId,
    });

    if (!deleted) {
      return context.json(
        createErrorResponse(context, "sticker_pack_not_found", "Sticker pack not found"),
        404,
      );
    }

    for (const sticker of removedStickers) {
      try {
        await options.storage.remove(sticker.storageKey);
      } catch {
        // Ignore storage cleanup errors; the database row is already gone.
      }
    }

    return context.body(null, 204);
  });

  app.openapi(stickerPackStickerListRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "sticker_packs_unavailable", "Sticker packs are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { packId } = context.req.valid("param");
    const pack = options.repositories.stickerPacks.findByIdForAccount(
      authSession.account.id,
      packId,
    );

    if (!pack) {
      return context.json(
        createErrorResponse(context, "sticker_pack_not_found", "Sticker pack not found"),
        404,
      );
    }

    const stickers = options.repositories.stickerPacks.listStickersForPack(
      authSession.account.id,
      packId,
    );

    return context.json(
      customStickerListResponseSchema.parse({ stickers: stickers.map(toCustomStickerResponse) }),
      200,
    );
  });

  app.openapi(stickerPackStickerUploadRoute, async (context) => {
    if (!options.repositories || !options.storage) {
      return context.json(
        createErrorResponse(context, "sticker_packs_unavailable", "Sticker packs are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { packId } = context.req.valid("param");

    let body: Record<string, unknown>;

    try {
      body = await context.req.parseBody();
    } catch {
      return context.json(
        createErrorResponse(context, "invalid_upload", "Upload must be multipart form data"),
        400,
      );
    }

    try {
      const sticker = await createCustomStickerFromUpload({
        accountId: authSession.account.id,
        packId,
        file: body.file,
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        repositories: options.repositories,
        storage: options.storage,
      });

      return context.json(toCustomStickerResponse(sticker), 201);
    } catch (error) {
      if (error instanceof CustomStickerUploadError) {
        return context.json(createErrorResponse(context, error.code, error.message), error.status);
      }

      if (error instanceof OwnershipError) {
        return context.json(
          createErrorResponse(context, "sticker_pack_not_found", "Sticker pack not found"),
          404,
        );
      }

      throw error;
    }
  });

  app.openapi(stickerPackStickerRemoveRoute, async (context) => {
    if (!options.repositories || !options.storage) {
      return context.json(
        createErrorResponse(context, "sticker_packs_unavailable", "Sticker packs are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { packId, stickerId } = context.req.valid("param");
    const sticker = options.repositories.stickerPacks.findStickerByIdForAccount(
      authSession.account.id,
      stickerId,
    );

    if (!sticker || sticker.packId !== packId) {
      return context.json(
        createErrorResponse(context, "custom_sticker_not_found", "Custom sticker not found"),
        404,
      );
    }

    const removed = options.repositories.stickerPacks.removeStickerFromPack({
      accountId: authSession.account.id,
      stickerId,
    });

    if (!removed) {
      return context.json(
        createErrorResponse(context, "custom_sticker_not_found", "Custom sticker not found"),
        404,
      );
    }

    try {
      await options.storage.remove(removed.storageKey);
    } catch {
      // Ignore storage cleanup errors; the database row is already gone.
    }

    return context.body(null, 204);
  });

  app.openapi(customStickerListRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "sticker_packs_unavailable", "Sticker packs are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { packId } = context.req.valid("query");
    const stickers = packId
      ? options.repositories.stickerPacks.listStickersForPack(authSession.account.id, packId)
      : options.repositories.stickerPacks.listStickersForAccount(authSession.account.id);

    return context.json(
      customStickerListResponseSchema.parse({ stickers: stickers.map(toCustomStickerResponse) }),
      200,
    );
  });

  app.openapi(customStickerContentRoute, async (context) => {
    if (!options.repositories || !options.storage) {
      return context.json(
        createErrorResponse(context, "sticker_packs_unavailable", "Sticker packs are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { stickerId } = context.req.valid("param");
    const sticker = options.repositories.stickerPacks.findStickerByIdForAccount(
      authSession.account.id,
      stickerId,
    );

    if (!sticker) {
      return context.json(
        createErrorResponse(context, "custom_sticker_not_found", "Custom sticker not found"),
        404,
      );
    }

    const buffer = await options.storage.read(sticker.storageKey);

    return context.body(toArrayBuffer(buffer), 200, {
      "cache-control": "private, max-age=86400",
      "content-length": String(buffer.byteLength),
      "content-type": sticker.mimeType,
    });
  });

  app.openapi(mapTileRoute, async (context) => {
    if (!options.repositories || !options.mapTiles) {
      return context.json(
        createErrorResponse(context, "map_tiles_unavailable", "Map tiles are unavailable"),
        500,
      );
    }

    if (!getAuthenticatedSession(context, options.repositories)) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const tile = context.req.valid("param");

    if (!isMapTileInRange(tile)) {
      return context.json(
        createErrorResponse(context, "map_tile_out_of_range", "Map tile is outside the tile grid"),
        400,
      );
    }

    let image: MapTileImage | null;

    try {
      image = await options.mapTiles.getTile(tile);
    } catch {
      image = null;
    }

    if (!image) {
      return context.json(
        createErrorResponse(context, "map_tile_unavailable", "The map tile provider failed"),
        502,
      );
    }

    return context.body(toArrayBuffer(image.buffer), 200, {
      "cache-control": "private, max-age=604800, immutable",
      "content-length": String(image.buffer.byteLength),
      "content-type": image.mimeType,
    });
  });

  app.openapi(customStickerFavoriteRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "sticker_packs_unavailable", "Sticker packs are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { stickerId } = context.req.valid("param");
    const { isFavorite } = context.req.valid("json");

    const updated = options.repositories.stickerPacks.setStickerFavorite({
      accountId: authSession.account.id,
      stickerId,
      isFavorite,
    });

    if (!updated) {
      return context.json(
        createErrorResponse(context, "custom_sticker_not_found", "Custom sticker not found"),
        404,
      );
    }

    return context.json(toCustomStickerResponse(updated), 200);
  });

  app.openapi(customWashiTapeListRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "washi_tapes_unavailable", "Washi tapes are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const records = options.repositories.customWashiTapes.listForAccount(authSession.account.id);

    return context.json(
      customWashiTapeListResponseSchema.parse({
        washiTapes: records.map(toCustomWashiTapeResponse),
      }),
      200,
    );
  });

  app.openapi(customWashiTapeCreateRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "washi_tapes_unavailable", "Washi tapes are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const input = context.req.valid("json");
    const validation = validateWashiTapeDesign(
      authSession.account.id,
      input.design,
      options.repositories,
    );

    if (validation !== "ok") {
      return context.json(
        createErrorResponse(
          context,
          `washi_tape_${validation}`,
          washiTapeDesignErrorMessages[validation],
        ),
        400,
      );
    }

    const record = options.repositories.customWashiTapes.create({
      accountId: authSession.account.id,
      name: input.name,
      designJson: JSON.stringify(input.design),
    });

    return context.json(toCustomWashiTapeResponse(record), 201);
  });

  app.openapi(customWashiTapePatchRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "washi_tapes_unavailable", "Washi tapes are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { washiTapeId } = context.req.valid("param");
    const input = context.req.valid("json");

    if (
      !options.repositories.customWashiTapes.findByIdForAccount(authSession.account.id, washiTapeId)
    ) {
      return context.json(
        createErrorResponse(context, "washi_tape_not_found", "Washi tape not found"),
        404,
      );
    }

    if (input.design) {
      const validation = validateWashiTapeDesign(
        authSession.account.id,
        input.design,
        options.repositories,
      );

      if (validation !== "ok") {
        return context.json(
          createErrorResponse(
            context,
            `washi_tape_${validation}`,
            washiTapeDesignErrorMessages[validation],
          ),
          400,
        );
      }
    }

    const updated = options.repositories.customWashiTapes.update({
      accountId: authSession.account.id,
      washiTapeId,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.design === undefined ? {} : { designJson: JSON.stringify(input.design) }),
    });

    if (!updated) {
      return context.json(
        createErrorResponse(context, "washi_tape_not_found", "Washi tape not found"),
        404,
      );
    }

    return context.json(toCustomWashiTapeResponse(updated), 200);
  });

  app.openapi(customWashiTapeDeleteRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "washi_tapes_unavailable", "Washi tapes are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { washiTapeId } = context.req.valid("param");
    const deleted = options.repositories.customWashiTapes.delete({
      accountId: authSession.account.id,
      washiTapeId,
    });

    if (!deleted) {
      return context.json(
        createErrorResponse(context, "washi_tape_not_found", "Washi tape not found"),
        404,
      );
    }

    return context.body(null, 204);
  });

  app.openapi(customBackgroundListRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "backgrounds_unavailable", "Backgrounds are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const backgrounds = options.repositories.customBackgrounds.listForAccount(
      authSession.account.id,
    );

    return context.json(
      customBackgroundListResponseSchema.parse({
        backgrounds: backgrounds.map(toCustomBackgroundResponse),
      }),
      200,
    );
  });

  app.openapi(customBackgroundUploadRoute, async (context) => {
    if (!options.repositories || !options.storage) {
      return context.json(
        createErrorResponse(context, "backgrounds_unavailable", "Backgrounds are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    let body: Record<string, unknown>;

    try {
      body = await context.req.parseBody();
    } catch {
      return context.json(
        createErrorResponse(context, "invalid_upload", "Upload must be multipart form data"),
        400,
      );
    }

    try {
      const background = await createCustomBackgroundFromUpload({
        accountId: authSession.account.id,
        file: body.file,
        name: typeof body.name === "string" ? body.name : undefined,
        repositories: options.repositories,
        storage: options.storage,
      });

      return context.json(toCustomBackgroundResponse(background), 201);
    } catch (error) {
      if (error instanceof CustomBackgroundUploadError) {
        return context.json(createErrorResponse(context, error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.openapi(customBackgroundPatchRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "backgrounds_unavailable", "Backgrounds are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { backgroundId } = context.req.valid("param");
    const { name } = context.req.valid("json");
    const updated = options.repositories.customBackgrounds.rename({
      accountId: authSession.account.id,
      backgroundId,
      name,
    });

    if (!updated) {
      return context.json(
        createErrorResponse(context, "background_not_found", "Background not found"),
        404,
      );
    }

    return context.json(toCustomBackgroundResponse(updated), 200);
  });

  app.openapi(customBackgroundDeleteRoute, async (context) => {
    if (!options.repositories || !options.storage) {
      return context.json(
        createErrorResponse(context, "backgrounds_unavailable", "Backgrounds are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { backgroundId } = context.req.valid("param");
    const result = await deleteCustomBackground({
      accountId: authSession.account.id,
      backgroundId,
      repositories: options.repositories,
      storage: options.storage,
    });

    if (result === "in_use") {
      return context.json(
        createErrorResponse(
          context,
          "background_in_use",
          "This background is used on a page. Remove it from those pages before deleting it.",
        ),
        409,
      );
    }

    if (result === "not_found") {
      return context.json(
        createErrorResponse(context, "background_not_found", "Background not found"),
        404,
      );
    }

    return context.body(null, 204);
  });

  for (const [route, variant] of [
    [customBackgroundContentRoute, "content"],
    [customBackgroundThumbnailRoute, "thumbnail"],
  ] as const) {
    app.openapi(route, async (context) => {
      if (!options.repositories || !options.storage) {
        return context.json(
          createErrorResponse(context, "backgrounds_unavailable", "Backgrounds are unavailable"),
          500,
        );
      }

      const authSession = getAuthenticatedSession(context, options.repositories);

      if (!authSession) {
        return context.json(
          createErrorResponse(context, "not_authenticated", "Authentication is required"),
          401,
        );
      }

      const { backgroundId } = context.req.valid("param");
      const background = options.repositories.customBackgrounds.findByIdForAccount(
        authSession.account.id,
        backgroundId,
      );

      if (!background) {
        return context.json(
          createErrorResponse(context, "background_not_found", "Background not found"),
          404,
        );
      }

      const buffer = await options.storage.read(
        variant === "content" ? background.storageKey : background.thumbnailStorageKey,
      );

      return context.body(toArrayBuffer(buffer), 200, {
        "cache-control": "private, max-age=86400",
        "content-length": String(buffer.byteLength),
        "content-type": background.mimeType,
      });
    });
  }

  for (const [route, variant] of [
    [builtInBackgroundContentRoute, "content"],
    [builtInBackgroundThumbnailRoute, "thumbnail"],
  ] as const) {
    app.openapi(route, async (context) => {
      const { slug } = context.req.valid("param");
      const buffer = await readBuiltInBackgroundTexture(slug, variant);

      if (!buffer) {
        return context.json(
          createErrorResponse(context, "background_not_found", "Background not found"),
          404,
        );
      }

      return context.body(toArrayBuffer(buffer), 200, {
        "cache-control": "public, max-age=604800, immutable",
        "content-length": String(buffer.byteLength),
        "content-type": "image/jpeg",
      });
    });
  }

  app.openapi(exportCreateRoute, async (context) => {
    if (!options.repositories || !options.storage) {
      return context.json(
        createErrorResponse(context, "exports_unavailable", "Exports are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const input = context.req.valid("json");

    try {
      const { job } = await runExportJob({
        accountId: authSession.account.id,
        bookId: input.bookId,
        dpi: input.dpi,
        format: input.format,
        includeBackground: input.includeBackground,
        mapTiles: options.mapTiles,
        pageId: input.pageId,
        preset: input.preset,
        repositories: options.repositories,
        storage: options.storage,
      });

      return context.json(toExportJobResponse(job), 201);
    } catch (error) {
      if (error instanceof OwnershipError) {
        return context.json(
          createErrorResponse(context, "export_target_not_found", "Export target was not found"),
          404,
        );
      }

      if (error instanceof ExportRenderError) {
        return context.json(
          createErrorResponse(
            context,
            error.code === "export_not_found" ? error.code : "export_failed",
            error.message,
          ),
          error.status === 404 ? 404 : 400,
        );
      }

      throw error;
    }
  });

  app.openapi(exportDetailRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "exports_unavailable", "Exports are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { exportId } = context.req.valid("param");
    const exportJob = options.repositories.exports.findByIdForAccount(
      authSession.account.id,
      exportId,
    );

    if (!exportJob) {
      return context.json(
        createErrorResponse(context, "export_not_found", "Export not found"),
        404,
      );
    }

    return context.json(toExportJobResponse(exportJob), 200);
  });

  app.openapi(exportContentRoute, async (context) => {
    if (!options.repositories || !options.storage) {
      return context.json(
        createErrorResponse(context, "exports_unavailable", "Exports are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const { exportId } = context.req.valid("param");
    const exportJob = options.repositories.exports.findByIdForAccount(
      authSession.account.id,
      exportId,
    );

    if (!exportJob || exportJob.status !== "completed" || !exportJob.outputStorageKey) {
      return context.json(
        createErrorResponse(context, "export_not_found", "Export not found"),
        404,
      );
    }

    const buffer = await options.storage.read(exportJob.outputStorageKey);
    const contentType = getExportContentType(exportJob);
    const filename = getExportDownloadFilename(exportJob, options.repositories);

    return context.body(toArrayBuffer(buffer), 200, {
      "cache-control": "private, max-age=86400",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(buffer.byteLength),
      "content-type": contentType,
    });
  });

  const describeShutterflyError = (
    error: unknown,
  ): { status: 400 | 404 | 409 | 502; code: string; message: string } | null => {
    if (error instanceof ShutterflyInvalidTokenError) {
      return { status: 400, code: "shutterfly_token_invalid", message: error.message };
    }

    if (error instanceof ShutterflyProjectNotSupportedError) {
      return { status: 400, code: "shutterfly_project_unsupported", message: error.message };
    }

    if (error instanceof ShutterflyNotConnectedError) {
      return { status: 409, code: "shutterfly_not_connected", message: error.message };
    }

    if (error instanceof ShutterflyAuthError || error instanceof CredentialDecryptError) {
      return {
        status: 409,
        code: "shutterfly_reconnect_required",
        message: "Shutterfly sign-in expired. Reconnect your Shutterfly account in Settings.",
      };
    }

    if (error instanceof ShutterflyRequestError) {
      return error.status === 404
        ? {
            status: 404,
            code: "shutterfly_project_not_found",
            message: "Shutterfly project not found",
          }
        : { status: 502, code: "shutterfly_unavailable", message: error.message };
    }

    return null;
  };

  const toShutterflyErrorResponse = (context: ApiContext, error: unknown) => {
    const described = describeShutterflyError(error);

    if (!described) {
      throw error;
    }

    return context.json(
      createErrorResponse(context, described.code, described.message),
      described.status,
    );
  };

  const shutterflyImports = createShutterflyImportJobs<ShutterflyImportResponse>({
    clock: options.clock,
    describeError: (error) => {
      const described = describeShutterflyError(error);

      if (described) {
        return { code: described.code, message: described.message };
      }

      console.error(error);

      return { code: "internal_error", message: "Unexpected server error" };
    },
  });

  const toShutterflyImportJobResponse = (job: ShutterflyImportJob<ShutterflyImportResponse>) =>
    shutterflyImportJobResponseSchema.parse({
      id: job.id,
      projectId: job.projectId,
      status: job.status,
      progress: job.progress,
      result: job.result,
      error: job.error,
    });

  const startShutterflyImport = (
    shutterfly: ShutterflyIntegration,
    repositories: Repositories,
    accountId: string,
    projectId: string,
  ) =>
    shutterflyImports.start(accountId, projectId, async (onProgress) => {
      const result = await shutterfly.importProject(accountId, projectId, onProgress);

      return shutterflyImportResponseSchema.parse({
        book: toBookResponse(result.book, repositories),
        warnings: result.warnings,
      });
    });

  const createMcpShutterflyAccess = (
    shutterfly: ShutterflyIntegration,
    repositories: Repositories,
  ): McpShutterflyAccess => ({
    getStatus: (accountId) => shutterfly.getStatus(accountId),
    listProjects: async (accountId) => {
      try {
        return await shutterfly.listProjects(accountId);
      } catch (error) {
        const described = describeShutterflyError(error);

        throw described ? new Error(described.message) : error;
      }
    },
    startImport: (accountId, projectId) => {
      if (!shutterfly.getStatus(accountId).connected) {
        throw new Error(
          "Connect your Shutterfly account in the Zakka web app's Settings before importing.",
        );
      }

      return toShutterflyImportJobResponse(
        startShutterflyImport(shutterfly, repositories, accountId, projectId),
      );
    },
    getImport: (accountId, importId) => {
      const job = shutterflyImports.get(accountId, importId);

      return job ? toShutterflyImportJobResponse(job) : null;
    },
  });

  const requireShutterfly = (context: ApiContext) => {
    if (!options.repositories) {
      return {
        response: context.json(
          createErrorResponse(context, "integrations_unavailable", "Integrations are unavailable"),
          500,
        ),
      } as const;
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return {
        response: context.json(
          createErrorResponse(context, "not_authenticated", "Authentication is required"),
          401,
        ),
      } as const;
    }

    if (!options.shutterfly) {
      return {
        response: context.json(
          createErrorResponse(
            context,
            "shutterfly_not_configured",
            "Shutterfly import is not configured on this server",
          ),
          503,
        ),
      } as const;
    }

    return { accountId: authSession.account.id, shutterfly: options.shutterfly } as const;
  };

  app.openapi(shutterflyConnectionRoute, (context) => {
    if (!options.repositories) {
      return context.json(
        createErrorResponse(context, "integrations_unavailable", "Integrations are unavailable"),
        500,
      );
    }

    const authSession = getAuthenticatedSession(context, options.repositories);

    if (!authSession) {
      return context.json(
        createErrorResponse(context, "not_authenticated", "Authentication is required"),
        401,
      );
    }

    const status = options.shutterfly?.getStatus(authSession.account.id) ?? {
      connected: false,
      email: null,
      connectedAt: null,
    };

    return context.json(
      shutterflyConnectionResponseSchema.parse({
        configured: options.shutterfly !== undefined,
        ...status,
      }),
      200,
    );
  });

  app.openapi(shutterflyConnectRoute, async (context) => {
    const required = requireShutterfly(context);

    if ("response" in required) {
      return required.response;
    }

    try {
      const status = await required.shutterfly.connect(
        required.accountId,
        context.req.valid("json").refreshToken,
      );

      return context.json(
        shutterflyConnectionResponseSchema.parse({ configured: true, ...status }),
        200,
      );
    } catch (error) {
      if (error instanceof ShutterflyAuthError) {
        return context.json(
          createErrorResponse(
            context,
            "shutterfly_token_invalid",
            "Shutterfly did not accept that refresh token. Copy a fresh one and try again.",
          ),
          400,
        );
      }

      return toShutterflyErrorResponse(context, error);
    }
  });

  app.openapi(shutterflyDisconnectRoute, (context) => {
    const required = requireShutterfly(context);

    if ("response" in required) {
      return required.response;
    }

    required.shutterfly.disconnect(required.accountId);

    return context.body(null, 204);
  });

  app.openapi(shutterflyProjectListRoute, async (context) => {
    const required = requireShutterfly(context);

    if ("response" in required) {
      return required.response;
    }

    try {
      const projects = await required.shutterfly.listProjects(required.accountId);

      return context.json(shutterflyProjectListResponseSchema.parse({ projects }), 200);
    } catch (error) {
      return toShutterflyErrorResponse(context, error);
    }
  });

  app.openapi(shutterflyProjectImportRoute, async (context) => {
    const required = requireShutterfly(context);

    if ("response" in required) {
      return required.response;
    }

    if (!options.storage || !options.repositories) {
      return context.json(
        createErrorResponse(context, "assets_unavailable", "Asset storage is unavailable"),
        500,
      );
    }

    try {
      const result = await required.shutterfly.importProject(
        required.accountId,
        context.req.valid("param").projectId,
      );

      return context.json(
        shutterflyImportResponseSchema.parse({
          book: toBookResponse(result.book, options.repositories),
          warnings: result.warnings,
        }),
        201,
      );
    } catch (error) {
      return toShutterflyErrorResponse(context, error);
    }
  });

  app.openapi(shutterflyProjectImportJobRoute, (context) => {
    const required = requireShutterfly(context);

    if ("response" in required) {
      return required.response;
    }

    const repositories = options.repositories;

    if (!options.storage || !repositories) {
      return context.json(
        createErrorResponse(context, "assets_unavailable", "Asset storage is unavailable"),
        500,
      );
    }

    if (!required.shutterfly.getStatus(required.accountId).connected) {
      return context.json(
        createErrorResponse(
          context,
          "shutterfly_not_connected",
          "Connect your Shutterfly account before importing.",
        ),
        409,
      );
    }

    const projectId = context.req.valid("param").projectId;
    const job = startShutterflyImport(
      required.shutterfly,
      repositories,
      required.accountId,
      projectId,
    );

    return context.json(toShutterflyImportJobResponse(job), 202);
  });

  app.openapi(shutterflyImportJobRoute, (context) => {
    const required = requireShutterfly(context);

    if ("response" in required) {
      return required.response;
    }

    const job = shutterflyImports.get(required.accountId, context.req.valid("param").importId);

    if (!job) {
      return context.json(
        createErrorResponse(context, "shutterfly_import_not_found", "Shutterfly import not found"),
        404,
      );
    }

    return context.json(toShutterflyImportJobResponse(job), 200);
  });

  const shutterflyArchives =
    options.shutterfly && options.shutterflyArchiveDir
      ? createShutterflyArchives({
          rootDir: options.shutterflyArchiveDir,
          clock: options.clock,
          describeError: (error) => {
            const described = describeShutterflyError(error);

            if (described) {
              return { code: described.code, message: described.message };
            }

            if ((error as NodeJS.ErrnoException).code === "ENOSPC") {
              return {
                code: "disk_full",
                message:
                  "The server ran out of disk space. Free up space, then resume the archive.",
              };
            }

            console.error(error);

            return {
              code: "archive_stopped",
              message: error instanceof Error ? error.message : "Unexpected server error",
            };
          },
          run: (accountId, runOptions) =>
            (options.shutterfly as ShutterflyIntegration).archiveAccount(accountId, runOptions),
        })
      : null;

  const requireShutterflyArchives = (context: ApiContext) => {
    const required = requireShutterfly(context);

    if ("response" in required) {
      return { response: required.response } as const;
    }

    if (!shutterflyArchives) {
      return {
        response: context.json(
          createErrorResponse(
            context,
            "shutterfly_not_configured",
            "Shutterfly archiving is not configured on this server",
          ),
          503,
        ),
      } as const;
    }

    return { ...required, archives: shutterflyArchives } as const;
  };

  const toShutterflyArchiveErrorResponse = (context: ApiContext, error: unknown) => {
    if (error instanceof ShutterflyArchiveNotFoundError) {
      return context.json(
        createErrorResponse(context, "shutterfly_archive_not_found", error.message),
        404,
      );
    }

    if (error instanceof ShutterflyArchiveBusyError) {
      return context.json(
        createErrorResponse(context, "shutterfly_archive_busy", error.message),
        409,
      );
    }

    throw error;
  };

  app.openapi(shutterflyArchiveListRoute, async (context) => {
    const required = requireShutterflyArchives(context);

    if ("response" in required) {
      return required.response;
    }

    return context.json(
      shutterflyArchiveListResponseSchema.parse({
        archives: await required.archives.list(required.accountId),
      }),
      200,
    );
  });

  app.openapi(shutterflyArchiveStartRoute, async (context) => {
    const required = requireShutterflyArchives(context);

    if ("response" in required) {
      return required.response;
    }

    if (!required.shutterfly.getStatus(required.accountId).connected) {
      return context.json(
        createErrorResponse(
          context,
          "shutterfly_not_connected",
          "Connect your Shutterfly account before archiving it.",
        ),
        409,
      );
    }

    return context.json(
      shutterflyArchiveResponseSchema.parse(
        await required.archives.start(required.accountId, context.req.valid("json")?.parts),
      ),
      202,
    );
  });

  app.openapi(shutterflyArchiveRoute, async (context) => {
    const required = requireShutterflyArchives(context);

    if ("response" in required) {
      return required.response;
    }

    const archive = await required.archives.get(
      required.accountId,
      context.req.valid("param").archiveId,
    );

    if (!archive) {
      return toShutterflyArchiveErrorResponse(context, new ShutterflyArchiveNotFoundError());
    }

    return context.json(shutterflyArchiveResponseSchema.parse(archive), 200);
  });

  app.openapi(shutterflyArchiveResumeRoute, async (context) => {
    const required = requireShutterflyArchives(context);

    if ("response" in required) {
      return required.response;
    }

    if (!required.shutterfly.getStatus(required.accountId).connected) {
      return context.json(
        createErrorResponse(
          context,
          "shutterfly_not_connected",
          "Connect your Shutterfly account before resuming the archive.",
        ),
        409,
      );
    }

    try {
      const archive = await required.archives.resume(
        required.accountId,
        context.req.valid("param").archiveId,
      );

      return context.json(shutterflyArchiveResponseSchema.parse(archive), 202);
    } catch (error) {
      return toShutterflyArchiveErrorResponse(context, error);
    }
  });

  app.openapi(shutterflyArchiveDeleteRoute, async (context) => {
    const required = requireShutterflyArchives(context);

    if ("response" in required) {
      return required.response;
    }

    try {
      await required.archives.remove(required.accountId, context.req.valid("param").archiveId);

      return context.body(null, 204);
    } catch (error) {
      return toShutterflyArchiveErrorResponse(context, error);
    }
  });

  app.openapi(shutterflyArchiveDownloadRoute, async (context) => {
    const required = requireShutterflyArchives(context);

    if ("response" in required) {
      return required.response;
    }

    try {
      const download = await required.archives.download(
        required.accountId,
        context.req.valid("param").archiveId,
      );

      return context.body(
        Readable.toWeb(createZipStream(download.entries)) as ReadableStream<Uint8Array>,
        200,
        {
          "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="${download.fileName}"`,
          "content-length": String(download.size),
          "content-type": "application/zip",
        },
      );
    } catch (error) {
      return toShutterflyArchiveErrorResponse(context, error);
    }
  });

  app.all(mcpEndpointPath, async (context) => {
    // Stateless JSON-response mode: there is no standalone SSE stream or session to delete.
    if (context.req.method !== "POST") {
      context.header("Allow", "POST");
      return context.json(
        createErrorResponse(context, "method_not_allowed", "The MCP endpoint only accepts POST"),
        405,
      );
    }

    if (!options.repositories || !options.storage) {
      return context.json(
        createErrorResponse(context, "mcp_unavailable", "The MCP server is unavailable"),
        500,
      );
    }

    const token = parseBearerAccessToken(context.req.header("authorization"));
    const record = token
      ? options.repositories.accessTokens.findByTokenHash(hashAccessTokenSecret(token))
      : undefined;
    const account = record ? options.repositories.accounts.findById(record.accountId) : undefined;

    if (!record || !account) {
      context.header("WWW-Authenticate", 'Bearer realm="zakka"');
      return context.json(
        createErrorResponse(
          context,
          "not_authenticated",
          "A valid personal access token is required",
        ),
        401,
      );
    }

    options.repositories.accessTokens.touchLastUsed(record.id);

    const server = createZakkaMcpServer({
      accountId: account.id,
      ...(options.mapTiles ? { mapTiles: options.mapTiles } : {}),
      repositories: options.repositories,
      serverLogs: listServerLogs,
      ...(options.shutterfly
        ? { shutterfly: createMcpShutterflyAccess(options.shutterfly, options.repositories) }
        : {}),
      storage: options.storage,
      systemInfo: getSystemInfo,
      version: packageVersion,
    });
    // Omitting sessionIdGenerator runs the transport in stateless mode. The transport refuses
    // larger bodies before reading them, so an upload_image payload can't exhaust memory.
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: maxMcpRequestByteSize,
    });

    await server.connect(transport);

    try {
      return await transport.handleRequest(context.req.raw);
    } finally {
      await server.close();
    }
  });

  app.doc("/api/v1/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Zakka API",
      version: packageVersion,
    },
  });

  app.notFound(async (context) => {
    if (options.staticAssetsDir) {
      const staticAsset = await readStaticAsset(
        options.staticAssetsDir,
        new URL(context.req.url).pathname,
      );

      if (staticAsset) {
        return context.body(staticAsset.body, 200, {
          "cache-control": staticAsset.contentType.startsWith("text/html")
            ? "no-cache"
            : "public, max-age=31536000, immutable",
          "content-type": staticAsset.contentType,
        });
      }
    }

    const body: ErrorResponse = {
      error: {
        code: "not_found",
        message: "Route not found",
        requestId: context.get("requestId"),
      },
    };

    return context.json(body, 404);
  });

  app.onError((error, context) => {
    console.error(error);

    const body: ErrorResponse = {
      error: {
        code: "internal_error",
        message: "Unexpected server error",
        requestId: context.get("requestId"),
      },
    };

    return context.json(body, 500);
  });

  return app;
};
