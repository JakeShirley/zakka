import { createTimestamp, type ISODateTime } from "@zakka/domain";
import { createPageDocument } from "@zakka/editor-core";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";

import type { AppDatabase } from "./database.js";
import { createEntityId, createInternalId } from "./ids.js";
import { createMemoryPageDocumentStore, type PageDocumentStore } from "./page-documents.js";
import {
  type AccountPreferencesRecord,
  type AccountRecord,
  type AlbumAssetRecord,
  type AlbumRecord,
  type AssetRecord,
  type AssetVariantKind,
  type AssetVariantRecord,
  type AuthIdentityProvider,
  type AuthIdentityRecord,
  accountPreferences,
  accounts,
  albumAssets,
  albums,
  assets,
  assetVariants,
  authIdentities,
  type BookAssetRecord,
  type BookPageRecord,
  type BookRecord,
  bookAssets,
  bookPages,
  books,
  type CustomStickerRecord,
  type CustomWashiTapeRecord,
  customStickers,
  customWashiTapes,
  type ExportFormat,
  type ExportJobRecord,
  type ExportPreset,
  type ExternalMediaLinkRecord,
  exportJobs,
  externalMediaLinks,
  type IntegrationConnectionRecord,
  type IntegrationProvider,
  integrationConnections,
  type PageRecord,
  pages,
  type SessionRecord,
  sessions,
  type StickerPackRecord,
  stickerPacks,
} from "./schema.js";

export type RepositoryClock = () => Date;

export class OwnershipError extends Error {
  constructor(message = "Resource does not belong to the account") {
    super(message);
    this.name = "OwnershipError";
  }
}

const defaultClock: RepositoryClock = () => new Date();

const now = (clock: RepositoryClock): ISODateTime => createTimestamp(clock());

const createDefaultPageDocumentJson = (page: Pick<PageRecord, "height" | "width">): string =>
  JSON.stringify(createPageDocument({ canvas: { width: page.width, height: page.height } }));

const readPageDocumentJson = (page: PageRecord, pageDocuments: PageDocumentStore): string => {
  if (page.documentStorageKey) {
    const storedDocumentJson = pageDocuments.read(page.documentStorageKey);

    if (storedDocumentJson) {
      return storedDocumentJson;
    }
  }

  return page.documentJson.trim().length > 0
    ? page.documentJson
    : createDefaultPageDocumentJson(page);
};

const hydratePageRecord = (
  page: PageRecord | null,
  pageDocuments: PageDocumentStore,
): PageRecord | null => {
  if (!page) {
    return null;
  }

  return {
    ...page,
    documentJson: readPageDocumentJson(page, pageDocuments),
  };
};

export class AccountRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly clock: RepositoryClock = defaultClock,
  ) {}

  create(input: { displayName: string; primaryEmail: string; id?: string }): AccountRecord {
    const timestamp = now(this.clock);
    const record: AccountRecord = {
      id: input.id ?? createEntityId("account"),
      displayName: input.displayName,
      primaryEmail: input.primaryEmail,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(accounts).values(record).run();

    return record;
  }

  findById(id: string): AccountRecord | null {
    return this.db.select().from(accounts).where(eq(accounts.id, id)).get() ?? null;
  }

  findByPrimaryEmail(primaryEmail: string): AccountRecord | null {
    return (
      this.db.select().from(accounts).where(eq(accounts.primaryEmail, primaryEmail)).get() ?? null
    );
  }
}

export class AccountPreferencesRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly clock: RepositoryClock = defaultClock,
  ) {}

  findByAccountId(accountId: string): AccountPreferencesRecord | null {
    return (
      this.db
        .select()
        .from(accountPreferences)
        .where(eq(accountPreferences.accountId, accountId))
        .get() ?? null
    );
  }

  upsert(accountId: string, input: { uiTheme?: string }): AccountPreferencesRecord {
    const timestamp = now(this.clock);
    const existing = this.findByAccountId(accountId);

    if (existing) {
      const next: AccountPreferencesRecord = {
        ...existing,
        uiTheme: input.uiTheme ?? existing.uiTheme,
        updatedAt: timestamp,
      };

      this.db
        .update(accountPreferences)
        .set({ uiTheme: next.uiTheme, updatedAt: timestamp })
        .where(eq(accountPreferences.accountId, accountId))
        .run();

      return next;
    }

    const record: AccountPreferencesRecord = {
      accountId,
      uiTheme: input.uiTheme ?? "system",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(accountPreferences).values(record).run();

    return record;
  }
}

export class AuthIdentityRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly clock: RepositoryClock = defaultClock,
  ) {}

  create(input: {
    accountId: string;
    provider: AuthIdentityProvider;
    providerSubject: string;
    passwordHash?: string | null;
    id?: string;
  }): AuthIdentityRecord {
    const timestamp = now(this.clock);
    const record: AuthIdentityRecord = {
      id: input.id ?? createInternalId("authIdentity"),
      accountId: input.accountId,
      provider: input.provider,
      providerSubject: input.providerSubject,
      passwordHash: input.passwordHash ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(authIdentities).values(record).run();

    return record;
  }

  findByProviderSubject(
    provider: AuthIdentityProvider,
    providerSubject: string,
  ): AuthIdentityRecord | null {
    return (
      this.db
        .select()
        .from(authIdentities)
        .where(
          and(
            eq(authIdentities.provider, provider),
            eq(authIdentities.providerSubject, providerSubject),
          ),
        )
        .get() ?? null
    );
  }
}

