import { createHash } from "node:crypto";

import {
  createMapLayer,
  createPageDocument,
  createPhotoLayer,
  createTextLayer,
  createWashiTapeLayer,
  type PageDocument,
  type PhotoLayer,
} from "@zakka/editor-core";
import { makeFixedClock } from "@zakka/test-utils";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { type ExportStorage, renderBookExport, renderPageExport } from "./exports.js";
import type { MapTileSource } from "./map-tiles.js";
import { createDatabaseConnection } from "./persistence/database.js";
import { runMigrations } from "./persistence/migrations.js";
import { createRepositories } from "./persistence/repositories.js";

const fixedDate = new Date("2026-05-17T12:00:00.000Z");
const testAccountId = "account_export_pixels";
const testAssetId = "asset_export_pixels";
const testPageId = "page_export_pixels";
const testAssetStorageKey = "uploads/export-pixels.png";

type Rgb = {
  red: number;
  green: number;
  blue: number;
};

type Rgba = Rgb & {
  alpha: number;
};

type DecodedPng = {
  data: Buffer;
  height: number;
  width: number;
};

const scrapbookBackground = { blue: 228, green: 241, red: 247 };
const photoRed = { blue: 34, green: 46, red: 224 };

const checksumSha256 = (buffer: Buffer): string =>
  createHash("sha256").update(buffer).digest("hex");

const createSolidPng = (color: Rgb): Promise<Buffer> =>
  sharp({
    create: {
      background: { alpha: 1, b: color.blue, g: color.green, r: color.red },
      channels: 4,
      height: 32,
      width: 32,
    },
  })
    .png()
    .toBuffer();

const createSolidTiff = (color: Rgb): Promise<Buffer> =>
  sharp({
    create: {
      background: { b: color.blue, g: color.green, r: color.red },
      channels: 3,
      height: 1600,
      width: 1600,
    },
  })
    .tiff({ compression: "none" })
    .toBuffer();

const decodePng = async (buffer: Buffer): Promise<DecodedPng> => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });

  return { data, height: info.height, width: info.width };
};

const listStoredZipEntries = (buffer: Buffer): Array<{ data: Buffer; name: string }> => {
  const entries: Array<{ data: Buffer; name: string }> = [];
  let offset = 0;

  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;

    expect(compressionMethod).toBe(0);
    entries.push({
      data: buffer.subarray(dataStart, dataStart + compressedSize),
      name: buffer.subarray(nameStart, nameStart + fileNameLength).toString("utf8"),
    });
    offset = dataStart + compressedSize;
  }

  return entries;
};

const pixelAt = (image: DecodedPng, x: number, y: number): Rgba => {
  const offset = (y * image.width + x) * 4;

  return {
    red: image.data[offset] ?? 0,
    green: image.data[offset + 1] ?? 0,
    blue: image.data[offset + 2] ?? 0,
    alpha: image.data[offset + 3] ?? 0,
  };
};

const expectColorNear = (actual: Rgb, expected: Rgb, tolerance = 8) => {
  expect(Math.abs(actual.red - expected.red)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.green - expected.green)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.blue - expected.blue)).toBeLessThanOrEqual(tolerance);
};

const countPixels = (
  image: DecodedPng,
  box: { height: number; width: number; x: number; y: number },
  predicate: (pixel: Rgb) => boolean,
): number => {
  let count = 0;

  for (let pixelY = box.y; pixelY < box.y + box.height; pixelY += 1) {
    for (let pixelX = box.x; pixelX < box.x + box.width; pixelX += 1) {
      if (predicate(pixelAt(image, pixelX, pixelY))) {
        count += 1;
      }
    }
  }

  return count;
};

