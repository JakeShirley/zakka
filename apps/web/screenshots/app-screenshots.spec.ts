import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Visual snapshots for review only. Scenarios stage a screen against a mocked API and wait for it
// to be ready; they do not assert behavior. Interaction behavior belongs in `*.browser.test.tsx`
// files, and flows that need the real API belong in `apps/web/e2e/`.

const screenshotDirectory = path.resolve(
  process.env.ZAKKA_SCREENSHOT_DIR ??
    fileURLToPath(new URL("../../../docs/screenshots/", import.meta.url)),
);

type ScreenshotViewport = {
  height: number;
  name: string;
  width: number;
};

type ScreenshotScenario = {
  authenticated?: boolean;
  name: string;
  path: string;
  prepare?: (page: Page) => Promise<void>;
  /** UI theme preference returned by the account preferences mock. Defaults to "system". */
  theme?: "system" | "light" | "dark" | "sakura";
  viewports?: readonly string[];
  waitFor: (page: Page) => Promise<void>;
};

type TextLayerFixtureOptions = {
  align?: "left" | "center" | "right";
  background?: {
    color: string;
    enabled: boolean;
    opacity: number;
    padding: number;
    radius: number;
  };
  bubble?: {
    color: string;
    enabled: boolean;
    opacity: number;
    padding: number;
    spacing: number;
  };
  color?: string;
  fontFamily?: string;
  glow?: { blur: number; color: string; enabled: boolean; opacity: number };
  opacity?: number;
  rotation?: number;
  shadow?: {
    blur: number;
    color: string;
    enabled: boolean;
    offsetX: number;
    offsetY: number;
    opacity: number;
  };
  stroke?: { color: string; enabled: boolean; width: number };
};

type WashiTapeFixtureOptions = {
  opacity?: number;
  outline?:
    | "angled"
    | "bracket"
    | "notched"
    | "pinched"
    | "rounded"
    | "scallop"
    | "stamp"
    | "straight"
    | "tapered"
    | "torn"
    | "wave";
  pattern?: {
    assetId?: string;
    kind: "checker" | "customPhoto" | "grid" | "polkaDot" | "solid" | "stripe";
    primaryColor: string;
    secondaryColor: string;
  };
  tile?: Partial<{
    offsetX: number;
    offsetY: number;
    rotation: number;
    scale: number;
    scaleX: number;
    scaleY: number;
  }>;
};

const viewports: ScreenshotViewport[] = [
  { height: 960, name: "desktop", width: 1440 },
  { height: 844, name: "mobile", width: 390 },
];

const now = "2026-05-25T12:00:00.000Z";
const expiresAt = "2026-06-24T12:00:00.000Z";

const account = {
  displayName: "Ada Lovelace",
  id: "account_demo",
  primaryEmail: "ada@example.com",
};

const session = {
  account,
  session: {
    createdAt: now,
    expiresAt,
    id: "session_demo",
  },
};

const assetFixtures = [
  createAsset("asset_sunroom", "sunroom-collage.jpg", 3024, 2268, 3_812_044),
  createAsset("asset_postcards", "market-postcards.png", 2400, 1800, 1_742_180),
  createAsset("asset_ticket", "train-ticket.webp", 1600, 1200, 824_100),
  createAsset("asset_ocean", "ocean-print.jpg", 3000, 2000, 2_456_221),
];

const albumFixtures = [
  {
    createdAt: now,
    id: "album_japan_2024",
    photoCount: 2,
    title: "Japan 2024",
    updatedAt: now,
  },
  {
    createdAt: now,
    id: "album_summer",
    photoCount: 3,
    title: "Summer trip",
    updatedAt: now,
  },
  {
    createdAt: now,
    id: "album_misc",
    photoCount: 1,
    title: "Misc 2026",
    updatedAt: now,
  },
];

const albumAssetMap: Record<string, ReturnType<typeof createAsset>[]> = {
  album_japan_2024: [assetFixtures[2], assetFixtures[3]],
  album_summer: assetFixtures.slice(0, 3),
  album_misc: [assetFixtures[1]],
};

const stickerPackFixtures = [
  {
    createdAt: now,
    id: "sticker_pack_florals",
    title: "Hand-drawn florals",
    author: "Lila Field",
    sourceUrl: "https://example.com/florals",
    stickerCount: 3,
    updatedAt: now,
  },
  {
    createdAt: now,
    id: "sticker_pack_notebook",
    title: "Notebook doodles",
    author: null,
    sourceUrl: null,
    stickerCount: 2,
    updatedAt: now,
  },
];

const customStickerFixtures = [
  {
    id: "custom_sticker_daisy",
    packId: "sticker_pack_florals",
    name: "Daisy",
    mimeType: "image/png",
    byteSize: 12_834,
    width: 512,
    height: 512,
    isFavorite: true,
    contentUrl: "/api/v1/custom-stickers/custom_sticker_daisy/content",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "custom_sticker_rose",
    packId: "sticker_pack_florals",
    name: "Rose",
    mimeType: "image/png",
    byteSize: 14_204,
    width: 512,
    height: 512,
    isFavorite: false,
    contentUrl: "/api/v1/custom-stickers/custom_sticker_rose/content",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "custom_sticker_tulip",
    packId: "sticker_pack_florals",
    name: "Tulip",
    mimeType: "image/png",
    byteSize: 11_504,
    width: 512,
    height: 512,
    isFavorite: false,
    contentUrl: "/api/v1/custom-stickers/custom_sticker_tulip/content",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "custom_sticker_arrow",
    packId: "sticker_pack_notebook",
    name: "Squiggle arrow",
    mimeType: "image/svg+xml",
    byteSize: 1_842,
    width: 320,
    height: 200,
    isFavorite: true,
    contentUrl: "/api/v1/custom-stickers/custom_sticker_arrow/content",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "custom_sticker_starburst",
    packId: "sticker_pack_notebook",
    name: "Starburst",
    mimeType: "image/svg+xml",
    byteSize: 2_104,
    width: 320,
    height: 320,
    isFavorite: false,
    contentUrl: "/api/v1/custom-stickers/custom_sticker_starburst/content",
    createdAt: now,
    updatedAt: now,
  },
];