export class SessionRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly clock: RepositoryClock = defaultClock,
  ) {}

  create(input: {
    accountId: string;
    secretHash: string;
    expiresAt: ISODateTime;
    userAgent?: string | null;
    ipAddress?: string | null;
    id?: string;
  }): SessionRecord {
    const timestamp = now(this.clock);
    const record: SessionRecord = {
      id: input.id ?? createEntityId("session"),
      accountId: input.accountId,
      secretHash: input.secretHash,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(sessions).values(record).run();

    return record;
  }

  findActiveByIdForAccount(accountId: string, sessionId: string): SessionRecord | null {
    return (
      this.db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.accountId, accountId),
            eq(sessions.id, sessionId),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now(this.clock)),
          ),
        )
        .get() ?? null
    );
  }

  findActiveById(sessionId: string): SessionRecord | null {
    return (
      this.db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.id, sessionId),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now(this.clock)),
          ),
        )
        .get() ?? null
    );
  }

  revokeByIdForAccount(accountId: string, sessionId: string): void {
    const timestamp = now(this.clock);

    this.db
      .update(sessions)
      .set({ revokedAt: timestamp, updatedAt: timestamp })
      .where(
        and(
          eq(sessions.accountId, accountId),
          eq(sessions.id, sessionId),
          isNull(sessions.revokedAt),
        ),
      )
      .run();
  }
}

export class AssetRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly clock: RepositoryClock = defaultClock,
  ) {}

  createOriginal(input: {
    accountId: string;
    originalStorageKey: string;
    originalFilename: string;
    mimeType: string;
    byteSize: number;
    checksumSha256: string;
    width?: number | null;
    height?: number | null;
    dateTaken?: string | null;
    cameraMake?: string | null;
    cameraModel?: string | null;
    lensModel?: string | null;
    isoSpeed?: number | null;
    fNumber?: number | null;
    exposureTimeSeconds?: number | null;
    focalLengthMm?: number | null;
    focalLength35mmMm?: number | null;
    orientation?: number | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    gpsAltitudeMeters?: number | null;
    id?: string;
  }): AssetRecord {
    const timestamp = now(this.clock);
    const record: AssetRecord = {
      id: input.id ?? createEntityId("asset"),
      accountId: input.accountId,
      originalStorageKey: input.originalStorageKey,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      width: input.width ?? null,
      height: input.height ?? null,
      checksumSha256: input.checksumSha256,
      dateTaken: input.dateTaken ?? null,
      cameraMake: input.cameraMake ?? null,
      cameraModel: input.cameraModel ?? null,
      lensModel: input.lensModel ?? null,
      isoSpeed: input.isoSpeed ?? null,
      fNumber: input.fNumber ?? null,
      exposureTimeSeconds: input.exposureTimeSeconds ?? null,
      focalLengthMm: input.focalLengthMm ?? null,
      focalLength35mmMm: input.focalLength35mmMm ?? null,
      orientation: input.orientation ?? null,
      gpsLatitude: input.gpsLatitude ?? null,
      gpsLongitude: input.gpsLongitude ?? null,
      gpsAltitudeMeters: input.gpsAltitudeMeters ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(assets).values(record).run();

    return record;
  }

  createVariant(input: {
    accountId: string;
    assetId: string;
    kind: AssetVariantKind;
    storageKey: string;
    mimeType: string;
    byteSize: number;
    checksumSha256: string;
    width?: number | null;
    height?: number | null;
    id?: string;
  }): AssetVariantRecord {
    const owner = this.findByIdForAccount(input.accountId, input.assetId);

    if (!owner) {
      throw new OwnershipError("Asset variant cannot be attached across accounts");
    }

    const timestamp = now(this.clock);
    const record: AssetVariantRecord = {
      id: input.id ?? createInternalId("assetVariant"),
      accountId: input.accountId,
      assetId: input.assetId,
      kind: input.kind,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      width: input.width ?? null,
      height: input.height ?? null,
      checksumSha256: input.checksumSha256,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(assetVariants).values(record).run();

    return record;
  }

  findByIdForAccount(accountId: string, assetId: string): AssetRecord | null {
    return (
      this.db
        .select()
        .from(assets)
        .where(and(eq(assets.accountId, accountId), eq(assets.id, assetId)))
        .get() ?? null
    );
  }

  findVariantByKindForAccount(
    accountId: string,
    assetId: string,
    kind: AssetVariantKind,
  ): AssetVariantRecord | null {
    return (
      this.db
        .select()
        .from(assetVariants)
        .where(
          and(
            eq(assetVariants.accountId, accountId),
            eq(assetVariants.assetId, assetId),
            eq(assetVariants.kind, kind),
          ),
        )
        .get() ?? null
    );
  }

  findVariantByIdForAccount(
    accountId: string,
    assetId: string,
    variantId: string,
  ): AssetVariantRecord | null {
    return (
      this.db
        .select()
        .from(assetVariants)
        .where(
          and(
            eq(assetVariants.accountId, accountId),
            eq(assetVariants.assetId, assetId),
            eq(assetVariants.id, variantId),
          ),
        )
        .get() ?? null
    );
  }

  listVariantsForAsset(accountId: string, assetId: string): AssetVariantRecord[] {
    return this.db
      .select()
      .from(assetVariants)
      .where(and(eq(assetVariants.accountId, accountId), eq(assetVariants.assetId, assetId)))
      .orderBy(assetVariants.kind)
      .all();
  }

  listForAccount(accountId: string): AssetRecord[] {
    return this.db
      .select()
      .from(assets)
      .where(eq(assets.accountId, accountId))
      .orderBy(desc(assets.createdAt))
      .all();
  }
}

export class PageRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly clock: RepositoryClock = defaultClock,
    private readonly pageDocuments: PageDocumentStore = createMemoryPageDocumentStore(),
  ) {}

  create(input: {
    accountId: string;
    title: string;
    width: number;
    height: number;
    documentJson?: string;
    id?: string;
  }): PageRecord {
    const timestamp = now(this.clock);
    const pageId = input.id ?? createEntityId("page");
    const documentJson = input.documentJson ?? createDefaultPageDocumentJson(input);
    const documentStorageKey = this.pageDocuments.createKey({
      accountId: input.accountId,
      pageId,
    });
    const record: PageRecord = {
      id: pageId,
      accountId: input.accountId,
      title: input.title,
      width: input.width,
      height: input.height,
      documentJson: "",
      documentStorageKey,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.pageDocuments.write(documentStorageKey, documentJson, { overwrite: false });

    try {
      this.db.insert(pages).values(record).run();
    } catch (error) {
      this.pageDocuments.remove(documentStorageKey);
      throw error;
    }

    return { ...record, documentJson };
  }

  findByIdForAccount(accountId: string, pageId: string): PageRecord | null {
    return hydratePageRecord(
      this.db
        .select()
        .from(pages)
        .where(and(eq(pages.accountId, accountId), eq(pages.id, pageId)))
        .get() ?? null,
      this.pageDocuments,
    );
  }

  listForAccount(accountId: string): PageRecord[] {
    return this.db
      .select()
      .from(pages)
      .where(eq(pages.accountId, accountId))
      .orderBy(desc(pages.updatedAt))
      .all()
      .map((page) => hydratePageRecord(page, this.pageDocuments) ?? page);
  }

  updateForAccount(
    accountId: string,
    pageId: string,
    input: Partial<Pick<PageRecord, "documentJson" | "height" | "title" | "width">>,
  ): PageRecord | null {
    const existing = this.findByIdForAccount(accountId, pageId);

    if (!existing) {
      return null;
    }

    const timestamp = now(this.clock);
    const documentJson = input.documentJson ?? existing.documentJson;
    const documentStorageKey =
      existing.documentStorageKey ??
      this.pageDocuments.createKey({ accountId: existing.accountId, pageId: existing.id });

    if (input.documentJson !== undefined || !existing.documentStorageKey) {
      this.pageDocuments.write(documentStorageKey, documentJson, {
        overwrite: existing.documentStorageKey !== null,
      });
    }

    const nextRecord = {
      title: input.title ?? existing.title,
      width: input.width ?? existing.width,
      height: input.height ?? existing.height,
      documentJson: "",
      documentStorageKey,
      updatedAt: timestamp,
    };

    this.db
      .update(pages)
      .set(nextRecord)
      .where(and(eq(pages.accountId, accountId), eq(pages.id, pageId)))
      .run();

    return this.findByIdForAccount(accountId, pageId);
  }

  deleteByIdForAccount(accountId: string, pageId: string): boolean {
    const existing = this.findByIdForAccount(accountId, pageId);

    const result = this.db
      .delete(pages)
      .where(and(eq(pages.accountId, accountId), eq(pages.id, pageId)))
      .run();

    if (result.changes > 0 && existing?.documentStorageKey) {
      this.pageDocuments.remove(existing.documentStorageKey);
    }

    return result.changes > 0;
  }
}

