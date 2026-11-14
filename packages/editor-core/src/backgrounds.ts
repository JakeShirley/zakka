import { type BackgroundTextureSource, backgroundTextures } from "./background-textures.js";

export type { BackgroundTextureSource } from "./background-textures.js";

/** Built-in backgrounds use `zakka:<slug>`; uploads and imports in a user's library use `custom:<id>`. */
export const builtInBackgroundIdPrefix = "zakka:";
export const customBackgroundIdPrefix = "custom:";

export const builtInBackgroundCategories = ["patterns", "paper", "wood", "fabric", "sky"] as const;

export type BuiltInBackgroundCategory = (typeof builtInBackgroundCategories)[number];

export const builtInBackgroundCategoryLabels: Record<BuiltInBackgroundCategory, string> = {
  patterns: "Patterns",
  paper: "Paper",
  wood: "Wood",
  fabric: "Fabric & leather",
  sky: "Sky",
};

type BackgroundMarkup = { defs: string; body: string };

type BuiltInBackgroundBase = {
  id: string;
  name: string;
  category: BuiltInBackgroundCategory;
  /** Solid colour that approximates the background, used while textures load. */
  baseColor: string;
};

/** A seamless tile repeated across the background frame. Tile sizes are in page pixels (300 dpi). */
export type BuiltInTileBackground = BuiltInBackgroundBase & {
  fit: "tile";
  tileWidth: number;
  tileHeight: number;
} & (
    | { kind: "pattern"; renderTile: () => string }
    | {
        kind: "texture";
        /** File under `@zakka/editor-core/backgrounds/`. */
        file: string;
        thumbnailFile: string;
        source: BackgroundTextureSource;
      }
  );

/** A scene drawn once in a 1000×1000 box and scaled to cover the background frame. */
export type BuiltInCoverBackground = BuiltInBackgroundBase & {
  fit: "cover";
  kind: "scene";
  renderScene: (idPrefix: string) => BackgroundMarkup;
};

export type BuiltInBackground = BuiltInTileBackground | BuiltInCoverBackground;

export const isBuiltInBackgroundId = (backgroundId: string): boolean =>
  backgroundId.startsWith(builtInBackgroundIdPrefix);

export const isCustomBackgroundId = (backgroundId: string): boolean =>
  backgroundId.startsWith(customBackgroundIdPrefix);

export const getCustomBackgroundStorageId = (backgroundId: string): string | null =>
  isCustomBackgroundId(backgroundId) ? backgroundId.slice(customBackgroundIdPrefix.length) : null;

export const toCustomBackgroundId = (id: string): string => `${customBackgroundIdPrefix}${id}`;

const tile = (
  slug: string,
  name: string,
  baseColor: string,
  size: number | { width: number; height: number },
  renderTile: () => string,
): BuiltInBackground => ({
  id: `${builtInBackgroundIdPrefix}${slug}`,
  name,
  category: "patterns",
  baseColor,
  fit: "tile",
  kind: "pattern",
  tileWidth: typeof size === "number" ? size : size.width,
  tileHeight: typeof size === "number" ? size : size.height,
  renderTile,
});

const fill = (color: string, width: number, height = width): string =>
  `<rect width="${width}" height="${height}" fill="${color}" />`;

const polkaDots = (slug: string, name: string, background: string, dot: string) =>
  tile(
    slug,
    name,
    background,
    180,
    () =>
      `${fill(background, 180)}<g fill="${dot}"><circle cx="45" cy="45" r="22" /><circle cx="135" cy="135" r="22" /></g>`,
  );

const gingham = (slug: string, name: string, color: string) =>
  tile(
    slug,
    name,
    "#ffffff",
    150,
    () =>
      `${fill("#ffffff", 150)}<g fill="${color}" fill-opacity="0.5"><rect width="150" height="75" /><rect width="75" height="150" /></g>`,
  );

const diagonalStripes = (slug: string, name: string, background: string, stripe: string) =>
  tile(
    slug,
    name,
    background,
    160,
    () =>
      `${fill(background, 160)}<path d="M-80 80 L80 -80 M0 160 L160 0 M80 240 L240 80" stroke="${stripe}" stroke-width="56.57" />`,
  );

