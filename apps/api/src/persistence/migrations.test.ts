import { describe, expect, it } from "vitest";

import { createDatabaseConnection } from "./database.js";
import { getAppliedMigrations, runMigrations } from "./migrations.js";

describe("SQLite migrations", () => {
  it("applies the initial schema from an empty database", () => {
    const connection = createDatabaseConnection({ databasePath: ":memory:" });

    try {
      expect(runMigrations(connection.sqlite)).toEqual([
        "0001_initial_schema",
        "0002_add_export_presets",
        "0003_add_book_page_size",
        "0004_add_page_document_storage_key",
        "0005_add_book_cover_spread_enabled",
        "0006_add_book_assets",
        "0007_add_assets_date_taken",
        "0008_add_assets_exif_details",
        "0009_add_albums",
        "0010_add_sticker_packs",
        "0011_add_sticker_favorites",
        "0012_add_custom_washi_tapes",
        "0013_add_integrations",
        "0014_add_account_preferences",
        "0015_add_custom_backgrounds",
      ]);
      expect(runMigrations(connection.sqlite)).toEqual([]);
      expect(getAppliedMigrations(connection.sqlite)).toEqual([
        "0001_initial_schema",
        "0002_add_export_presets",
        "0003_add_book_page_size",
        "0004_add_page_document_storage_key",
        "0005_add_book_cover_spread_enabled",
        "0006_add_book_assets",
        "0007_add_assets_date_taken",
        "0008_add_assets_exif_details",
        "0009_add_albums",
        "0010_add_sticker_packs",
        "0011_add_sticker_favorites",
        "0012_add_custom_washi_tapes",
        "0013_add_integrations",
        "0014_add_account_preferences",
        "0015_add_custom_backgrounds",
      ]);

      const tableNames = connection.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tableNames).toEqual([
        "account_preferences",
        "accounts",
        "album_assets",
        "albums",
        "asset_variants",
        "assets",
        "auth_identities",
        "book_assets",
        "book_pages",
        "books",
        "custom_backgrounds",
        "custom_stickers",
        "custom_washi_tapes",
        "exports",
        "external_media_links",
        "integration_connections",
        "pages",
        "schema_migrations",
        "sessions",
        "sticker_packs",
      ]);
    } finally {
      connection.close();
    }
  });
});