export class BookRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly clock: RepositoryClock = defaultClock,
    private readonly pageDocuments: PageDocumentStore = createMemoryPageDocumentStore(),
  ) {}

  create(input: {
    accountId: string;
    title: string;
    pageWidth: number;
    pageHeight: number;
    coverSpreadEnabled?: boolean;
    id?: string;
  }): BookRecord {
    const timestamp = now(this.clock);
    const record: BookRecord = {
      id: input.id ?? createEntityId("book"),
      accountId: input.accountId,
      title: input.title,
      pageWidth: input.pageWidth,
      pageHeight: input.pageHeight,
      coverSpreadEnabled: input.coverSpreadEnabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(books).values(record).run();

    return record;
  }

  findByIdForAccount(accountId: string, bookId: string): BookRecord | null {
    return (
      this.db
        .select()
        .from(books)
        .where(and(eq(books.accountId, accountId), eq(books.id, bookId)))
        .get() ?? null
    );
  }

  listForAccount(accountId: string): BookRecord[] {
    return this.db
      .select()
      .from(books)
      .where(eq(books.accountId, accountId))
      .orderBy(desc(books.updatedAt))
      .all();
  }

  updateForAccount(
    accountId: string,
    bookId: string,
    input: Partial<Pick<BookRecord, "coverSpreadEnabled" | "pageHeight" | "pageWidth" | "title">>,
  ): BookRecord | null {
    const existing = this.findByIdForAccount(accountId, bookId);

    if (!existing) {
      return null;
    }

    this.db
      .update(books)
      .set({
        title: input.title ?? existing.title,
        pageWidth: input.pageWidth ?? existing.pageWidth,
        pageHeight: input.pageHeight ?? existing.pageHeight,
        coverSpreadEnabled: input.coverSpreadEnabled ?? existing.coverSpreadEnabled,
        updatedAt: now(this.clock),
      })
      .where(and(eq(books.accountId, accountId), eq(books.id, bookId)))
      .run();

    return this.findByIdForAccount(accountId, bookId);
  }

  deleteByIdForAccount(accountId: string, bookId: string): boolean {
    this.db
      .delete(exportJobs)
      .where(and(eq(exportJobs.accountId, accountId), eq(exportJobs.bookId, bookId)))
      .run();

    const result = this.db
      .delete(books)
      .where(and(eq(books.accountId, accountId), eq(books.id, bookId)))
      .run();

    return result.changes > 0;
  }

  listPagesForBook(
    accountId: string,
    bookId: string,
  ): Array<{ bookPage: BookPageRecord; page: PageRecord }> {
    return this.db
      .select({ bookPage: bookPages, page: pages })
      .from(bookPages)
      .innerJoin(pages, and(eq(bookPages.pageId, pages.id), eq(pages.accountId, accountId)))
      .where(and(eq(bookPages.accountId, accountId), eq(bookPages.bookId, bookId)))
      .orderBy(asc(bookPages.sortOrder))
      .all()
      .map(({ bookPage, page }) => ({
        bookPage,
        page: hydratePageRecord(page, this.pageDocuments) ?? page,
      }));
  }

  addPage(input: {
    accountId: string;
    bookId: string;
    pageId: string;
    sortOrder: number;
    id?: string;
  }): BookPageRecord {
    const book = this.findByIdForAccount(input.accountId, input.bookId);
    const page =
      this.db
        .select()
        .from(pages)
        .where(and(eq(pages.accountId, input.accountId), eq(pages.id, input.pageId)))
        .get() ?? null;

    if (!book || !page) {
      throw new OwnershipError("Book pages cannot cross account boundaries");
    }

    const timestamp = now(this.clock);
    const record: BookPageRecord = {
      id: input.id ?? createInternalId("bookPage"),
      accountId: input.accountId,
      bookId: input.bookId,
      pageId: input.pageId,
      sortOrder: input.sortOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(bookPages).values(record).run();

    return record;
  }

  replacePages(input: { accountId: string; bookId: string; pageIds: string[] }): BookPageRecord[] {
    const book = this.findByIdForAccount(input.accountId, input.bookId);

    if (!book) {
      throw new OwnershipError("Book does not belong to the account");
    }

    const uniquePageIds = new Set(input.pageIds);

    if (uniquePageIds.size !== input.pageIds.length) {
      throw new OwnershipError("A page can only appear once in a book");
    }

    for (const pageId of input.pageIds) {
      const page =
        this.db
          .select({ id: pages.id })
          .from(pages)
          .where(and(eq(pages.accountId, input.accountId), eq(pages.id, pageId)))
          .get() ?? null;

      if (!page) {
        throw new OwnershipError("Book pages cannot cross account boundaries");
      }
    }

    const timestamp = now(this.clock);
    const records = input.pageIds.map<BookPageRecord>((pageId, sortOrder) => ({
      id: createInternalId("bookPage"),
      accountId: input.accountId,
      bookId: input.bookId,
      pageId,
      sortOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));

    this.db
      .delete(bookPages)
      .where(and(eq(bookPages.accountId, input.accountId), eq(bookPages.bookId, input.bookId)))
      .run();

    if (records.length > 0) {
      this.db.insert(bookPages).values(records).run();
    }

    this.db
      .update(books)
      .set({ updatedAt: timestamp })
      .where(and(eq(books.accountId, input.accountId), eq(books.id, input.bookId)))
      .run();

    return records;
  }

  listAssetsForBook(accountId: string, bookId: string): AssetRecord[] {
    return this.db
      .select({ asset: assets })
      .from(bookAssets)
      .innerJoin(assets, and(eq(bookAssets.assetId, assets.id), eq(assets.accountId, accountId)))
      .where(and(eq(bookAssets.accountId, accountId), eq(bookAssets.bookId, bookId)))
      .orderBy(desc(bookAssets.sortOrder))
      .all()
      .map(({ asset }) => asset);
  }

  addAssetsToBook(input: {
    accountId: string;
    bookId: string;
    assetIds: string[];
  }): BookAssetRecord[] {
    const book = this.findByIdForAccount(input.accountId, input.bookId);

    if (!book) {
      throw new OwnershipError("Book does not belong to the account");
    }

    const uniqueAssetIds = Array.from(new Set(input.assetIds));

    if (uniqueAssetIds.length === 0) {
      return [];
    }

    for (const assetId of uniqueAssetIds) {
      const asset =
        this.db
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.accountId, input.accountId), eq(assets.id, assetId)))
          .get() ?? null;

      if (!asset) {
        throw new OwnershipError("Book assets cannot cross account boundaries");
      }
    }

    const existingAssetIds = new Set(
      this.db
        .select({ assetId: bookAssets.assetId })
        .from(bookAssets)
        .where(and(eq(bookAssets.accountId, input.accountId), eq(bookAssets.bookId, input.bookId)))
        .all()
        .map((row) => row.assetId),
    );

    const newAssetIds = uniqueAssetIds.filter((assetId) => !existingAssetIds.has(assetId));

    if (newAssetIds.length === 0) {
      return [];
    }

    const maxSortRow = this.db
      .select({ value: bookAssets.sortOrder })
      .from(bookAssets)
      .where(and(eq(bookAssets.accountId, input.accountId), eq(bookAssets.bookId, input.bookId)))
      .orderBy(desc(bookAssets.sortOrder))
      .limit(1)
      .get();
    const nextSortOrderStart = (maxSortRow?.value ?? -1) + 1;

    const timestamp = now(this.clock);
    const records = newAssetIds.map<BookAssetRecord>((assetId, index) => ({
      id: createInternalId("bookAsset"),
      accountId: input.accountId,
      bookId: input.bookId,
      assetId,
      sortOrder: nextSortOrderStart + index,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));

    this.db.insert(bookAssets).values(records).run();

    this.db
      .update(books)
      .set({ updatedAt: timestamp })
      .where(and(eq(books.accountId, input.accountId), eq(books.id, input.bookId)))
      .run();

    return records;
  }

  removeAssetFromBook(input: { accountId: string; bookId: string; assetId: string }): boolean {
    const book = this.findByIdForAccount(input.accountId, input.bookId);

    if (!book) {
      throw new OwnershipError("Book does not belong to the account");
    }

    const result = this.db
      .delete(bookAssets)
      .where(
        and(
          eq(bookAssets.accountId, input.accountId),
          eq(bookAssets.bookId, input.bookId),
          eq(bookAssets.assetId, input.assetId),
        ),
      )
      .run();

    if (result.changes > 0) {
      this.db
        .update(books)
        .set({ updatedAt: now(this.clock) })
        .where(and(eq(books.accountId, input.accountId), eq(books.id, input.bookId)))
        .run();
    }

    return result.changes > 0;
  }
}

