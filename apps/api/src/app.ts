import { createRequire } from "node:module";

import { OpenAPIHono } from "@hono/zod-openapi";
import {
  type AccountResponse,
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
  type AlbumResponse,
  type AssetResponse,
  type AuthSessionResponse,
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
  currentSessionRoute,
  defaultBookPageSize,
  type ErrorResponse,
  type ExportJobResponse,
  exportContentRoute,
  exportCreateRoute,
  exportDetailRoute,
  exportJobResponseSchema,
  healthResponseSchema,
  healthRoute,
  loginRoute,
  logoutRoute,
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
  serverLogEntryResponseSchema,
  serverLogListResponseSchema,
  serverLogListRoute,
  customStickerContentRoute,
  customStickerFavoriteRoute,
  customStickerListResponseSchema,
  customStickerListRoute,
  customStickerResponseSchema,
  type CustomStickerResponse,
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
  type StickerPackResponse,
  type CustomWashiTapeResponse,
  customWashiTapeCreateRoute,
  customWashiTapeDeleteRoute,
  customWashiTapeListResponseSchema,
  customWashiTapeListRoute,
  customWashiTapePatchRoute,
  customWashiTapeResponseSchema,
} from "@zakka/api-contract";
import {
  createBookSpreads,
  createPageDocument,
  type PageDocument,
  pageDocumentSchema,
  type WashiTapeDesign,
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
  createSessionCookieValue,
  createSessionSecret,
  defaultSessionTtlMs,
  hashPassword,
  hashSessionSecret,
  normalizeEmail,
  parseSessionCookieValue,
  sessionCookieName,
  verifyPassword,
} from "./auth.js";
import { ExportRenderError, renderBookExport, renderPageExport } from "./exports.js";
import {
  OwnershipError,
  type Repositories,
  type RepositoryClock,
} from "./persistence/repositories.js";
import type {
  AlbumWithCountRecord,
  StickerPackWithCountRecord,
} from "./persistence/repositories.js";
import type {
  AccountRecord,
  AssetRecord,
  AssetVariantRecord,
  BookPageRecord,
  BookRecord,
  CustomStickerRecord,
  CustomWashiTapeRecord,
  ExportJobRecord,
  PageRecord,
  SessionRecord,
} from "./persistence/schema.js";
import { readStaticAsset } from "./static.js";
import { CustomStickerUploadError, createCustomStickerFromUpload } from "./custom-stickers.js";

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

const parseStoredPageDocument = (page: PageRecord): PageDocument => {
  try {
    return pageDocumentSchema.parse(JSON.parse(page.documentJson));
  } catch {
    return createPageDocument({ canvas: { width: page.width, height: page.height } });
  }
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

const slugifyDownloadName = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug.slice(0, 80) : "zakka-export";
};

const getExportContentType = (exportJob: ExportJobRecord): string => {
  if (exportJob.format === "pdf") {
    return "application/pdf";
  }

  if (exportJob.format === "jpeg") {
    return "image/jpeg";
  }

  return exportJob.bookId ? "application/zip" : "image/png";
};

const getExportDownloadFilename = (
  exportJob: ExportJobRecord,
  repositories: Repositories,
): string => {
  if (exportJob.bookId) {
    const book = repositories.books.findByIdForAccount(exportJob.accountId, exportJob.bookId);
    const name = slugifyDownloadName(book?.title ?? "zakka-book");

    return exportJob.format === "png" ? `${name}-png-pages.zip` : `${name}.${exportJob.format}`;
  }

  const page = exportJob.pageId
    ? repositories.pages.findByIdForAccount(exportJob.accountId, exportJob.pageId)
    : null;
  const name = slugifyDownloadName(page?.title ?? "zakka-page");

  return `${name}.${exportJob.format === "jpeg" ? "jpg" : exportJob.format}`;
};

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

const validatePageDocumentAssets = (
  accountId: string,
  document: PageDocument,
  repositories: Repositories,
): boolean => {
  const assetIds = new Set(
    document.layers.filter((layer) => layer.kind === "photo").map((layer) => layer.assetId),
  );

  for (const assetId of assetIds) {
    if (!repositories.assets.findByIdForAccount(accountId, assetId)) {
      return false;
    }
  }

  return true;
};

type WashiTapeDesignValidation = "ok" | "photo_required" | "asset_not_found";