const customStickersByPack: Record<string, typeof customStickerFixtures> = {
  sticker_pack_florals: customStickerFixtures.filter(
    (sticker) => sticker.packId === "sticker_pack_florals",
  ),
  sticker_pack_notebook: customStickerFixtures.filter(
    (sticker) => sticker.packId === "sticker_pack_notebook",
  ),
};

const customWashiTapeFixtures = [
  {
    createdAt: now,
    design: {
      outline: "scallop",
      pattern: { kind: "checker", primaryColor: "#fff4cc", secondaryColor: "#f2a65a" },
      tile: { offsetX: 0, offsetY: 0, rotation: 45, scale: 1, scaleX: 0.5, scaleY: 0.5 },
    },
    id: "custom_washi_tape_picnic",
    name: "Picnic checks",
    updatedAt: now,
  },
  {
    createdAt: now,
    design: {
      outline: "wave",
      pattern: { kind: "stripe", primaryColor: "#e8f4f2", secondaryColor: "#3f8f86" },
      tile: { offsetX: 0, offsetY: 0, rotation: -30, scale: 1, scaleX: 0.6, scaleY: 0.6 },
    },
    id: "custom_washi_tape_lagoon",
    name: "Lagoon ribbon",
    updatedAt: now,
  },
];

const pageFixtures = [
  createPage("page_cover", "Cover", {
    backgroundColor: "#fff6e6",
    layers: [
      photoLayer("photo_cover", "asset_sunroom", 220, 240, 1240, 980, -3),
      textLayer("text_cover", "A little book of **bright** days", 360, 1320, 1320, 260, 92),
      stickerLayer("sticker_cover", "noto:sun-with-face", 1660, 300, 360, 360, 8),
    ],
  }),
  createPage("page_market", "Market Morning", {
    backgroundColor: "#f5fbf8",
    layers: [
      photoLayer("photo_market", "asset_postcards", 260, 280, 1180, 1500, 2),
      washiTapeLayer("tape_market", 230, 250, 1260, 160, -2, "#f8d56b", "#2f7a75"),
      textLayer("text_market", "market finds", 1480, 520, 640, 260, 76),
    ],
  }),
  createPage("page_trip", "Train Ride", {
    backgroundColor: "#f8f3ec",
    layers: [
      photoLayer("photo_ticket", "asset_ticket", 300, 360, 1120, 760, -5),
      photoLayer("photo_ocean", "asset_ocean", 1020, 1120, 1060, 880, 4),
      textLayer("text_trip", "window seat sketches", 360, 1290, 820, 220, 70),
      stickerLayer("sticker_trip", "noto:paperclip", 1560, 710, 260, 260, -12),
    ],
  }),
  createPage("page_notes", "Notes", {
    backgroundColor: "#fffdf7",
    layers: [
      washiTapeLayer("tape_notes", 320, 340, 1420, 170, 3, "#9cc9c5", "#fffdf7"),
      textLayer(
        "text_notes",
        "Keep the receipt, the flower, the tiny map.",
        520,
        960,
        920,
        420,
        68,
      ),
      stickerLayer("sticker_notes", "noto:sparkles", 1530, 1280, 300, 300, 9),
    ],
  }),
  createPage("page_washi_settings", "Tape Settings", {
    backgroundColor: "#fbfaf2",
    layers: [
      textLayer("text_washi_heading", "washi tape settings", 200, 150, 1220, 120, 72, {
        color: "#2f4947",
      }),
      washiTapeLayer("tape_straight_solid", 190, 380, 850, 150, -3, "#f4d35e", "#2f7a75", {
        outline: "straight",
        pattern: { kind: "solid", primaryColor: "#f4d35e", secondaryColor: "#2f7a75" },
        tile: { scaleX: 1.3, scaleY: 0.78 },
      }),
      washiTapeLayer("tape_angled_polka", 1240, 380, 870, 150, 4, "#f7f0cf", "#d85f3f", {
        outline: "angled",
        pattern: { kind: "polkaDot", primaryColor: "#f7f0cf", secondaryColor: "#d85f3f" },
        tile: { offsetX: 0.25, scale: 0.78, scaleX: 1.8 },
      }),
      washiTapeLayer("tape_rounded_stripe", 210, 660, 830, 160, 2, "#b7d7d2", "#263d5a", {
        outline: "rounded",
        pattern: { kind: "stripe", primaryColor: "#b7d7d2", secondaryColor: "#263d5a" },
        tile: { rotation: 18, scale: 0.92, scaleY: 1.4 },
      }),
      washiTapeLayer("tape_torn_grid", 1240, 670, 850, 165, -2, "#f8c6b8", "#36706d", {
        outline: "torn",
        pattern: { kind: "grid", primaryColor: "#f8c6b8", secondaryColor: "#36706d" },
        tile: { offsetY: -0.35, scale: 1.15, scaleX: 1.35 },
      }),
      washiTapeLayer("tape_notched_checker", 190, 960, 850, 150, -5, "#f7eee2", "#5580a0", {
        outline: "notched",
        pattern: { kind: "checker", primaryColor: "#f7eee2", secondaryColor: "#5580a0" },
        tile: { rotation: -12, scale: 0.72, scaleY: 1.45 },
      }),
      washiTapeLayer("tape_bracket_photo", 1240, 960, 860, 155, 3, "#efd37a", "#4d6d68", {
        outline: "bracket",
        pattern: {
          assetId: "asset_postcards",
          kind: "customPhoto",
          primaryColor: "#efd37a",
          secondaryColor: "#4d6d68",
        },
        tile: { offsetX: -0.35, rotation: 8, scale: 1.35, scaleX: 1.6, scaleY: 0.82 },
      }),
      washiTapeLayer("tape_pinched_polka", 210, 1260, 820, 150, 5, "#dae8c4", "#774b69", {
        outline: "pinched",
        pattern: { kind: "polkaDot", primaryColor: "#dae8c4", secondaryColor: "#774b69" },
        tile: { offsetX: 0.5, offsetY: 0.25, scale: 0.9, scaleX: 0.72 },
      }),
      washiTapeLayer("tape_tapered_stripe", 1240, 1270, 850, 160, -4, "#fed7a8", "#226c73", {
        outline: "tapered",
        pattern: { kind: "stripe", primaryColor: "#fed7a8", secondaryColor: "#226c73" },
        tile: { rotation: 35, scale: 0.8, scaleY: 1.7 },
      }),
      washiTapeLayer("tape_scallop_grid", 190, 1560, 850, 160, 2, "#d6e4f2", "#bb4d54", {
        outline: "scallop",
        pattern: { kind: "grid", primaryColor: "#d6e4f2", secondaryColor: "#bb4d54" },
        tile: { offsetY: 0.5, scale: 1.05, scaleX: 1.55 },
      }),
      washiTapeLayer("tape_stamp_checker", 1240, 1570, 850, 160, 4, "#f6e7a7", "#435e91", {
        outline: "stamp",
        pattern: { kind: "checker", primaryColor: "#f6e7a7", secondaryColor: "#435e91" },
        tile: { rotation: -22, scale: 0.82, scaleX: 1.2, scaleY: 1.2 },
      }),
      washiTapeLayer("tape_wave_photo", 370, 1880, 1580, 190, -1, "#f5d6dc", "#426d78", {
        outline: "wave",
        pattern: {
          assetId: "asset_ocean",
          kind: "customPhoto",
          primaryColor: "#f5d6dc",
          secondaryColor: "#426d78",
        },
        tile: { offsetX: 0.4, offsetY: -0.2, rotation: -16, scale: 1.55, scaleX: 1.8 },
      }),
    ],
  }),
  createPage("page_text_settings", "Text Settings", {
    backgroundColor: "#f5fbf8",
    layers: [
      textLayer("text_effects_title", "GOLDEN HOUR", 260, 270, 1880, 300, 146, {
        align: "center",
        background: { color: "#fff0b8", enabled: true, opacity: 0.82, padding: 34, radius: 46 },
        color: "#d95438",
        fontFamily: "Bodoni Ultra Bold",
        glow: { blur: 36, color: "#ffffff", enabled: true, opacity: 0.72 },
        shadow: {
          blur: 18,
          color: "#24545a",
          enabled: true,
          offsetX: 18,
          offsetY: 22,
          opacity: 0.28,
        },
        stroke: { color: "#fffdf7", enabled: true, width: 10 },
      }),
      textLayer(
        "text_effects_left",
        "left aligned\nwith a soft highlight",
        300,
        810,
        880,
        420,
        78,
        {
          background: { color: "#ffffff", enabled: true, opacity: 0.76, padding: 22, radius: 18 },
          color: "#26443f",
          fontFamily: "Love Ya Like A Sister",
        },
      ),
      textLayer("text_effects_center", "centered stroke", 1250, 820, 760, 220, 88, {
        align: "center",
        color: "#2f6391",
        fontFamily: "Baskerville",
        rotation: -4,
        stroke: { color: "#f8d56b", enabled: true, width: 18 },
      }),
      textLayer("text_effects_right", "right edge\ndrop shadow", 1040, 1180, 940, 390, 84, {
        align: "right",
        color: "#713d5a",
        fontFamily: "Bodoni",
        shadow: {
          blur: 30,
          color: "#173331",
          enabled: true,
          offsetX: -28,
          offsetY: 28,
          opacity: 0.32,
        },
      }),
      textLayer("text_effects_glow", "glow", 330, 1410, 670, 210, 120, {
        color: "#2f7a75",
        fontFamily: "Love Ya Like A Sister",
        glow: { blur: 54, color: "#f8d56b", enabled: true, opacity: 0.92 },
        rotation: 5,
      }),
      textLayer("text_effects_bubble", "BUBBLE", 1020, 1410, 940, 220, 96, {
        align: "center",
        bubble: { color: "#ffd6e0", enabled: true, opacity: 0.92, padding: 8, spacing: 12 },
        color: "#2f3940",
        fontFamily: "Bodoni Ultra Bold",
      }),
      textLayer(
        "text_effects_caption",
        "Small caption with padded background and muted opacity.",
        440,
        1810,
        1540,
        180,
        58,
        {
          align: "center",
          background: { color: "#263d5a", enabled: true, opacity: 0.86, padding: 28, radius: 30 },
          color: "#fffdf7",
          fontFamily: "Baskerville",
          opacity: 0.94,
        },
      ),
    ],
  }),
];