export type AlbumWithCountRecord = AlbumRecord & { photoCount: number };

export class AlbumRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly clock: RepositoryClock = defaultClock,
  ) {}

  create(input: { accountId: string; title: string; id?: string }): AlbumRecord {
    const timestamp = now(this.clock);
    const record: AlbumRecord = {
      id: input.id ?? createEntityId("album"),
      accountId: input.accountId,
      title: input.title,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(albums).values(record).run();

    return record;
  }

  update(input: { accountId: string; albumId: string; title: string }): AlbumRecord | null {
    const existing = this.findByIdForAccount(input.accountId, input.albumId);

    if (!existing) {
      return null;
    }

    const timestamp = now(this.clock);

    this.db
      .update(albums)
      .set({ title: input.title, updatedAt: timestamp })
      .where(and(eq(albums.accountId, input.accountId), eq(albums.id, input.albumId)))
      .run();

    return { ...existing, title: input.title, updatedAt: timestamp };
  }

  delete(input: { accountId: string; albumId: string }): boolean {
    const result = this.db
      .delete(albums)
      .where(and(eq(albums.accountId, input.accountId), eq(albums.id, input.albumId)))
      .run();

    return result.changes > 0;
  }

  findByIdForAccount(accountId: string, albumId: string): AlbumRecord | null {
    return (
      this.db
        .select()
        .from(albums)
        .where(and(eq(albums.accountId, accountId), eq(albums.id, albumId)))
        .get() ?? null
    );
  }

  listForAccount(accountId: string): AlbumWithCountRecord[] {
    const rows = this.db
      .select({
        album: albums,
        photoCount: sql<number>`COUNT(${albumAssets.id})`.as("photo_count"),
      })
      .from(albums)
      .leftJoin(albumAssets, eq(albumAssets.albumId, albums.id))
      .where(eq(albums.accountId, accountId))
      .groupBy(albums.id)
      .orderBy(asc(albums.title))
      .all();

    return rows.map((row) => ({ ...row.album, photoCount: Number(row.photoCount) }));
  }

  listAssetsForAlbum(accountId: string, albumId: string): AssetRecord[] {
    return this.db
      .select({ asset: assets })
      .from(albumAssets)
      .innerJoin(assets, and(eq(albumAssets.assetId, assets.id), eq(assets.accountId, accountId)))
      .where(and(eq(albumAssets.accountId, accountId), eq(albumAssets.albumId, albumId)))
      .orderBy(desc(albumAssets.sortOrder))
      .all()
      .map(({ asset }) => asset);
  }

  listAlbumIdsForAsset(accountId: string, assetId: string): string[] {
    return this.db
      .select({ albumId: albumAssets.albumId })
      .from(albumAssets)
      .where(and(eq(albumAssets.accountId, accountId), eq(albumAssets.assetId, assetId)))
      .all()
      .map((row) => row.albumId);
  }

  listAlbumsForAsset(accountId: string, assetId: string): AlbumWithCountRecord[] {
    const memberIds = new Set(this.listAlbumIdsForAsset(accountId, assetId));

    if (memberIds.size === 0) {
      return [];
    }

    return this.listForAccount(accountId).filter((album) => memberIds.has(album.id));
  }

  addAssetsToAlbum(input: {
    accountId: string;
    albumId: string;
    assetIds: string[];
  }): AlbumAssetRecord[] {
    const album = this.findByIdForAccount(input.accountId, input.albumId);

    if (!album) {
      throw new OwnershipError("Album does not belong to the account");
    }

    const uniqueAssetIds = Array.from(new Set(input.assetIds));

    if (uniqueAssetIds.length === 0) {
      return [];
    }

    for (const assetId of uniqueAssetIds) {
      const asset =
        this.db
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.accountId, input.accountId), eq(assets.id, assetId)))
          .get() ?? null;

      if (!asset) {
        throw new OwnershipError("Album assets cannot cross account boundaries");
      }
    }

    const existingAssetIds = new Set(
      this.db
        .select({ assetId: albumAssets.assetId })
        .from(albumAssets)
        .where(
          and(eq(albumAssets.accountId, input.accountId), eq(albumAssets.albumId, input.albumId)),
        )
        .all()
        .map((row) => row.assetId),
    );

    const newAssetIds = uniqueAssetIds.filter((assetId) => !existingAssetIds.has(assetId));

    if (newAssetIds.length === 0) {
      return [];
    }

    const maxSortRow = this.db
      .select({ value: albumAssets.sortOrder })
      .from(albumAssets)
      .where(
        and(eq(albumAssets.accountId, input.accountId), eq(albumAssets.albumId, input.albumId)),
      )
      .orderBy(desc(albumAssets.sortOrder))
      .limit(1)
      .get();
    const nextSortOrderStart = (maxSortRow?.value ?? -1) + 1;

    const timestamp = now(this.clock);
    const records = newAssetIds.map<AlbumAssetRecord>((assetId, index) => ({
      id: createInternalId("albumAsset"),
      accountId: input.accountId,
      albumId: input.albumId,
      assetId,
      sortOrder: nextSortOrderStart + index,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));

    this.db.insert(albumAssets).values(records).run();

    this.db
      .update(albums)
      .set({ updatedAt: timestamp })
      .where(and(eq(albums.accountId, input.accountId), eq(albums.id, input.albumId)))
      .run();

    return records;
  }

  removeAssetFromAlbum(input: { accountId: string; albumId: string; assetId: string }): boolean {
    const album = this.findByIdForAccount(input.accountId, input.albumId);

    if (!album) {
      throw new OwnershipError("Album does not belong to the account");
    }

    const result = this.db
      .delete(albumAssets)
      .where(
        and(
          eq(albumAssets.accountId, input.accountId),
          eq(albumAssets.albumId, input.albumId),
          eq(albumAssets.assetId, input.assetId),
        ),
      )
      .run();

    if (result.changes > 0) {
      this.db
        .update(albums)
        .set({ updatedAt: now(this.clock) })
        .where(and(eq(albums.accountId, input.accountId), eq(albums.id, input.albumId)))
        .run();
    }

    return result.changes > 0;
  }
}

