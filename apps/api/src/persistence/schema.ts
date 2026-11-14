import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const authIdentityProviders = ["email_password", "passkey", "native_token"] as const;
export const assetVariantKinds = ["thumbnail", "preview", "render", "export"] as const;
export const exportStatuses = ["queued", "running", "completed", "failed", "cancelled"] as const;
export const exportFormats = ["png", "jpeg", "pdf", "zip"] as const;
export const exportPresets = ["digital", "print"] as const;
export const integrationProviders = ["shutterfly"] as const;

export type AuthIdentityProvider = (typeof authIdentityProviders)[number];
export type AssetVariantKind = (typeof assetVariantKinds)[number];
export type ExportStatus = (typeof exportStatuses)[number];
export type ExportFormat = (typeof exportFormats)[number];
export type ExportPreset = (typeof exportPresets)[number];
export type IntegrationProvider = (typeof integrationProviders)[number];

const timestampColumns = () => ({
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const schemaMigrations = sqliteTable("schema_migrations", {
  id: text("id").primaryKey(),
  appliedAt: text("applied_at").notNull(),
});

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    primaryEmail: text("primary_email").notNull(),
    ...timestampColumns(),
  },
  (table) => [uniqueIndex("accounts_primary_email_unique").on(table.primaryEmail)],
);

export const authIdentities = sqliteTable(
  "auth_identities",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: authIdentityProviders }).notNull(),
    providerSubject: text("provider_subject").notNull(),
    passwordHash: text("password_hash"),
    ...timestampColumns(),
  },
  (table) => [
    index("auth_identities_account_id_idx").on(table.accountId),
    uniqueIndex("auth_identities_provider_subject_unique").on(
      table.provider,
      table.providerSubject,
    ),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    secretHash: text("secret_hash").notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    ...timestampColumns(),
  },
  (table) => [
    index("sessions_account_id_idx").on(table.accountId),
    uniqueIndex("sessions_secret_hash_unique").on(table.secretHash),
  ],
);

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    originalStorageKey: text("original_storage_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    checksumSha256: text("checksum_sha256").notNull(),
    dateTaken: text("date_taken"),
    cameraMake: text("camera_make"),
    cameraModel: text("camera_model"),
    lensModel: text("lens_model"),
    isoSpeed: integer("iso_speed"),
    fNumber: real("f_number"),
    exposureTimeSeconds: real("exposure_time_seconds"),
    focalLengthMm: real("focal_length_mm"),
    focalLength35mmMm: integer("focal_length_35mm_mm"),
    orientation: integer("orientation"),
    gpsLatitude: real("gps_latitude"),
    gpsLongitude: real("gps_longitude"),
    gpsAltitudeMeters: real("gps_altitude_meters"),
    ...timestampColumns(),
  },
  (table) => [
    index("assets_account_id_idx").on(table.accountId),
    uniqueIndex("assets_original_storage_key_unique").on(table.originalStorageKey),
  ],
);

export const assetVariants = sqliteTable(
  "asset_variants",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: assetVariantKinds }).notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    checksumSha256: text("checksum_sha256").notNull(),
    ...timestampColumns(),
  },
  (table) => [
    index("asset_variants_account_id_idx").on(table.accountId),
    index("asset_variants_asset_id_idx").on(table.assetId),
    uniqueIndex("asset_variants_storage_key_unique").on(table.storageKey),
    uniqueIndex("asset_variants_asset_kind_unique").on(table.assetId, table.kind),
  ],
);

export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    documentJson: text("document_json").notNull(),
    documentStorageKey: text("document_storage_key"),
    ...timestampColumns(),
  },
  (table) => [
    index("pages_account_id_idx").on(table.accountId),
    uniqueIndex("pages_document_storage_key_unique").on(table.documentStorageKey),
  ],
);

export const books = sqliteTable(
  "books",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    pageWidth: integer("page_width").notNull(),
    pageHeight: integer("page_height").notNull(),
    coverSpreadEnabled: integer("cover_spread_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    ...timestampColumns(),
  },
  (table) => [index("books_account_id_idx").on(table.accountId)],
);

export const bookPages = sqliteTable(
  "book_pages",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    ...timestampColumns(),
  },
  (table) => [
    index("book_pages_account_id_idx").on(table.accountId),
    index("book_pages_book_id_idx").on(table.bookId),
    uniqueIndex("book_pages_book_sort_order_unique").on(table.bookId, table.sortOrder),
    uniqueIndex("book_pages_book_page_unique").on(table.bookId, table.pageId),
  ],
);

export const albums = sqliteTable(
  "albums",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    ...timestampColumns(),
  },
  (table) => [index("albums_account_id_idx").on(table.accountId)],
);

export const albumAssets = sqliteTable(
  "album_assets",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    albumId: text("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    ...timestampColumns(),
  },
  (table) => [
    index("album_assets_account_id_idx").on(table.accountId),
    index("album_assets_album_id_idx").on(table.albumId),
    uniqueIndex("album_assets_album_asset_unique").on(table.albumId, table.assetId),
  ],
);

export const stickerPacks = sqliteTable(
  "sticker_packs",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    author: text("author"),
    sourceUrl: text("source_url"),
    ...timestampColumns(),
  },
  (table) => [index("sticker_packs_account_id_idx").on(table.accountId)],
);