const verticalStripes = (slug: string, name: string, background: string, stripe: string) =>
  tile(
    slug,
    name,
    background,
    { width: 160, height: 40 },
    () => `${fill(background, 160, 40)}<rect width="80" height="40" fill="${stripe}" />`,
  );

const starPoints = (cx: number, cy: number, outer: number, inner: number): string =>
  Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;

    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");

const heartPath = (cx: number, cy: number, size: number): string => {
  const s = size / 2;

  return `M${cx} ${cy + s * 0.9} C${cx - s * 1.6} ${cy - s * 0.1} ${cx - s * 0.7} ${cy - s * 1.2} ${cx} ${cy - s * 0.45} C${cx + s * 0.7} ${cy - s * 1.2} ${cx + s * 1.6} ${cy - s * 0.1} ${cx} ${cy + s * 0.9} Z`;
};

const confettiPieces: Array<[number, number, number, string]> = [
  [40, 50, 20, "#f28b82"],
  [150, 30, -35, "#fbbc04"],
  [260, 80, 50, "#81c995"],
  [350, 40, 10, "#8ab4f8"],
  [90, 160, -15, "#c58af9"],
  [210, 190, 70, "#f28b82"],
  [330, 170, -60, "#fbbc04"],
  [30, 270, 30, "#8ab4f8"],
  [140, 300, -45, "#81c995"],
  [250, 280, 15, "#fcad70"],
  [360, 330, 80, "#c58af9"],
  [100, 370, -5, "#fbbc04"],
];

const patternBackgrounds: BuiltInBackground[] = [
  polkaDots("polka-dots-blush", "Blush polka dots", "#f8d9e0", "#ffffff"),
  polkaDots("polka-dots-navy", "Navy polka dots", "#23345c", "#f4efe1"),
  polkaDots("polka-dots-mint", "Mint polka dots", "#d5efe4", "#ffffff"),
  gingham("gingham-red", "Red gingham", "#d94c4c"),
  gingham("gingham-blue", "Blue gingham", "#4a78c2"),
  gingham("gingham-sage", "Sage gingham", "#8aa77f"),
  diagonalStripes("stripes-lemon", "Lemon stripes", "#fff8d6", "#f6dc6c"),
  diagonalStripes("stripes-coral", "Coral stripes", "#fff1ec", "#f4a68e"),
  verticalStripes("stripes-candy", "Candy stripes", "#ffffff", "#e8828f"),
  verticalStripes("stripes-ticking", "Ticking stripes", "#f6f1e6", "#9db1c9"),
  tile(
    "grid-paper",
    "Grid paper",
    "#fbfbf6",
    75,
    () => `${fill("#fbfbf6", 75)}<path d="M0 0.5 H75 M0.5 0 V75" stroke="#a9cbe6" stroke-width="3" />`,
  ),
  tile(
    "lined-paper",
    "Lined paper",
    "#fdfcf6",
    { width: 100, height: 102 },
    () =>
      `${fill("#fdfcf6", 100, 102)}<path d="M0 100 H100" stroke="#9cc0df" stroke-width="3" />`,
  ),
  tile(
    "dot-grid",
    "Dot grid",
    "#faf6ec",
    75,
    () => `${fill("#faf6ec", 75)}<circle cx="37.5" cy="37.5" r="4" fill="#b9b1a1" />`,
  ),
  tile(
    "chevron-teal",
    "Teal chevron",
    "#e3f4f2",
    { width: 120, height: 90 },
    () =>
      `${fill("#e3f4f2", 120, 90)}<path d="M-30 75 L30 15 L90 75 L150 15" fill="none" stroke="#5bb5ac" stroke-width="24" stroke-linejoin="miter" />`,
  ),
  tile(
    "hearts",
    "Hearts",
    "#fde8ec",
    200,
    () =>
      `${fill("#fde8ec", 200)}<g fill="#ec8fa3"><path d="${heartPath(50, 52, 44)}" /><path d="${heartPath(150, 152, 44)}" /></g>`,
  ),
  tile(
    "stars",
    "Gold stars",
    "#20305a",
    220,
    () =>
      `${fill("#20305a", 220)}<g fill="#f2d27a"><polygon points="${starPoints(55, 55, 26, 11)}" /><polygon points="${starPoints(165, 165, 26, 11)}" /></g>`,
  ),
  tile(
    "confetti",
    "Confetti",
    "#fffaf2",
    400,
    () =>
      `${fill("#fffaf2", 400)}${confettiPieces
        .map(
          ([x, y, rotation, color]) =>
            `<rect x="${x - 14}" y="${y - 6}" width="28" height="12" rx="4" fill="${color}" transform="rotate(${rotation} ${x} ${y})" />`,
        )
        .join("")}`,
  ),
];