export type StickerPackWithCountRecord = StickerPackRecord & { stickerCount: number };

export class StickerPackRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly clock: RepositoryClock = defaultClock,
  ) {}

  create(input: {
    accountId: string;
    title: string;
    author?: string | null;
    sourceUrl?: string | null;
    id?: string;
  }): StickerPackRecord {
    const timestamp = now(this.clock);
    const record: StickerPackRecord = {
      id: input.id ?? createInternalId("stickerPack"),
      accountId: input.accountId,
      title: input.title,
      author: input.author ?? null,
      sourceUrl: input.sourceUrl ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(stickerPacks).values(record).run();

    return record;
  }

  update(input: {
    accountId: string;
    packId: string;
    title?: string;
    author?: string | null;
    sourceUrl?: string | null;
  }): StickerPackRecord | null {
    const existing = this.findByIdForAccount(input.accountId, input.packId);

    if (!existing) {
      return null;
    }

    const timestamp = now(this.clock);
    const next: StickerPackRecord = {
      ...existing,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.author !== undefined ? { author: input.author } : {}),
      ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
      updatedAt: timestamp,
    };

    this.db
      .update(stickerPacks)
      .set({
        title: next.title,
        author: next.author,
        sourceUrl: next.sourceUrl,
        updatedAt: timestamp,
      })
      .where(and(eq(stickerPacks.accountId, input.accountId), eq(stickerPacks.id, input.packId)))
      .run();

    return next;
  }

  delete(input: { accountId: string; packId: string }): {
    deleted: boolean;
    removedStickers: CustomStickerRecord[];
  } {
    const stickersToRemove = this.db
      .select()
      .from(customStickers)
      .where(
        and(eq(customStickers.accountId, input.accountId), eq(customStickers.packId, input.packId)),
      )
      .all();

    const result = this.db
      .delete(stickerPacks)
      .where(and(eq(stickerPacks.accountId, input.accountId), eq(stickerPacks.id, input.packId)))
      .run();

    if (result.changes === 0) {
      return { deleted: false, removedStickers: [] };
    }

    return { deleted: true, removedStickers: stickersToRemove };
  }

  findByIdForAccount(accountId: string, packId: string): StickerPackRecord | null {
    return (
      this.db
        .select()
        .from(stickerPacks)
        .where(and(eq(stickerPacks.accountId, accountId), eq(stickerPacks.id, packId)))
        .get() ?? null
    );
  }

  listForAccount(accountId: string): StickerPackWithCountRecord[] {
    const rows = this.db
      .select({
        pack: stickerPacks,
        stickerCount: sql<number>`COUNT(${customStickers.id})`.as("sticker_count"),
      })
      .from(stickerPacks)
      .leftJoin(customStickers, eq(customStickers.packId, stickerPacks.id))
      .where(eq(stickerPacks.accountId, accountId))
      .groupBy(stickerPacks.id)
      .orderBy(asc(stickerPacks.title))
      .all();

    return rows.map((row) => ({ ...row.pack, stickerCount: Number(row.stickerCount) }));
  }

  listStickersForPack(accountId: string, packId: string): CustomStickerRecord[] {
    return this.db
      .select()
      .from(customStickers)
      .where(and(eq(customStickers.accountId, accountId), eq(customStickers.packId, packId)))
      .orderBy(asc(customStickers.sortOrder))
      .all();
  }

  listStickersForAccount(accountId: string): CustomStickerRecord[] {
    return this.db
      .select()
      .from(customStickers)
      .where(eq(customStickers.accountId, accountId))
      .orderBy(asc(customStickers.sortOrder))
      .all();
  }

  findStickerByIdForAccount(accountId: string, stickerId: string): CustomStickerRecord | null {
    return (
      this.db
        .select()
        .from(customStickers)
        .where(and(eq(customStickers.accountId, accountId), eq(customStickers.id, stickerId)))
        .get() ?? null
    );
  }

  findStickerInPackByChecksum(
    accountId: string,
    packId: string,
    checksumSha256: string,
  ): CustomStickerRecord | null {
    return (
      this.db
        .select()
        .from(customStickers)
        .where(
          and(
            eq(customStickers.accountId, accountId),
            eq(customStickers.packId, packId),
            eq(customStickers.checksumSha256, checksumSha256),
          ),
        )
        .get() ?? null
    );
  }

  addStickerToPack(input: {
    accountId: string;
    packId: string;
    name: string;
    storageKey: string;
    mimeType: string;
    byteSize: number;
    width: number | null;
    height: number | null;
    checksumSha256: string;
    id?: string;
  }): CustomStickerRecord {
    const pack = this.findByIdForAccount(input.accountId, input.packId);

    if (!pack) {
      throw new OwnershipError("Sticker pack does not belong to the account");
    }

    const maxSortRow = this.db
      .select({ value: customStickers.sortOrder })
      .from(customStickers)
      .where(
        and(eq(customStickers.accountId, input.accountId), eq(customStickers.packId, input.packId)),
      )
      .orderBy(desc(customStickers.sortOrder))
      .limit(1)
      .get();
    const nextSortOrder = (maxSortRow?.value ?? -1) + 1;

    const timestamp = now(this.clock);
    const record: CustomStickerRecord = {
      id: input.id ?? createInternalId("customSticker"),
      accountId: input.accountId,
      packId: input.packId,
      name: input.name,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      width: input.width,
      height: input.height,
      checksumSha256: input.checksumSha256,
      sortOrder: nextSortOrder,
      isFavorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(customStickers).values(record).run();
    this.db
      .update(stickerPacks)
      .set({ updatedAt: timestamp })
      .where(and(eq(stickerPacks.accountId, input.accountId), eq(stickerPacks.id, input.packId)))
      .run();

    return record;
  }

  removeStickerFromPack(input: {
    accountId: string;
    stickerId: string;
  }): CustomStickerRecord | null {
    const existing = this.findStickerByIdForAccount(input.accountId, input.stickerId);

    if (!existing) {
      return null;
    }

    const result = this.db
      .delete(customStickers)
      .where(
        and(eq(customStickers.accountId, input.accountId), eq(customStickers.id, input.stickerId)),
      )
      .run();

    if (result.changes === 0) {
      return null;
    }

    this.db
      .update(stickerPacks)
      .set({ updatedAt: now(this.clock) })
      .where(and(eq(stickerPacks.accountId, input.accountId), eq(stickerPacks.id, existing.packId)))
      .run();

    return existing;
  }

  setStickerFavorite(input: {
    accountId: string;
    stickerId: string;
    isFavorite: boolean;
  }): CustomStickerRecord | null {
    const existing = this.findStickerByIdForAccount(input.accountId, input.stickerId);

    if (!existing) {
      return null;
    }

    if (existing.isFavorite === input.isFavorite) {
      return existing;
    }

    const timestamp = now(this.clock);
    this.db
      .update(customStickers)
      .set({ isFavorite: input.isFavorite, updatedAt: timestamp })
      .where(
        and(eq(customStickers.accountId, input.accountId), eq(customStickers.id, input.stickerId)),
      )
      .run();

    return { ...existing, isFavorite: input.isFavorite, updatedAt: timestamp };
  }

  listFavoriteStickersForAccount(accountId: string): CustomStickerRecord[] {
    return this.db
      .select()
      .from(customStickers)
      .where(and(eq(customStickers.accountId, accountId), eq(customStickers.isFavorite, true)))
      .orderBy(asc(customStickers.sortOrder))
      .all();
  }
}