const bookFixture = {
  coverSpreadEnabled: false,
  createdAt: now,
  id: "book_summer",
  pageCount: pageFixtures.length,
  pageHeight: 3000,
  pageWidth: 2400,
  pages: pageFixtures.map((page, index) => ({
    bookId: "book_summer",
    createdAt: now,
    id: `book_page_${index + 1}`,
    page: summarizePage(page),
    pageId: page.id,
    sortOrder: index,
    updatedAt: now,
  })),
  spreadCount: 3,
  spreads: [
    {
      kind: "facing",
      leftPageId: "page_cover",
      pageIds: ["page_cover", "page_market"],
      rightPageId: "page_market",
      spreadIndex: 0,
    },
    {
      kind: "facing",
      leftPageId: "page_trip",
      pageIds: ["page_trip", "page_notes"],
      rightPageId: "page_notes",
      spreadIndex: 1,
    },
    {
      kind: "facing",
      leftPageId: "page_washi_settings",
      pageIds: ["page_washi_settings", "page_text_settings"],
      rightPageId: "page_text_settings",
      spreadIndex: 2,
    },
  ],
  title: "Family Yearbook",
  updatedAt: now,
};

const bookSummaries = [
  summarizeBook(bookFixture),
  {
    coverSpreadEnabled: true,
    createdAt: now,
    id: "book_recipe",
    pageCount: 12,
    pageHeight: 2400,
    pageWidth: 2400,
    spreadCount: 7,
    title: "Recipe Cards",
    updatedAt: now,
  },
  {
    coverSpreadEnabled: false,
    createdAt: now,
    id: "book_weekend",
    pageCount: 18,
    pageHeight: 2550,
    pageWidth: 3300,
    spreadCount: 9,
    title: "Coastal Weekend",
    updatedAt: now,
  },
];