const createExportFixture = async (
  document: PageDocument,
  assetInput?: {
    buffer: Buffer;
    height: number;
    mimeType: string;
    originalFilename: string;
    storageKey: string;
    width: number;
  },
) => {
  const connection = createDatabaseConnection({ databasePath: ":memory:" });
  const clock = makeFixedClock(fixedDate);
  const repositories = createRepositories(connection.db, { clock });
  const photoBuffer = assetInput?.buffer ?? (await createSolidPng(photoRed));
  const photoStorageKey = assetInput?.storageKey ?? testAssetStorageKey;
  const storageObjects = new Map([[photoStorageKey, photoBuffer]]);
  const storage: ExportStorage = {
    read: async (key) => {
      const storedObject = storageObjects.get(key);

      if (!storedObject) {
        throw new Error(`Missing test storage object: ${key}`);
      }

      return storedObject;
    },
    remove: async () => {},
    write: async (_area, data) => ({ byteSize: data.byteLength, key: "exports/test.png" }),
  };

  try {
    runMigrations(connection.sqlite);
    repositories.accounts.create({
      displayName: "Export Pixels",
      id: testAccountId,
      primaryEmail: "export-pixels@example.com",
    });
    repositories.assets.createOriginal({
      accountId: testAccountId,
      byteSize: photoBuffer.byteLength,
      checksumSha256: checksumSha256(photoBuffer),
      height: assetInput?.height ?? 32,
      id: testAssetId,
      mimeType: assetInput?.mimeType ?? "image/png",
      originalFilename: assetInput?.originalFilename ?? "export-pixels.png",
      originalStorageKey: photoStorageKey,
      width: assetInput?.width ?? 32,
    });
    repositories.pages.create({
      accountId: testAccountId,
      documentJson: JSON.stringify(document),
      height: document.canvas.height,
      id: testPageId,
      title: "Export pixels",
      width: document.canvas.width,
    });

    return { connection, repositories, storage };
  } catch (error) {
    connection.close();
    throw error;
  }
};

const renderDocumentPng = async (
  document: PageDocument,
  options: { mapTiles?: MapTileSource } = {},
): Promise<DecodedPng> => {
  const fixture = await createExportFixture(document);

  try {
    const rendered = await renderPageExport({
      accountId: testAccountId,
      format: "png",
      ...options,
      pageId: testPageId,
      preset: "print",
      repositories: fixture.repositories,
      storage: fixture.storage,
    });

    expect(rendered.extension).toBe(".png");
    expect(rendered.mimeType).toBe("image/png");

    return decodePng(rendered.buffer);
  } finally {
    fixture.connection.close();
  }
};