export class CustomWashiTapeRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly clock: RepositoryClock = defaultClock,
  ) {}

  create(input: {
    accountId: string;
    name: string;
    designJson: string;
    id?: string;
  }): CustomWashiTapeRecord {
    const timestamp = now(this.clock);
    const record: CustomWashiTapeRecord = {
      id: input.id ?? createInternalId("customWashiTape"),
      accountId: input.accountId,
      name: input.name,
      designJson: input.designJson,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(customWashiTapes).values(record).run();

    return record;
  }

  listForAccount(accountId: string): CustomWashiTapeRecord[] {
    return this.db
      .select()
      .from(customWashiTapes)
      .where(eq(customWashiTapes.accountId, accountId))
      .orderBy(desc(customWashiTapes.createdAt), desc(sql`rowid`))
      .all();
  }

  findByIdForAccount(accountId: string, washiTapeId: string): CustomWashiTapeRecord | null {
    return (
      this.db
        .select()
        .from(customWashiTapes)
        .where(and(eq(customWashiTapes.accountId, accountId), eq(customWashiTapes.id, washiTapeId)))
        .get() ?? null
    );
  }

  update(input: {
    accountId: string;
    washiTapeId: string;
    name?: string;
    designJson?: string;
  }): CustomWashiTapeRecord | null {
    const existing = this.findByIdForAccount(input.accountId, input.washiTapeId);

    if (!existing) {
      return null;
    }

    const next: CustomWashiTapeRecord = {
      ...existing,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.designJson !== undefined ? { designJson: input.designJson } : {}),
      updatedAt: now(this.clock),
    };

    this.db
      .update(customWashiTapes)
      .set({ name: next.name, designJson: next.designJson, updatedAt: next.updatedAt })
      .where(
        and(
          eq(customWashiTapes.accountId, input.accountId),
          eq(customWashiTapes.id, input.washiTapeId),
        ),
      )
      .run();

    return next;
  }

  delete(input: { accountId: string; washiTapeId: string }): boolean {
    const result = this.db
      .delete(customWashiTapes)
      .where(
        and(
          eq(customWashiTapes.accountId, input.accountId),
          eq(customWashiTapes.id, input.washiTapeId),
        ),
      )
      .run();

    return result.changes > 0;
  }
}