const serverLogs = [
  createLog(
    "log_books",
    "info",
    "GET /api/v1/books completed with 200",
    "GET",
    "/api/v1/books",
    200,
    14.2,
  ),
  createLog(
    "log_assets",
    "info",
    "Generated thumbnail variant for sunroom-collage.jpg",
    "POST",
    "/api/v1/assets/uploads",
    201,
    82.7,
  ),
  createLog(
    "log_export",
    "warn",
    "PDF export retried after a transient renderer timeout",
    "POST",
    "/api/v1/exports",
    202,
    311.4,
  ),
];

const assetSvgs = new Map(
  assetFixtures.map((asset, index) => [
    asset.thumbnailUrl,
    createAssetSvg(index, asset.originalFilename),
  ]),
);

const localImageFiles = [
  createLocalPngFile("garden-red.png", { blue: 68, green: 82, red: 218 }),
  createLocalPngFile("market-green.png", { blue: 118, green: 150, red: 42 }),
  createLocalPngFile("ocean-blue.png", { blue: 210, green: 128, red: 50 }),
];

const shutterflyConnection = {
  configured: true,
  connected: true,
  email: "maker@example.com",
  connectedAt: "2026-05-17T12:00:00.000Z",
};

const shutterflyProjects = [
  {
    id: "1219497168070",
    name: "Summer at the Lake",
    productName: "8x8 Deluxe Layflat Photo Book",
    thumbnailUrl: null,
    pageCount: 34,
    updatedAt: "2026-05-21T21:59:17.820Z",
  },
  {
    id: "1219497168071",
    name: "Grandma's 80th",
    productName: "11x8 Custom Hard Cover Photo Book",
    thumbnailUrl: null,
    pageCount: 20,
    updatedAt: "2026-04-02T18:30:00.000Z",
  },
];