const cloud = (cx: number, cy: number, scale: number): string =>
  `<g transform="translate(${cx} ${cy}) scale(${scale})"><ellipse cx="0" cy="0" rx="70" ry="30" /><circle cx="-28" cy="-18" r="30" /><circle cx="18" cy="-26" r="38" /></g>`;

const scene = (
  slug: string,
  name: string,
  baseColor: string,
  renderScene: (idPrefix: string) => BackgroundMarkup,
): BuiltInBackground => ({
  id: `${builtInBackgroundIdPrefix}${slug}`,
  name,
  category: "sky",
  baseColor,
  fit: "cover",
  kind: "scene",
  renderScene,
});

const verticalGradient = (id: string, stops: Array<[number, string]>): string =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops
    .map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}" />`)
    .join("")}</linearGradient>`;

const skyBackgrounds: BuiltInBackground[] = [
  scene("sky-blue", "Blue sky", "#b9dcfb", (idPrefix) => {
    const gradientId = `${idPrefix}_gradient`;

    return {
      defs: verticalGradient(gradientId, [
        [0, "#7db9f2"],
        [1, "#e6f3fd"],
      ]),
      body: `<rect width="1000" height="1000" fill="url(#${gradientId})" /><g fill="#ffffff" fill-opacity="0.9">${cloud(180, 220, 1.3)}${cloud(620, 140, 1)}${cloud(820, 420, 1.5)}${cloud(330, 560, 0.9)}${cloud(700, 780, 1.1)}</g>`,
    };
  }),
  scene("sky-sunset", "Sunset", "#fbc39e", (idPrefix) => {
    const gradientId = `${idPrefix}_gradient`;

    return {
      defs: verticalGradient(gradientId, [
        [0, "#6f6bb8"],
        [0.45, "#f4908a"],
        [0.8, "#fcc98f"],
        [1, "#fdebc4"],
      ]),
      body: `<rect width="1000" height="1000" fill="url(#${gradientId})" /><circle cx="500" cy="760" r="120" fill="#fff1c9" fill-opacity="0.85" />`,
    };
  }),
  scene("sky-night", "Starry night", "#1d2b55", (idPrefix) => {
    const gradientId = `${idPrefix}_gradient`;
    const stars = Array.from({ length: 70 }, (_, index) => {
      // Deterministic scatter so renders are stable between editor and export.
      const x = (index * 379 + 97) % 1000;
      const y = (index * 613 + 211) % 1000;
      const radius = 1.5 + ((index * 7) % 5) * 0.6;

      return `<circle cx="${x}" cy="${y}" r="${radius.toFixed(1)}" />`;
    }).join("");

    return {
      defs: verticalGradient(gradientId, [
        [0, "#0b1530"],
        [1, "#2d437a"],
      ]),
      body: `<rect width="1000" height="1000" fill="url(#${gradientId})" /><g fill="#fdf6d8">${stars}</g><circle cx="790" cy="190" r="60" fill="#fdf6d8" /><circle cx="815" cy="175" r="56" fill="#0e1937" />`,
    };
  }),
];

const textureBackgrounds: BuiltInBackground[] = backgroundTextures.map((texture) => ({
  id: `${builtInBackgroundIdPrefix}${texture.slug}`,
  name: texture.name,
  category: texture.category,
  baseColor: texture.averageColor,
  fit: "tile",
  kind: "texture",
  tileWidth: texture.tileSize,
  tileHeight: texture.tileSize,
  file: texture.file,
  thumbnailFile: texture.thumbnailFile,
  source: texture.source,
}));

export const builtInBackgrounds: readonly BuiltInBackground[] = [
  ...patternBackgrounds,
  ...textureBackgrounds,
  ...skyBackgrounds,
];

const builtInBackgroundsById = new Map(
  builtInBackgrounds.map((background) => [background.id, background]),
);

export const getBuiltInBackground = (backgroundId: string): BuiltInBackground | undefined =>
  builtInBackgroundsById.get(backgroundId);