export class ExportJobRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly clock: RepositoryClock = defaultClock,
  ) {}

  create(input: {
    accountId: string;
    format: ExportFormat;
    preset?: ExportPreset;
    bookId?: string | null;
    pageId?: string | null;
    outputStorageKey?: string | null;
    errorMessage?: string | null;
    id?: string;
  }): ExportJobRecord {
    const hasBook = input.bookId
      ? this.db
          .select({ id: books.id })
          .from(books)
          .where(and(eq(books.accountId, input.accountId), eq(books.id, input.bookId)))
          .get()
      : null;
    const hasPage = input.pageId
      ? this.db
          .select({ id: pages.id })
          .from(pages)
          .where(and(eq(pages.accountId, input.accountId), eq(pages.id, input.pageId)))
          .get()
      : null;

    if (!hasBook && !hasPage) {
      throw new OwnershipError("Export target must belong to the account");
    }

    const timestamp = now(this.clock);
    const record: ExportJobRecord = {
      id: input.id ?? createEntityId("export"),
      accountId: input.accountId,
      bookId: input.bookId ?? null,
      pageId: input.pageId ?? null,
      status: "queued",
      format: input.format,
      preset: input.preset ?? "digital",
      outputStorageKey: input.outputStorageKey ?? null,
      errorMessage: input.errorMessage ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(exportJobs).values(record).run();

    return record;
  }

  findByIdForAccount(accountId: string, exportId: string): ExportJobRecord | null {
    return (
      this.db
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.accountId, accountId), eq(exportJobs.id, exportId)))
        .get() ?? null
    );
  }

  updateForAccount(
    accountId: string,
    exportId: string,
    input: Partial<Pick<ExportJobRecord, "errorMessage" | "outputStorageKey" | "status">>,
  ): ExportJobRecord | null {
    const existing = this.findByIdForAccount(accountId, exportId);

    if (!existing) {
      return null;
    }

    this.db
      .update(exportJobs)
      .set({
        errorMessage: input.errorMessage ?? existing.errorMessage,
        outputStorageKey: input.outputStorageKey ?? existing.outputStorageKey,
        status: input.status ?? existing.status,
        updatedAt: now(this.clock),
      })
      .where(and(eq(exportJobs.accountId, accountId), eq(exportJobs.id, exportId)))
      .run();

    return this.findByIdForAccount(accountId, exportId);
  }
}