const scenarios: ScreenshotScenario[] = [
  {
    authenticated: false,
    name: "auth",
    path: "/auth",
    waitFor: async (page) => {
      await expect(page.getByRole("heading", { name: /^(Zakka|Scrapbook)$/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
      // /api/v1/health uses a strict literal `service` schema that changed in the rename, so the merge-base build rejects the mock and never renders the version line.
    },
  },
  {
    name: "books",
    path: "/books",
    waitFor: async (page) => {
      await expect(page.locator(".topbar h2", { hasText: "Books" })).toBeVisible();
      await expect(page.getByText("Family Yearbook")).toBeVisible();
    },
  },
  {
    name: "book-editor",
    path: "/books/book_summer",
    waitFor: async (page) => {
      await waitForBookEditor(page);
    },
  },
  {
    name: "book-editor-washi-text-settings",
    path: "/books/book_summer",
    prepare: async (page) => {
      await navigateToSpread(page, "Spread 3 of 3");
      await expect(page.locator('.book-page-frame[aria-label="Page 5"]')).toBeVisible();
      await expect(page.locator('.book-page-frame[aria-label="Page 6"]')).toBeVisible();
    },
    viewports: ["desktop"],
    waitFor: waitForBookEditor,
  },
  {
    name: "book-editor-photo-edit",
    path: "/books/book_summer",
    prepare: async (page) => {
      await openLayerEditor(page, "Page 1", "photo");
      const dialog = page.getByRole("dialog", { name: /^Edit Photo( layer)?$/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("group", { name: "Photo" })).toBeVisible();
      await expect(dialog.getByRole("group", { name: "Frame" })).toBeVisible();
    },
    viewports: ["desktop"],
    waitFor: waitForBookEditor,
  },
  {
    name: "book-editor-washi-tape-edit",
    path: "/books/book_summer",
    prepare: async (page) => {
      await openLayerEditor(page, "Page 2", "washiTape");
      const dialog = page.getByRole("dialog", { name: /^Edit Washi tape( layer)?$/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("group", { name: "Washi tape" })).toBeVisible();
    },
    viewports: ["desktop"],
    waitFor: waitForBookEditor,
  },
  {
    name: "book-editor-washi-tape-settings-edit",
    path: "/books/book_summer",
    prepare: async (page) => {
      await navigateToSpread(page, "Spread 3 of 3");
      await openLayerEditor(page, "Page 5", "washiTape");
      const dialog = page.getByRole("dialog", { name: /^Edit Washi tape( layer)?$/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("group", { name: "Washi tape" })).toBeVisible();
    },
    viewports: ["desktop"],
    waitFor: waitForBookEditor,
  },
  {
    name: "book-editor-text-edit",
    path: "/books/book_summer",
    prepare: async (page) => {
      await openLayerEditor(page, "Page 1", "text");
      const dialog = page.getByRole("dialog", { name: /^Edit Text( layer)?$/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("group", { name: "Text", exact: true })).toBeVisible();
      await expect(dialog.getByRole("textbox", { name: "Text" })).toBeVisible();
    },
    viewports: ["desktop"],
    waitFor: waitForBookEditor,
  },
  {
    name: "book-editor-text-inline-resize",
    path: "/books/book_summer",
    prepare: async (page) => {
      const textLayer = page
        .locator('.book-page-frame[aria-label="Page 1"] .canvas-layer[data-kind="text"]')
        .first();
      await textLayer.locator(".canvas-layer-hitbox").dblclick({ force: true });
      const inlineEditor = page.getByRole("textbox", { name: "Edit text" });
      await expect(inlineEditor).toBeVisible();

      const resizeHandle = textLayer.locator('.transform-resize-handle[data-handle="e"]');
      if (!(await isVisible(resizeHandle))) return;

      const handleBox = await resizeHandle.boundingBox();
      if (!handleBox) return;

      // Only stage the widened editor for the screenshot. Resizing while typing is asserted in
      // PageCanvas.browser.test.tsx (#54).
      const handleX = handleBox.x + handleBox.width / 2;
      const handleY = handleBox.y + handleBox.height / 2;
      await page.mouse.move(handleX, handleY);
      await page.mouse.down();
      await page.mouse.move(handleX + 80, handleY, { steps: 10 });
      await page.mouse.up();
      await expect(inlineEditor).toBeVisible();
    },
    viewports: ["desktop"],
    waitFor: waitForBookEditor,
  },
  {
    name: "book-editor-text-settings-edit",
    path: "/books/book_summer",
    prepare: async (page) => {
      await navigateToSpread(page, "Spread 3 of 3");
      await openLayerEditor(page, "Page 6", "text");
      const dialog = page.getByRole("dialog", { name: /^Edit Text( layer)?$/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("group", { name: "Text", exact: true })).toBeVisible();
    },
    viewports: ["desktop"],
    waitFor: waitForBookEditor,
  },
  {
    name: "library",
    path: "/library",
    waitFor: async (page) => {
      await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
      await expect(page.getByText("sunroom-collage.jpg")).toBeVisible();
    },
  },
  {
    name: "library-album",
    path: "/library",
    prepare: async (page) => {
      const albumTab = page.getByRole("tab", { name: "Japan 2024" });
      if (!(await isVisible(albumTab))) {
        return;
      }
      await albumTab.click();
      await expect(page.getByText("train-ticket.webp")).toBeVisible();
    },
    waitFor: async (page) => {
      await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    },
  },
  {
    name: "image-grid",
    path: "/image-grid",
    prepare: async (page) => {
      if (!(await isVisible(page.getByRole("heading", { name: "Image Grid" })))) {
        return;
      }

      await page.locator('input[type="file"]').setInputFiles(localImageFiles);
      await expect(page.locator(".image-grid-canvas-item")).toHaveCount(localImageFiles.length);
      await expect(page.getByText(`${localImageFiles.length} placed`)).toBeVisible();
    },
    waitFor: async (page) => {
      await waitForFeatureOrFallback(page, "Image Grid");
    },
  },
  {
    name: "washi-tape",
    path: "/washi-tape",
    waitFor: async (page) => {
      await waitForFeatureOrFallback(page, "Washi Tape");
    },
  },
  {
    name: "book-editor-washi-tape-gallery",
    path: "/books/book_summer",
    prepare: async (page) => {
      if (!(await isVisible(page.getByRole("link", { name: "Washi Tape" })))) {
        return;
      }

      await page.getByRole("button", { name: "Add washi tape" }).click();
      const gallery = page.getByRole("dialog", { name: "Add washi tape" });
      await expect(gallery.getByRole("button", { name: "Add Picnic checks" })).toBeVisible();
    },
    viewports: ["desktop"],
    waitFor: waitForBookEditor,
  },
  {
    name: "settings-account",
    path: "/settings",
    waitFor: async (page) => {
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
      await expect(page.getByLabel("Account").getByText(account.primaryEmail)).toBeVisible();
    },
  },
  {
    name: "books-shutterfly-import",
    path: "/books",
    prepare: async (page) => {
      const importButton = page.getByRole("button", { name: "Import from Shutterfly" });

      if (!(await isVisible(importButton))) {
        return;
      }

      await importButton.click();
      await expect(page.getByRole("list", { name: "Shutterfly projects" })).toBeVisible();
    },
    waitFor: async (page) => {
      await expect(page.locator(".topbar h2", { hasText: "Books" })).toBeVisible();
      await expect(page.getByText("Family Yearbook")).toBeVisible();
    },
  },
  {
    name: "settings-integrations",
    path: "/settings",
    prepare: async (page) => {
      const integrationsTab = page.getByRole("tab", { name: "Integrations" });

      if (!(await isVisible(integrationsTab))) {
        return;
      }

      // Show the first-run connection instructions rather than the connected state.
      await page.route("**/api/v1/integrations/shutterfly", (route) =>
        route.fulfill({
          json: { ...shutterflyConnection, connected: false, email: null, connectedAt: null },
        }),
      );
      await integrationsTab.click();
      await expect(page.getByRole("button", { name: "Connect Shutterfly" })).toBeVisible();
    },
    waitFor: async (page) => {
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    },
  },
  {
    name: "settings-logs",
    path: "/settings",
    prepare: async (page) => {
      await page.getByRole("tab", { name: "Logs" }).click();
      await expect(page.getByText(serverLogs[0].message)).toBeVisible();
    },
    waitFor: async (page) => {
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    },
  },
  {
    name: "settings-appearance",
    path: "/settings",
    prepare: async (page) => {
      const appearanceTab = page.getByRole("tab", { name: "Appearance" });

      if (!(await isVisible(appearanceTab))) {
        return;
      }

      await appearanceTab.click();
      await expect(page.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
    },
    waitFor: async (page) => {
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    },
  },
  {
    name: "books-dark",
    path: "/books",
    theme: "dark",
    waitFor: async (page) => {
      await expect(page.locator(".topbar h2", { hasText: "Books" })).toBeVisible();
      await expect(page.getByText("Family Yearbook")).toBeVisible();
    },
  },
  {
    name: "book-editor-dark",
    path: "/books/book_summer",
    theme: "dark",
    viewports: ["desktop"],
    waitFor: waitForBookEditor,
  },
  {
    name: "settings-appearance-dark",
    path: "/settings?tab=appearance",
    theme: "dark",
    viewports: ["desktop"],
    waitFor: async (page) => {
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    },
  },
  {
    name: "books-sakura",
    path: "/books",
    theme: "sakura",
    waitFor: async (page) => {
      await expect(page.locator(".topbar h2", { hasText: "Books" })).toBeVisible();
      await expect(page.getByText("Family Yearbook")).toBeVisible();
    },
  },
  {
    name: "book-editor-sakura",
    path: "/books/book_summer",
    theme: "sakura",
    viewports: ["desktop"],
    waitFor: waitForBookEditor,
  },
];

async function waitForBookEditor(page: Page) {
  await expect(page.getByRole("heading", { name: "Family Yearbook" })).toBeVisible();
  await expect(page.locator(".book-canvas-deck")).toBeVisible();
}

async function waitForFeatureOrFallback(page: Page, heading: string) {
  const featureHeading = page.getByRole("heading", { name: heading });

  try {
    await expect(featureHeading).toBeVisible({ timeout: 1500 });
    return;
  } catch {
    await expect(page.locator(".topbar h2").first()).toBeVisible();
  }
}

async function isVisible(locator: Locator) {
  try {
    return await locator.isVisible({ timeout: 500 });
  } catch {
    return false;
  }
}

async function openLayerEditor(
  page: Page,
  pageLabel: "Page 1" | "Page 2" | "Page 5" | "Page 6",
  layerKind: "photo" | "text" | "washiTape",
) {
  const layerLabel =
    layerKind === "photo"
      ? "Photo layer"
      : layerKind === "text"
        ? "Text layer"
        : "Washi tape layer";

  await page
    .locator(`.book-page-frame[aria-label="${pageLabel}"] .canvas-layer[data-kind="${layerKind}"]`)
    .first()
    .locator(".canvas-layer-hitbox")
    .click({ force: true });
  const editButton = page
    .getByRole("toolbar", { name: `${layerLabel} actions` })
    .getByRole("button", { name: "Edit layer" });
  if (await isVisible(editButton)) {
    await editButton.click();
  }
}

async function navigateToSpread(page: Page, spreadLabel: string) {
  const spreadStatus = page.locator(".book-modebar-status").filter({ hasText: spreadLabel });

  if (spreadLabel === "Spread 3 of 3") {
    await page.getByRole("button", { name: "5 Tape Settings" }).click({ force: true });
    await expect(spreadStatus).toBeVisible();
    return;
  }

  for (let navigationAttempt = 0; navigationAttempt < 6; navigationAttempt += 1) {
    if (await isVisible(spreadStatus)) {
      return;
    }

    await page.getByRole("button", { name: "Next" }).click({ force: true });
  }

  await expect(spreadStatus).toBeVisible();
}

test.beforeAll(async () => {
  await mkdir(screenshotDirectory, { recursive: true });

  for (const filename of await readdir(screenshotDirectory)) {
    if (filename.endsWith(".png")) {
      await rm(path.join(screenshotDirectory, filename));
    }
  }
});

for (const viewport of viewports) {
  for (const scenario of scenarios) {
    if (scenario.viewports && !scenario.viewports.includes(viewport.name)) {
      continue;
    }

    test(`${scenario.name} ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await installMockApi(page, scenario.authenticated ?? true, scenario.theme ?? "system");
      await page.goto(scenario.path);
      await scenario.waitFor(page);
      if (scenario.theme && scenario.theme !== "system") {
        // Merge-base builds predate UI themes, so tolerate the attribute never appearing.
        await page
          .locator(`html[data-theme="${scenario.theme}"]`)
          .waitFor({ state: "attached", timeout: 3000 })
          .catch(() => undefined);
      }
      await scenario.prepare?.(page);
      await stabilizePage(page);
      await page.screenshot({
        animations: "disabled",
        fullPage: false,
        path: path.join(screenshotDirectory, `${scenario.name}-${viewport.name}.png`),
      });
    });
  }
}

async function installMockApi(
  page: Page,
  authenticated: boolean,
  theme: NonNullable<ScreenshotScenario["theme"]>,
) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathName = url.pathname;

    if (assetSvgs.has(pathName)) {
      await route.fulfill({ body: assetSvgs.get(pathName), contentType: "image/svg+xml" });
      return;
    }

    if (pathName === "/api/v1/account/preferences") {
      await route.fulfill({ json: { uiTheme: theme } });
      return;
    }

    if (pathName === "/api/v1/auth/session") {
      await route.fulfill(
        authenticated
          ? { json: session }
          : { json: errorResponse("Authentication is required."), status: 401 },
      );
      return;
    }

    if (pathName === "/api/v1/health") {
      await route.fulfill({
        json: {
          service: "zakka-api",
          status: "ok",
          timestamp: "2026-05-17T12:00:00.000Z",
          version: "0.0.0-development",
        },
      });
      return;
    }

    if (!authenticated) {
      await route.fulfill({ json: errorResponse("Authentication is required."), status: 401 });
      return;
    }

    if (pathName === "/api/v1/books") {
      await route.fulfill({ json: { books: bookSummaries } });
      return;
    }

    if (pathName === "/api/v1/books/book_summer") {
      await route.fulfill({ json: bookFixture });
      return;
    }

    if (pathName === "/api/v1/books/book_summer/assets") {
      await route.fulfill({ json: { assets: assetFixtures } });
      return;
    }

    if (pathName === "/api/v1/assets") {
      await route.fulfill({ json: { assets: assetFixtures } });
      return;
    }

    if (pathName === "/api/v1/albums") {
      await route.fulfill({ json: { albums: albumFixtures } });
      return;
    }

    if (pathName.startsWith("/api/v1/albums/") && pathName.endsWith("/assets")) {
      const albumId = pathName.split("/").at(-2);
      const assets = albumId ? (albumAssetMap[albumId] ?? []) : [];
      await route.fulfill({ json: { assets } });
      return;
    }

    if (pathName.startsWith("/api/v1/assets/") && pathName.endsWith("/albums")) {
      const assetId = pathName.split("/").at(-2);
      const memberAlbums = assetId
        ? albumFixtures.filter((album) =>
            (albumAssetMap[album.id] ?? []).some((asset) => asset.id === assetId),
          )
        : [];
      await route.fulfill({ json: { albums: memberAlbums } });
      return;
    }

    if (pathName === "/api/v1/sticker-packs") {
      await route.fulfill({ json: { packs: stickerPackFixtures } });
      return;
    }

    if (pathName.startsWith("/api/v1/sticker-packs/") && pathName.endsWith("/stickers")) {
      const packId = pathName.split("/").at(-2);
      const packStickers = packId ? (customStickersByPack[packId] ?? []) : [];
      await route.fulfill({ json: { stickers: packStickers } });
      return;
    }

    if (pathName === "/api/v1/custom-stickers") {
      const packId = url.searchParams.get("packId");
      const filtered = packId ? (customStickersByPack[packId] ?? []) : customStickerFixtures;
      await route.fulfill({ json: { stickers: filtered } });
      return;
    }

    if (
      pathName.startsWith("/api/v1/custom-stickers/") &&
      pathName.endsWith("/favorite") &&
      route.request().method() === "PATCH"
    ) {
      const stickerId = pathName.split("/").at(-2);
      const sticker = customStickerFixtures.find((entry) => entry.id === stickerId);
      if (!sticker) {
        await route.fulfill({ json: errorResponse("Custom sticker not found."), status: 404 });
        return;
      }
      let isFavorite = !sticker.isFavorite;
      try {
        const body = route.request().postDataJSON() as { isFavorite?: boolean } | null;
        if (body && typeof body.isFavorite === "boolean") {
          isFavorite = body.isFavorite;
        }
      } catch {
        // tolerate missing/invalid body
      }
      await route.fulfill({ json: { ...sticker, isFavorite } });
      return;
    }

    if (pathName === "/api/v1/custom-washi-tapes") {
      await route.fulfill({ json: { washiTapes: customWashiTapeFixtures } });
      return;
    }

    if (pathName === "/api/v1/pages") {
      await route.fulfill({ json: { pages: pageFixtures.map(summarizePage) } });
      return;
    }

    if (pathName.startsWith("/api/v1/pages/")) {
      const pageId = pathName.split("/").at(-1);
      const pageFixture = pageFixtures.find((fixture) => fixture.id === pageId);

      await route.fulfill(
        pageFixture
          ? { json: pageFixture }
          : { json: errorResponse("Page not found."), status: 404 },
      );
      return;
    }

    if (pathName === "/api/v1/logs") {
      const level = url.searchParams.get("level") ?? "info";

      await route.fulfill({ json: { level, logs: serverLogs } });
      return;
    }

    if (pathName === "/api/v1/integrations/shutterfly") {
      await route.fulfill({ json: shutterflyConnection });
      return;
    }

    if (pathName === "/api/v1/integrations/shutterfly/projects") {
      await route.fulfill({ json: { projects: shutterflyProjects } });
      return;
    }

    if (pathName === "/api/v1/auth/logout") {
      await route.fulfill({ status: 204 });
      return;
    }

    await route.fulfill({
      json: errorResponse(`No screenshot fixture for ${pathName}.`),
      status: 404,
    });
  });
}

async function stabilizePage(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `,
  });

  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((image) => {
        if (image.complete) {
          return undefined;
        }

        return new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }),
    );
  });
}

function createAsset(
  id: string,
  originalFilename: string,
  width: number,
  height: number,
  byteSize: number,
) {
  return {
    byteSize,
    cameraMake: null,
    cameraModel: null,
    checksumSha256: `sha256-${id}`,
    createdAt: now,
    dateTaken: null,
    exposureTimeSeconds: null,
    fNumber: null,
    focalLength35mmMm: null,
    focalLengthMm: null,
    gpsAltitudeMeters: null,
    gpsLatitude: null,
    gpsLongitude: null,
    height,
    id,
    isoSpeed: null,
    lensModel: null,
    mimeType: "image/png",
    orientation: null,
    originalContentUrl: `/api/screenshot-assets/${id}.svg`,
    originalFilename,
    thumbnailUrl: `/api/screenshot-assets/${id}.svg`,
    updatedAt: now,
    variants: [],
    width,
  };
}

function createPage(
  id: string,
  title: string,
  input: { backgroundColor: string; layers: Record<string, unknown>[] },
) {
  return {
    createdAt: now,
    document: {
      canvas: {
        backgroundColor: input.backgroundColor,
        height: 3000,
        width: 2400,
      },
      layers: input.layers,
      version: 1,
    },
    height: 3000,
    id,
    layerCount: input.layers.length,
    title,
    updatedAt: now,
    width: 2400,
  };
}

function summarizePage(page: ReturnType<typeof createPage>) {
  return {
    createdAt: page.createdAt,
    height: page.height,
    id: page.id,
    layerCount: page.layerCount,
    title: page.title,
    updatedAt: page.updatedAt,
    width: page.width,
  };
}

function summarizeBook(book: typeof bookFixture) {
  return {
    coverSpreadEnabled: book.coverSpreadEnabled,
    createdAt: book.createdAt,
    id: book.id,
    pageCount: book.pageCount,
    pageHeight: book.pageHeight,
    pageWidth: book.pageWidth,
    spreadCount: book.spreadCount,
    title: book.title,
    updatedAt: book.updatedAt,
  };
}

function baseLayer(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
) {
  return { height, id, locked: false, opacity: 1, rotation, width, x, y };
}

function photoLayer(
  id: string,
  assetId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
) {
  return {
    ...baseLayer(id, x, y, width, height, rotation),
    assetId,
    border: { color: "#ffffff", framePreset: "paper", radius: 28, style: "solid", width: 42 },
    crop: { aspectRatioPreset: "free", height: 1, width: 1, x: 0, y: 0 },
    filter: { brightness: 1, contrast: 1, preset: "warm", saturation: 1.04 },
    fit: "cover",
    kind: "photo",
    mask: { feather: 0, inset: 0, shape: "rectangle" },
    photoTransform: { flipX: false, flipY: false, offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
    shadow: {
      blur: 34,
      color: "#202426",
      enabled: true,
      offsetX: 0,
      offsetY: 18,
      opacity: 0.18,
      spread: 0,
    },
  };
}

function textLayer(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  options: TextLayerFixtureOptions = {},
) {
  return {
    ...baseLayer(id, x, y, width, height, options.rotation ?? 0),
    ...(options.opacity === undefined ? {} : { opacity: options.opacity }),
    ...(options.background ? { background: options.background } : {}),
    ...(options.bubble ? { bubble: options.bubble } : {}),
    ...(options.glow ? { glow: options.glow } : {}),
    ...(options.shadow ? { shadow: options.shadow } : {}),
    ...(options.stroke ? { stroke: options.stroke } : {}),
    align: options.align ?? "left",
    color: options.color ?? "#24302f",
    fontFamily: options.fontFamily ?? "Love Ya Like A Sister",
    fontSize,
    kind: "text",
    text,
  };
}

function stickerLayer(
  id: string,
  stickerId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
) {
  return { ...baseLayer(id, x, y, width, height, rotation), kind: "sticker", stickerId };
}

function washiTapeLayer(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  primaryColor: string,
  secondaryColor: string,
  options: WashiTapeFixtureOptions = {},
) {
  return {
    ...baseLayer(id, x, y, width, height, rotation),
    ...(options.opacity === undefined ? {} : { opacity: options.opacity }),
    kind: "washiTape",
    outline: options.outline ?? "torn",
    pattern: options.pattern ?? { kind: "stripe", primaryColor, secondaryColor },
    tile: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, scaleX: 1, scaleY: 1, ...options.tile },
  };
}

function createLog(
  id: string,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  method: string,
  requestPath: string,
  status: number,
  durationMs: number,
) {
  return {
    durationMs,
    id,
    level,
    message,
    method,
    path: requestPath,
    requestId: `req_${id}`,
    status,
    timestamp: now,
  };
}

function createAssetSvg(index: number, label: string) {
  const palettes = [
    ["#eecb86", "#377f7a", "#f7efe2"],
    ["#c7dfd8", "#d86f45", "#fff8e8"],
    ["#a9c5e8", "#313d5a", "#f7e3bf"],
    ["#f1a7a0", "#276168", "#f9f3ec"],
  ];
  const [background, accent, paper] = palettes[index % palettes.length];

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">
      <rect width="1200" height="900" fill="${background}"/>
      <circle cx="245" cy="210" r="170" fill="${paper}" opacity="0.78"/>
      <rect x="430" y="160" width="520" height="560" rx="44" fill="${paper}" opacity="0.88"/>
      <path d="M0 710 C220 600 330 800 560 680 C770 570 920 640 1200 500 L1200 900 L0 900 Z" fill="${accent}" opacity="0.82"/>
      <text x="92" y="815" fill="#202426" font-family="Georgia, serif" font-size="62">${label}</text>
    </svg>
  `;
}

function createLocalPngFile(name: string, color: { blue: number; green: number; red: number }) {
  return {
    buffer: createSolidColorPng(64, 64, color),
    mimeType: "image/png",
    name,
  };
}

function createSolidColorPng(
  width: number,
  height: number,
  color: { blue: number; green: number; red: number },
) {
  const bytesPerPixel = 3;
  const rowSize = width * bytesPerPixel + 1;
  const rawPixels = Buffer.alloc(rowSize * height);

  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const rowOffset = rowIndex * rowSize;

    rawPixels[rowOffset] = 0;

    for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
      const pixelOffset = rowOffset + 1 + columnIndex * bytesPerPixel;

      rawPixels[pixelOffset] = color.red;
      rawPixels[pixelOffset + 1] = color.green;
      rawPixels[pixelOffset + 2] = color.blue;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    createPngChunk("IHDR", header),
    createPngChunk("IDAT", deflateSync(rawPixels)),
    createPngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function createPngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);

  length.writeUInt32BE(data.byteLength, 0);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function getCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    return value >>> 0;
  });
}

function crc32(buffer: Buffer) {
  const table = getCrcTable();
  let value = 0xffffffff;

  for (const byte of buffer) {
    value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
}

function errorResponse(message: string) {
  return {
    error: {
      code: "request_failed",
      message,
    },
  };
}