const validateWashiTapeDesign = (
  accountId: string,
  design: WashiTapeDesign,
  repositories: Repositories,
): WashiTapeDesignValidation => {
  if (design.pattern.kind === "customPhoto" && !design.pattern.assetId) {
    return "photo_required";
  }

  if (
    design.pattern.assetId &&
    !repositories.assets.findByIdForAccount(accountId, design.pattern.assetId)
  ) {
    return "asset_not_found";
  }

  return "ok";
};

const washiTapeDesignErrorMessages: Record<Exclude<WashiTapeDesignValidation, "ok">, string> = {
  photo_required: "Custom photo washi tape needs a pattern photo",
  asset_not_found: "Washi tape pattern photos must be assets owned by the account",
};

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
    repositories: createOptions.repositories,
    sessionCookieSecure: createOptions.sessionCookieSecure,
    sessionTtlMs: createOptions.sessionTtlMs ?? defaultSessionTtlMs,
    staticAssetsDir: createOptions.staticAssetsDir,
    storage: createOptions.storage,
  };

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
    const minimumRank = serverLogLevelRank[level];
    const logs = serverLogEntries
      .filter((entry) => serverLogLevelRank[entry.level] >= minimumRank)
      .slice(-limit)
      .reverse();

    return context.json(serverLogListResponseSchema.parse({ level, logs }), 200);
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
          "Photo layers must reference assets owned by the account",
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
          "Photo layers must reference assets owned by the account",
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
    const pageWidth = input.pageWidth ?? defaultBookPageSize.width;
    const pageHeight = input.pageHeight ?? defaultBookPageSize.height;
    const book = options.repositories.books.create({
      accountId: authSession.account.id,
      title: input.title.trim(),
      pageWidth,
      pageHeight,
      coverSpreadEnabled: input.coverSpreadEnabled ?? true,
    });
    const frontCover = options.repositories.pages.create({
      accountId: authSession.account.id,
      title: "Front cover",
      width: pageWidth,
      height: pageHeight,
    });
    const backCover = options.repositories.pages.create({
      accountId: authSession.account.id,
      title: "Back cover",
      width: pageWidth,
      height: pageHeight,
    });

    options.repositories.books.addPage({
      accountId: authSession.account.id,
      bookId: book.id,
      pageId: frontCover.id,
      sortOrder: 0,
    });
    options.repositories.books.addPage({
      accountId: authSession.account.id,
      bookId: book.id,
      pageId: backCover.id,
      sortOrder: 1,
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
    let exportJob: ExportJobRecord;

    try {
      exportJob = options.repositories.exports.create({
        accountId: authSession.account.id,
        bookId: input.bookId ?? null,
        format: input.format,
        pageId: input.pageId ?? null,
        preset: input.preset,
      });
    } catch (error) {
      if (error instanceof OwnershipError) {
        return context.json(
          createErrorResponse(context, "export_target_not_found", "Export target was not found"),
          404,
        );
      }

      throw error;
    }

    options.repositories.exports.updateForAccount(authSession.account.id, exportJob.id, {
      status: "running",
    });

    try {
      const rendered = input.pageId
        ? await renderPageExport({
            accountId: authSession.account.id,
            ...(input.dpi === undefined ? {} : { dpi: input.dpi }),
            format: input.format,
            includeBackground: input.includeBackground ?? true,
            pageId: input.pageId,
            preset: input.preset,
            repositories: options.repositories,
            storage: options.storage,
          })
        : await renderBookExport({
            accountId: authSession.account.id,
            bookId: input.bookId ?? "",
            ...(input.dpi === undefined ? {} : { dpi: input.dpi }),
            format: input.format,
            includeBackground: input.includeBackground ?? true,
            preset: input.preset,
            repositories: options.repositories,
            storage: options.storage,
          });
      const stored = await options.storage.write("exports", rendered.buffer, {
        extension: rendered.extension,
      });
      const completedJob = options.repositories.exports.updateForAccount(
        authSession.account.id,
        exportJob.id,
        {
          outputStorageKey: stored.key,
          status: "completed",
        },
      );

      if (!completedJob) {
        return context.json(
          createErrorResponse(context, "export_not_found", "Export not found"),
          404,
        );
      }

      return context.json(toExportJobResponse(completedJob), 201);
    } catch (error) {
      const failedJob = options.repositories.exports.updateForAccount(
        authSession.account.id,
        exportJob.id,
        {
          errorMessage: error instanceof Error ? error.message : "Export failed",
          status: "failed",
        },
      );

      if (error instanceof ExportRenderError) {
        return context.json(
          createErrorResponse(
            context,
            failedJob?.errorMessage ? "export_failed" : error.code,
            failedJob?.errorMessage ?? error.message,
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