describe("PNG page exports", () => {
  it("renders canvas, photo, text, and washi tape primitives", async () => {
    const image = await renderDocumentPng(
      createPageDocument({
        canvas: { backgroundColor: "#f7f1e4", height: 320, width: 320 },
        layers: [
          createPhotoLayer({
            assetId: testAssetId,
            border: { color: "#ffffff", framePreset: "none", radius: 0, style: "solid", width: 0 },
            height: 80,
            id: "photo_primitive",
            mask: { feather: 0, inset: 0, shape: "rectangle" },
            rotation: 0,
            width: 96,
            x: 24,
            y: 24,
          }),
          createTextLayer({
            color: "#101820",
            fontFamily: "sans-serif",
            fontSize: 52,
            height: 72,
            id: "text_primitive",
            rotation: 0,
            text: "Hi",
            width: 140,
            x: 24,
            y: 132,
          }),
          createWashiTapeLayer({
            assetId: testAssetId,
            height: 40,
            id: "washi_photo_primitive",
            outline: "wave",
            rotation: 0,
            tile: { offsetX: 0, offsetY: 0, rotation: 0, scale: 0.8 },
            width: 168,
            x: 76,
            y: 214,
          }),
          createWashiTapeLayer({
            height: 36,
            id: "washi_pattern_primitive",
            outline: "straight",
            pattern: { kind: "solid", primaryColor: "#79a9a4", secondaryColor: "#fffdf7" },
            rotation: 0,
            width: 168,
            x: 76,
            y: 270,
          }),
        ],
      }),
    );

    expect(image).toMatchObject({ height: 320, width: 320 });
    expectColorNear(pixelAt(image, 8, 8), scrapbookBackground);
    expectColorNear(pixelAt(image, 72, 64), photoRed);
    expectColorNear(pixelAt(image, 150, 234), photoRed, 70);
    expectColorNear(pixelAt(image, 150, 288), { blue: 180, green: 185, red: 145 }, 35);
    expect(
      countPixels(
        image,
        { height: 72, width: 140, x: 20, y: 128 },
        (pixel) => pixel.red < 70 && pixel.green < 80 && pixel.blue < 90,
      ),
    ).toBeGreaterThan(80);
  });

  it("can render PNG page exports with transparent canvas background", async () => {
    const fixture = await createExportFixture(
      createPageDocument({
        canvas: { backgroundColor: "#f7f1e4", height: 320, width: 320 },
        layers: [
          createPhotoLayer({
            assetId: testAssetId,
            height: 96,
            id: "transparent_background_photo",
            width: 96,
            x: 24,
            y: 24,
          }),
        ],
      }),
    );

    try {
      const rendered = await renderPageExport({
        accountId: testAccountId,
        format: "png",
        includeBackground: false,
        pageId: testPageId,
        preset: "print",
        repositories: fixture.repositories,
        storage: fixture.storage,
      });
      const image = await decodePng(rendered.buffer);

      expect(pixelAt(image, 8, 8).alpha).toBe(0);
      expect(pixelAt(image, 72, 72).alpha).toBe(255);
      expectColorNear(pixelAt(image, 72, 72), photoRed, 12);
    } finally {
      fixture.connection.close();
    }
  });

  it("renders custom and built-in texture page backgrounds", async () => {
    const customBackgroundId = "custom_background_export_pixels";
    const fixture = await createExportFixture(
      createPageDocument({
        canvas: {
          background: {
            backgroundId: `custom:${customBackgroundId}`,
            height: 320,
            scale: 1,
            width: 160,
            x: 0,
            y: 0,
          },
          backgroundColor: "#f7f1e4",
          height: 320,
          width: 320,
        },
      }),
    );

    try {
      fixture.repositories.customBackgrounds.create({
        accountId: testAccountId,
        byteSize: 1,
        checksumSha256: "a".repeat(64),
        height: 32,
        id: customBackgroundId,
        mimeType: "image/png",
        name: "Red",
        source: "upload",
        storageKey: testAssetStorageKey,
        thumbnailStorageKey: testAssetStorageKey,
        width: 32,
      });

      const rendered = await renderPageExport({
        accountId: testAccountId,
        format: "png",
        pageId: testPageId,
        preset: "print",
        repositories: fixture.repositories,
        storage: fixture.storage,
      });
      const image = await decodePng(rendered.buffer);

      expectColorNear(pixelAt(image, 40, 160), photoRed, 12);
      expectColorNear(pixelAt(image, 280, 160), scrapbookBackground);
    } finally {
      fixture.connection.close();
    }

    const textured = await renderDocumentPng(
      createPageDocument({
        canvas: {
          background: {
            backgroundId: "zakka:kraft-paper",
            height: 320,
            scale: 1,
            width: 320,
            x: 0,
            y: 0,
          },
          height: 320,
          width: 320,
        },
      }),
    );

    expectColorNear(pixelAt(textured, 160, 160), { blue: 93, green: 144, red: 191 }, 60);
  });

  it("clips photo layers with every supported mask shape", async () => {
    const maskCases: Array<{
      inside: Array<[number, number]>;
      inset: PhotoLayer["mask"]["inset"];
      outside: Array<[number, number]>;
      shape: PhotoLayer["mask"]["shape"];
    }> = [
      { inside: [[160, 160]], inset: 0.1, outside: [[88, 160]], shape: "rectangle" },
      { inside: [[160, 160]], inset: 0, outside: [[92, 92]], shape: "ellipse" },
      {
        inside: [
          [160, 104],
          [160, 224],
        ],
        inset: 0,
        outside: [[94, 96]],
        shape: "arch",
      },
      { inside: [[160, 160]], inset: 0, outside: [[96, 96]], shape: "diamond" },
      {
        inside: [[160, 160]],
        inset: 0,
        outside: [
          [84, 160],
          [160, 84],
        ],
        shape: "ticket",
      },
    ];

    for (const maskCase of maskCases) {
      const image = await renderDocumentPng(
        createPageDocument({
          canvas: { backgroundColor: "#f7f1e4", height: 320, width: 320 },
          layers: [
            createPhotoLayer({
              assetId: testAssetId,
              border: {
                color: "#ffffff",
                framePreset: "none",
                radius: 0,
                style: "solid",
                width: 0,
              },
              height: 160,
              id: `photo_${maskCase.shape}`,
              mask: { feather: 0, inset: maskCase.inset, shape: maskCase.shape },
              rotation: 0,
              width: 160,
              x: 80,
              y: 80,
            }),
          ],
        }),
      );

      for (const [insideX, insideY] of maskCase.inside) {
        expectColorNear(pixelAt(image, insideX, insideY), photoRed);
      }

      for (const [outsideX, outsideY] of maskCase.outside) {
        expectColorNear(pixelAt(image, outsideX, outsideY), scrapbookBackground);
      }
    }
  });

  it("renders page exports as PDF documents", async () => {
    const fixture = await createExportFixture(
      createPageDocument({
        canvas: { backgroundColor: "#f7f1e4", height: 320, width: 320 },
        layers: [createTextLayer({ id: "pdf_text", text: "PDF" })],
      }),
    );

    try {
      const rendered = await renderPageExport({
        accountId: testAccountId,
        format: "pdf",
        pageId: testPageId,
        preset: "print",
        repositories: fixture.repositories,
        storage: fixture.storage,
      });

      expect(rendered.extension).toBe(".pdf");
      expect(rendered.mimeType).toBe("application/pdf");
      expect(rendered.buffer.subarray(0, 5).toString()).toBe("%PDF-");
      expect(rendered.buffer.toString("latin1")).toContain("/DCTDecode");
    } finally {
      fixture.connection.close();
    }
  });

  it("renders book PDF exports with one PDF page per scrapbook page", async () => {
    const fixture = await createExportFixture(
      createPageDocument({
        canvas: { backgroundColor: "#f7f1e4", height: 320, width: 320 },
        layers: [createTextLayer({ id: "book_pdf_text", text: "One" })],
      }),
    );

    try {
      const secondPage = fixture.repositories.pages.create({
        accountId: testAccountId,
        documentJson: JSON.stringify(
          createPageDocument({
            canvas: { backgroundColor: "#fffdf7", height: 320, width: 320 },
            layers: [createTextLayer({ id: "book_pdf_text_2", text: "Two" })],
          }),
        ),
        height: 320,
        id: "page_export_pixels_2",
        title: "Export pixels two",
        width: 320,
      });
      const book = fixture.repositories.books.create({
        accountId: testAccountId,
        id: "book_export_pixels",
        pageWidth: 320,
        pageHeight: 320,
        title: "Export pixels book",
      });

      fixture.repositories.books.addPage({
        accountId: testAccountId,
        bookId: book.id,
        pageId: testPageId,
        sortOrder: 0,
      });
      fixture.repositories.books.addPage({
        accountId: testAccountId,
        bookId: book.id,
        pageId: secondPage.id,
        sortOrder: 1,
      });

      const rendered = await renderBookExport({
        accountId: testAccountId,
        bookId: book.id,
        format: "pdf",
        preset: "print",
        repositories: fixture.repositories,
        storage: fixture.storage,
      });

      expect(rendered.extension).toBe(".pdf");
      expect(rendered.mimeType).toBe("application/pdf");
      expect(rendered.buffer.toString("latin1")).toContain("/Count 2");
    } finally {
      fixture.connection.close();
    }
  });

  it("renders book PNG exports as ordered Shutterfly-ready ZIP files", async () => {
    const tiffBuffer = await createSolidTiff(photoRed);
    const fixture = await createExportFixture(
      createPageDocument({
        canvas: { backgroundColor: "#f7f1e4", height: 320, width: 320 },
        layers: [
          createPhotoLayer({
            assetId: testAssetId,
            height: 96,
            id: "book_tiff_photo",
            width: 96,
            x: 24,
            y: 24,
          }),
        ],
      }),
      {
        buffer: tiffBuffer,
        height: 1600,
        mimeType: "image/tiff",
        originalFilename: "scan.tiff",
        storageKey: "uploads/export-pixels.tiff",
        width: 1600,
      },
    );

    try {
      const book = fixture.repositories.books.create({
        accountId: testAccountId,
        id: "book_export_tiff_pixels",
        pageWidth: 320,
        pageHeight: 320,
        title: "TIFF export book",
      });

      fixture.repositories.books.addPage({
        accountId: testAccountId,
        bookId: book.id,
        pageId: testPageId,
        sortOrder: 0,
      });
      const secondPage = fixture.repositories.pages.create({
        accountId: testAccountId,
        documentJson: JSON.stringify(
          createPageDocument({
            canvas: { backgroundColor: "#fffdf7", height: 320, width: 320 },
            layers: [createTextLayer({ id: "book_zip_text_2", text: "Two" })],
          }),
        ),
        height: 320,
        id: "page_export_pixels_2",
        title: "Second page!",
        width: 320,
      });

      fixture.repositories.books.addPage({
        accountId: testAccountId,
        bookId: book.id,
        pageId: secondPage.id,
        sortOrder: 1,
      });

      const rendered = await renderBookExport({
        accountId: testAccountId,
        bookId: book.id,
        dpi: 300,
        format: "png",
        includeBackground: false,
        preset: "print",
        repositories: fixture.repositories,
        storage: fixture.storage,
      });
      const entries = listStoredZipEntries(rendered.buffer);
      const firstPage = await decodePng(entries[0]?.data ?? Buffer.alloc(0));

      expect(rendered.extension).toBe(".zip");
      expect(rendered.mimeType).toBe("application/zip");
      expect(entries.map((entry) => entry.name)).toEqual([
        "001-export-pixels.png",
        "002-second-page.png",
      ]);
      expect(firstPage).toMatchObject({ height: 320, width: 320 });
      expect(pixelAt(firstPage, 8, 8).alpha).toBe(0);
      expectColorNear(pixelAt(firstPage, 72, 72), photoRed, 12);
    } finally {
      fixture.connection.close();
    }
  });
});