export class IntegrationRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly clock: RepositoryClock = defaultClock,
  ) {}

  findConnection(
    accountId: string,
    provider: IntegrationProvider,
  ): IntegrationConnectionRecord | null {
    return (
      this.db
        .select()
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.accountId, accountId),
            eq(integrationConnections.provider, provider),
          ),
        )
        .get() ?? null
    );
  }

  upsertConnection(input: {
    accountId: string;
    provider: IntegrationProvider;
    externalAccountId: string;
    externalEmail: string | null;
    encryptedCredentials: string;
  }): IntegrationConnectionRecord {
    const timestamp = now(this.clock);
    const existing = this.findConnection(input.accountId, input.provider);

    if (existing) {
      const next: IntegrationConnectionRecord = {
        ...existing,
        externalAccountId: input.externalAccountId,
        externalEmail: input.externalEmail,
        encryptedCredentials: input.encryptedCredentials,
        updatedAt: timestamp,
      };

      this.db
        .update(integrationConnections)
        .set({
          externalAccountId: next.externalAccountId,
          externalEmail: next.externalEmail,
          encryptedCredentials: next.encryptedCredentials,
          updatedAt: timestamp,
        })
        .where(eq(integrationConnections.id, existing.id))
        .run();

      return next;
    }

    const record: IntegrationConnectionRecord = {
      id: createInternalId("integrationConnection"),
      accountId: input.accountId,
      provider: input.provider,
      externalAccountId: input.externalAccountId,
      externalEmail: input.externalEmail,
      encryptedCredentials: input.encryptedCredentials,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.insert(integrationConnections).values(record).run();

    return record;
  }

  deleteConnection(accountId: string, provider: IntegrationProvider): boolean {
    const result = this.db
      .delete(integrationConnections)
      .where(
        and(
          eq(integrationConnections.accountId, accountId),
          eq(integrationConnections.provider, provider),
        ),
      )
      .run();

    return result.changes > 0;
  }

  findMediaLink(
    accountId: string,
    provider: IntegrationProvider,
    externalId: string,
  ): ExternalMediaLinkRecord | null {
    return (
      this.db
        .select()
        .from(externalMediaLinks)
        .where(
          and(
            eq(externalMediaLinks.accountId, accountId),
            eq(externalMediaLinks.provider, provider),
            eq(externalMediaLinks.externalId, externalId),
          ),
        )
        .get() ?? null
    );
  }

  createMediaLink(
    input: {
      accountId: string;
      provider: IntegrationProvider;
      externalId: string;
    } & (
      | { assetId: string; customStickerId?: never }
      | { assetId?: never; customStickerId: string }
    ),
  ): ExternalMediaLinkRecord {
    const timestamp = now(this.clock);
    const record: ExternalMediaLinkRecord = {
      id: createInternalId("externalMediaLink"),
      accountId: input.accountId,
      provider: input.provider,
      externalId: input.externalId,
      assetId: input.assetId ?? null,
      customStickerId: input.customStickerId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db
      .insert(externalMediaLinks)
      .values(record)
      .onConflictDoUpdate({
        target: [
          externalMediaLinks.accountId,
          externalMediaLinks.provider,
          externalMediaLinks.externalId,
        ],
        set: {
          assetId: record.assetId,
          customStickerId: record.customStickerId,
          updatedAt: timestamp,
        },
      })
      .run();

    return record;
  }
}

export const createRepositories = (
  db: AppDatabase,
  options: { clock?: RepositoryClock; pageDocuments?: PageDocumentStore } = {},
) => {
  const clock = options.clock ?? defaultClock;
  const pageDocuments = options.pageDocuments ?? createMemoryPageDocumentStore();

  return {
    accounts: new AccountRepository(db, clock),
    accountPreferences: new AccountPreferencesRepository(db, clock),
    authIdentities: new AuthIdentityRepository(db, clock),
    sessions: new SessionRepository(db, clock),
    assets: new AssetRepository(db, clock),
    albums: new AlbumRepository(db, clock),
    stickerPacks: new StickerPackRepository(db, clock),
    customWashiTapes: new CustomWashiTapeRepository(db, clock),
    pages: new PageRepository(db, clock, pageDocuments),
    books: new BookRepository(db, clock, pageDocuments),
    exports: new ExportJobRepository(db, clock),
    integrations: new IntegrationRepository(db, clock),
  };
};

export type Repositories = ReturnType<typeof createRepositories>;