export const customStickers = sqliteTable(
  "custom_stickers",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    packId: text("pack_id")
      .notNull()
      .references(() => stickerPacks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    checksumSha256: text("checksum_sha256").notNull(),
    sortOrder: integer("sort_order").notNull(),
    isFavorite: integer("is_favorite", { mode: "boolean" }).notNull().default(false),
    ...timestampColumns(),
  },
  (table) => [
    index("custom_stickers_account_id_idx").on(table.accountId),
    index("custom_stickers_pack_id_idx").on(table.packId),
    index("custom_stickers_is_favorite_idx").on(table.accountId, table.isFavorite),
    uniqueIndex("custom_stickers_storage_key_unique").on(table.storageKey),
  ],
);

export const customWashiTapes = sqliteTable(
  "custom_washi_tapes",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    designJson: text("design_json").notNull(),
    ...timestampColumns(),
  },
  (table) => [index("custom_washi_tapes_account_id_idx").on(table.accountId)],
);

export const customBackgroundSources = ["upload", "shutterfly"] as const;
export type CustomBackgroundSource = (typeof customBackgroundSources)[number];

export const customBackgrounds = sqliteTable(
  "custom_backgrounds",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    storageKey: text("storage_key").notNull(),
    thumbnailStorageKey: text("thumbnail_storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    source: text("source", { enum: customBackgroundSources }).notNull(),
    externalId: text("external_id"),
    ...timestampColumns(),
  },
  (table) => [
    index("custom_backgrounds_account_id_idx").on(table.accountId),
    uniqueIndex("custom_backgrounds_storage_key_unique").on(table.storageKey),
    uniqueIndex("custom_backgrounds_external_unique").on(
      table.accountId,
      table.source,
      table.externalId,
    ),
  ],
);

export const bookAssets = sqliteTable(
  "book_assets",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    ...timestampColumns(),
  },
  (table) => [
    index("book_assets_account_id_idx").on(table.accountId),
    index("book_assets_book_id_idx").on(table.bookId),
    uniqueIndex("book_assets_book_asset_unique").on(table.bookId, table.assetId),
  ],
);

export const exportJobs = sqliteTable(
  "exports",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    bookId: text("book_id").references(() => books.id, { onDelete: "set null" }),
    pageId: text("page_id").references(() => pages.id, { onDelete: "set null" }),
    status: text("status", { enum: exportStatuses }).notNull(),
    format: text("format", { enum: exportFormats }).notNull(),
    preset: text("preset", { enum: exportPresets }).notNull(),
    outputStorageKey: text("output_storage_key"),
    errorMessage: text("error_message"),
    ...timestampColumns(),
  },
  (table) => [
    index("exports_account_id_idx").on(table.accountId),
    index("exports_book_id_idx").on(table.bookId),
    index("exports_page_id_idx").on(table.pageId),
  ],
);

export const integrationConnections = sqliteTable(
  "integration_connections",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: integrationProviders }).notNull(),
    externalAccountId: text("external_account_id").notNull(),
    externalEmail: text("external_email"),
    encryptedCredentials: text("encrypted_credentials").notNull(),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("integration_connections_account_provider_unique").on(
      table.accountId,
      table.provider,
    ),
  ],
);

export const externalMediaLinks = sqliteTable(
  "external_media_links",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: integrationProviders }).notNull(),
    externalId: text("external_id").notNull(),
    assetId: text("asset_id").references(() => assets.id, { onDelete: "cascade" }),
    customStickerId: text("custom_sticker_id").references(() => customStickers.id, {
      onDelete: "cascade",
    }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("external_media_links_account_provider_external_unique").on(
      table.accountId,
      table.provider,
      table.externalId,
    ),
    index("external_media_links_asset_id_idx").on(table.assetId),
    index("external_media_links_custom_sticker_id_idx").on(table.customStickerId),
  ],
);

export const accountPreferences = sqliteTable("account_preferences", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  uiTheme: text("ui_theme").notNull().default("system"),
  ...timestampColumns(),
});

export type AccountRecord = typeof accounts.$inferSelect;
export type AuthIdentityRecord = typeof authIdentities.$inferSelect;
export type SessionRecord = typeof sessions.$inferSelect;
export type AssetRecord = typeof assets.$inferSelect;
export type AssetVariantRecord = typeof assetVariants.$inferSelect;
export type PageRecord = typeof pages.$inferSelect;
export type BookRecord = typeof books.$inferSelect;
export type BookPageRecord = typeof bookPages.$inferSelect;
export type BookAssetRecord = typeof bookAssets.$inferSelect;
export type AlbumRecord = typeof albums.$inferSelect;
export type AlbumAssetRecord = typeof albumAssets.$inferSelect;
export type StickerPackRecord = typeof stickerPacks.$inferSelect;
export type CustomStickerRecord = typeof customStickers.$inferSelect;
export type CustomWashiTapeRecord = typeof customWashiTapes.$inferSelect;
export type CustomBackgroundRecord = typeof customBackgrounds.$inferSelect;
export type ExportJobRecord = typeof exportJobs.$inferSelect;
export type IntegrationConnectionRecord = typeof integrationConnections.$inferSelect;
export type ExternalMediaLinkRecord = typeof externalMediaLinks.$inferSelect;
export type AccountPreferencesRecord = typeof accountPreferences.$inferSelect;