describe("map exports", () => {
  const atlasOcean = { blue: 227, green: 211, red: 169 };
  const atlasLand = { blue: 210, green: 234, red: 233 };
  const tileGreen = { blue: 40, green: 200, red: 30 };
  const mapBox = { height: 320, width: 480, x: 0, y: 0 };
  const isNear = (expected: Rgb) => (pixel: Rgb) =>
    Math.abs(pixel.red - expected.red) <= 6 &&
    Math.abs(pixel.green - expected.green) <= 6 &&
    Math.abs(pixel.blue - expected.blue) <= 6;
  const mapDocument = (style: "atlas" | "osm") =>
    createPageDocument({
      canvas: { backgroundColor: "#ffffff", height: 320, width: 480 },
      layers: [
        createMapLayer({
          height: 320,
          id: "map",
          markers: [
            { id: "lis", label: "Lisbon", latitude: 38.72, longitude: -9.14 },
            { id: "ath", label: "Athens", latitude: 37.98, longitude: 23.73 },
          ],
          style,
          width: 480,
          x: 0,
          y: 0,
        }),
      ],
    });

  it("draws vector styles from the bundled geography", async () => {
    const image = await renderDocumentPng(mapDocument("atlas"));

    expect(countPixels(image, mapBox, isNear(atlasOcean))).toBeGreaterThan(10_000);
    expect(countPixels(image, mapBox, isNear(atlasLand))).toBeGreaterThan(10_000);
  });

  it("inlines raster tiles from the tile source and tolerates missing tiles", async () => {
    const tile = await sharp({
      create: {
        background: { alpha: 1, b: tileGreen.blue, g: tileGreen.green, r: tileGreen.red },
        channels: 4,
        height: 256,
        width: 256,
      },
    })
      .png()
      .toBuffer();
    const requested: string[] = [];
    const image = await renderDocumentPng(mapDocument("osm"), {
      mapTiles: {
        getTile: async ({ x, y, z }) => {
          requested.push(`${z}/${x}/${y}`);

          return { buffer: tile, mimeType: "image/png" };
        },
      },
    });

    expect(requested.length).toBeGreaterThan(0);
    expect(countPixels(image, mapBox, isNear(tileGreen))).toBeGreaterThan(mapBox.width * 200);

    const withoutTiles = await renderDocumentPng(mapDocument("osm"), {
      mapTiles: {
        getTile: async () => {
          throw new Error("offline");
        },
      },
    });

    expect(countPixels(withoutTiles, mapBox, isNear(tileGreen))).toBe(0);
  });
});
