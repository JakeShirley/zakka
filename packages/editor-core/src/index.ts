import type { Font, Path, PathCommand } from "opentype.js";
import { z } from "zod";

import { defaultTextFontFamily, getBundledEditorFont } from "./fonts.js";
import { parseRichText, type RichTextRun } from "./text-markdown.js";

export {
  defaultTextFontFamily,
  type EditorFontDefinition,
  type EditorFontId,
  editorFontDefinitions,
  editorFontFaceCss,
  getEditorFontByFamily,
  loveYaLikeASisterFontFamily,
} from "./fonts.js";

export {
  annotateInlineMarkdown,
  type MarkdownSpan,
  parseInlineRuns,
  parseRichText,
  replaceTextRange,
  type RichTextEdit,
  type RichTextParagraph,
  type RichTextRun,
  type RichTextStyle,
  toggleMarkdownStyle,
} from "./text-markdown.js";

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const layerIdSchema = z.string().min(1).max(160);
const roundToNearestTenth = (value: number): number => {
  const rounded = Math.round(value * 10) / 10;

  return Object.is(rounded, -0) ? 0 : rounded;
};
const roundToNearestHundredth = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;

  return Object.is(rounded, -0) ? 0 : rounded;
};
const roundToNearestThousandth = (value: number): number => {
  const rounded = Math.round(value * 1000) / 1000;

  return Object.is(rounded, -0) ? 0 : rounded;
};
const roundToNearestTenThousandth = (value: number): number => {
  const rounded = Math.round(value * 10000) / 10000;

  return Object.is(rounded, -0) ? 0 : rounded;
};
const coordinateSchema = z.number().finite().transform(roundToNearestTenth);
const positiveSizeSchema = z
  .number()
  .finite()
  .positive()
  .transform(roundToNearestTenth)
  .pipe(z.number().positive());
const opacitySchema = z.number().finite().min(0).max(1);
const rotationSchema = z.number().finite().min(-360).max(360).transform(roundToNearestTenth);
const cropCoordinateSchema = z.number().finite().min(0).max(1);
const cropSizeSchema = z.number().finite().min(0.05).max(1);

const defaultPhotoTransform = {
  scale: 1,
  rotation: 0,
  flipX: false,
  flipY: false,
  offsetX: 0,
  offsetY: 0,
};

const defaultPhotoCrop = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  aspectRatioPreset: "free" as const,
};

const defaultPhotoBorder = {
  width: 0,
  color: "#ffffff",
  radius: 0,
  style: "solid" as const,
  framePreset: "none" as const,
};

const defaultPhotoShadow = {
  enabled: false,
  color: "#202426",
  opacity: 0.2,
  offsetX: 0,
  offsetY: 12,
  blur: 24,
  spread: 0,
};

const defaultPhotoMask = {
  shape: "rectangle" as const,
  inset: 0,
  feather: 0,
};

const defaultPhotoFilter = {
  preset: "none" as const,
  brightness: 1,
  contrast: 1,
  saturation: 1,
};

const defaultTextStroke = {
  enabled: false,
  color: "#ffffff",
  width: 8,
};

const defaultTextShadow = {
  enabled: false,
  color: "#202426",
  opacity: 0.3,
  offsetX: 12,
  offsetY: 12,
  blur: 12,
};

const defaultTextGlow = {
  enabled: false,
  color: "#ffffff",
  opacity: 0.7,
  blur: 18,
};

const defaultTextBackground = {
  enabled: false,
  color: "#fffdf7",
  opacity: 0.9,
  padding: 12,
  radius: 10,
};

const defaultTextBubble = {
  enabled: false,
  color: "#ffd6e0",
  opacity: 0.85,
  padding: 6,
  spacing: 0,
};

const defaultWashiTapeTile = {
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
};

const washiTapeTileBaseSize = 80;

const defaultWashiTapePattern = {
  kind: "polkaDot" as const,
  primaryColor: "#fffdf7",
  secondaryColor: "#79a9a4",
};

const legacyPhotoWashiTapePattern = {
  ...defaultWashiTapePattern,
  kind: "customPhoto" as const,
};

export type StickerLibraryId = "noto" | "twemoji" | "custom";
export type StickerId = `${StickerLibraryId}:${string}`;

const builtInStickerIdPattern = /^(noto|twemoji):[a-z0-9]+(?:-[a-z0-9]+)*$/;
const customStickerIdPattern = /^custom:custom_sticker_[a-z0-9_-]+$/;

const legacyStickerIds: Record<string, StickerId> = {
  balloon: "noto:balloon",
  camera: "noto:camera",
  cupcake: "noto:cupcake",
  flower: "noto:blossom",
  "gold-star": "noto:star",
  heart: "noto:red-heart",
  "paper-clip": "noto:paperclip",
  rainbow: "noto:rainbow",
  sparkles: "noto:sparkles",
  sunshine: "noto:sun-with-face",
};

export const stickerLibrarySummaries: readonly {
  id: StickerLibraryId;
  license: string;
  name: string;
}[] = [
  { id: "noto", license: "Apache-2.0", name: "Noto Emoji" },
  { id: "twemoji", license: "CC-BY-4.0", name: "Twemoji" },
];

export const normalizeStickerId = (stickerId: string): StickerId =>
  legacyStickerIds[stickerId] ?? (stickerId as StickerId);

const isStickerId = (value: unknown): value is StickerId =>
  typeof value === "string" &&
  (builtInStickerIdPattern.test(value) || customStickerIdPattern.test(value));

export const isCustomStickerId = (value: string): value is `custom:${string}` =>
  customStickerIdPattern.test(value);

const stickerIdSchema = z.preprocess(
  (value) => (typeof value === "string" ? normalizeStickerId(value) : value),
  z.custom<StickerId>(isStickerId, "Sticker id must reference a supported library or custom pack"),
);

export type StickerDefinition = {
  category: string;
  icon: string;
  id: StickerId;
  library: StickerLibraryId;
  libraryName: string;
  name: string;
};

export type StickerSvg = {
  body: string;
  viewBox: string;
};

const pageLayerBaseSchema = z.object({
  id: layerIdSchema,
  x: coordinateSchema,
  y: coordinateSchema,
  width: positiveSizeSchema,
  height: positiveSizeSchema,
  rotation: rotationSchema,
  opacity: opacitySchema,
  locked: z.boolean(),
});

export const photoLayerSchema = pageLayerBaseSchema.extend({
  kind: z.literal("photo"),
  assetId: z.string().min(1),
  fit: z.enum(["cover", "contain"]),
  photoTransform: z
    .object({
      // Finer precision (thousandths for scale, ten-thousandths for offset) keeps
      // interactive crop/pan drags smooth: with tenths-rounded scale the displayed
      // image extent snaps by ~5% of image size between consecutive pointer ticks.
      scale: z.number().finite().min(0.1).max(5).transform(roundToNearestThousandth),
      rotation: rotationSchema,
      flipX: z.boolean(),
      flipY: z.boolean(),
      offsetX: z.number().finite().min(-1).max(1).transform(roundToNearestTenThousandth),
      offsetY: z.number().finite().min(-1).max(1).transform(roundToNearestTenThousandth),
    })
    .default(defaultPhotoTransform),
  crop: z
    .object({
      x: cropCoordinateSchema,
      y: cropCoordinateSchema,
      width: cropSizeSchema,
      height: cropSizeSchema,
      aspectRatioPreset: z.enum(["free", "original", "square", "portrait", "landscape"]),
    })
    .refine((crop) => crop.x + crop.width <= 1 && crop.y + crop.height <= 1, {
      message: "Crop must stay within the original photo bounds",
    })
    .default(defaultPhotoCrop),
  border: z
    .object({
      width: z.number().finite().min(0).max(160),
      color: colorSchema,
      radius: z.number().finite().min(0).max(1000),
      style: z.enum(["solid", "dashed", "dotted"]),
      framePreset: z.enum(["none", "mat", "polaroid", "film", "paper"]),
    })
    .default(defaultPhotoBorder),
  shadow: z
    .object({
      enabled: z.boolean(),
      color: colorSchema,
      opacity: opacitySchema,
      offsetX: z.number().finite().min(-400).max(400),
      offsetY: z.number().finite().min(-400).max(400),
      blur: z.number().finite().min(0).max(400),
      spread: z.number().finite().min(-120).max(160),
    })
    .default(defaultPhotoShadow),
  mask: z
    .object({
      shape: z.enum(["rectangle", "ellipse", "arch", "diamond", "ticket"]),
      inset: z.number().finite().min(0).max(0.45),
      feather: z.number().finite().min(0).max(80),
    })
    .default(defaultPhotoMask),
  filter: z
    .object({
      preset: z.enum(["none", "warm", "cool", "mono", "fade", "sepia"]),
      brightness: z.number().finite().min(0.2).max(2),
      contrast: z.number().finite().min(0.2).max(2),
      saturation: z.number().finite().min(0).max(3),
    })
    .default(defaultPhotoFilter),
});

export const textLayerSchema = pageLayerBaseSchema.extend({
  kind: z.literal("text"),
  text: z.string().max(2000),
  fontFamily: z.string().min(1).max(120),
  fontSize: z.number().finite().min(6).max(240),
  color: colorSchema,
  align: z.enum(["left", "center", "right"]),
  stroke: z
    .object({
      enabled: z.boolean(),
      color: colorSchema,
      width: z.number().finite().min(0).max(80),
    })
    .default(defaultTextStroke),
  shadow: z
    .object({
      enabled: z.boolean(),
      color: colorSchema,
      opacity: opacitySchema,
      offsetX: z.number().finite().min(-240).max(240),
      offsetY: z.number().finite().min(-240).max(240),
      blur: z.number().finite().min(0).max(160),
    })
    .default(defaultTextShadow),
  glow: z
    .object({
      enabled: z.boolean(),
      color: colorSchema,
      opacity: opacitySchema,
      blur: z.number().finite().min(0).max(160),
    })
    .default(defaultTextGlow),
  background: z
    .object({
      enabled: z.boolean(),
      color: colorSchema,
      opacity: opacitySchema,
      padding: z.number().finite().min(0).max(120),
      radius: z.number().finite().min(0).max(160),
    })
    .default(defaultTextBackground),
  bubble: z
    .object({
      enabled: z.boolean(),
      color: colorSchema,
      opacity: opacitySchema,
      padding: z.number().finite().min(0).max(120),
      spacing: z.number().finite().min(0).max(120).default(0),
    })
    .default(defaultTextBubble),
});

export const stickerLayerSchema = pageLayerBaseSchema.extend({
  kind: z.literal("sticker"),
  stickerId: stickerIdSchema,
});

export const washiTapeOutlineSchema = z.enum([
  "straight",
  "angled",
  "rounded",
  "torn",
  "notched",
  "bracket",
  "pinched",
  "tapered",
  "scallop",
  "stamp",
  "wave",
]);

export const washiTapePatternSchema = z.object({
  kind: z.enum(["solid", "polkaDot", "stripe", "grid", "checker", "customPhoto"]),
  primaryColor: colorSchema,
  secondaryColor: colorSchema,
  assetId: z.string().min(1).optional(),
});

export const washiTapeTileSchema = z.object({
  scale: z.number().finite().min(0.2).max(4).transform(roundToNearestHundredth),
  scaleX: z.number().finite().min(0.01).max(4).transform(roundToNearestHundredth).default(1),
  scaleY: z.number().finite().min(0.01).max(4).transform(roundToNearestHundredth).default(1),
  rotation: rotationSchema,
  offsetX: z.number().finite().min(-1).max(1).transform(roundToNearestHundredth),
  offsetY: z.number().finite().min(-1).max(1).transform(roundToNearestHundredth),
});

/**
 * The reusable look of a washi tape (outline, pattern, and tile settings) without any
 * placement on a page, so a design can be saved to a gallery and applied to new layers.
 */
export const washiTapeDesignSchema = z.object({
  outline: washiTapeOutlineSchema,
  pattern: washiTapePatternSchema,
  tile: washiTapeTileSchema,
});

export const washiTapeLayerSchema = pageLayerBaseSchema.extend({
  kind: z.literal("washiTape"),
  assetId: z.string().min(1).optional(),
  outline: washiTapeOutlineSchema,
  pattern: washiTapePatternSchema.default(legacyPhotoWashiTapePattern),
  tile: washiTapeTileSchema.default(defaultWashiTapeTile),
});

export const pageLayerSchema = z.discriminatedUnion("kind", [
  photoLayerSchema,
  textLayerSchema,
  stickerLayerSchema,
  washiTapeLayerSchema,
]);

export const pageDocumentSchema = z.object({
  version: z.literal(1),
  canvas: z.object({
    width: z.number().int().min(320).max(10000),
    height: z.number().int().min(320).max(10000),
    backgroundColor: colorSchema,
  }),
  layers: z.array(pageLayerSchema).max(200),
});

export type PageDocument = z.infer<typeof pageDocumentSchema>;
export type PageLayer = z.infer<typeof pageLayerSchema>;
export type PhotoLayer = z.infer<typeof photoLayerSchema>;
export type TextLayer = z.infer<typeof textLayerSchema>;
export type StickerLayer = z.infer<typeof stickerLayerSchema>;
export type WashiTapeLayer = z.infer<typeof washiTapeLayerSchema>;
export type WashiTapeDesign = z.infer<typeof washiTapeDesignSchema>;
export type PageLayerKind = PageLayer["kind"];

export type RenderPageSvgOptions = {
  idPrefix?: string;
  includeBackground?: boolean;
  resolvePhotoHref?: (layer: PhotoLayer) => string | null | undefined;
  resolveStickerSvg?: (layer: StickerLayer) => StickerSvg | null | undefined;
  resolveStickerHref?: (layer: StickerLayer) => string | null | undefined;
  resolveWashiTapeHref?: (layer: WashiTapeLayer) => string | null | undefined;
  /**
   * Photo layer ids that should render an extra translucent unclipped image
   * behind the cropped one, so the editor can preview the full source photo
   * while the user is positioning a crop.
   */
  panPreviewLayerIds?: ReadonlySet<string>;
};

export type OrderedBookPage = {
  pageId: string;
  sortOrder: number;
};

export type BookSpread = {
  spreadIndex: number;
  kind: "facing" | "single";
  leftPageId: string | null;
  rightPageId: string | null;
  pageIds: string[];
};

export type CreateBookSpreadsOptions = {
  coverSpreadEnabled?: boolean;
};

export type CreatePageDocumentInput = {
  canvas?: Partial<PageDocument["canvas"]>;
  layers?: PageLayer[];
};

export type CreatePhotoLayerInput = Partial<
  Pick<
    PhotoLayer,
    | "border"
    | "crop"
    | "filter"
    | "fit"
    | "height"
    | "id"
    | "locked"
    | "mask"
    | "opacity"
    | "photoTransform"
    | "rotation"
    | "shadow"
    | "width"
    | "x"
    | "y"
  >
> & {
  assetId: string;
};

export type CreateTextLayerInput = Partial<
  Pick<
    TextLayer,
    | "align"
    | "color"
    | "fontFamily"
    | "fontSize"
    | "glow"
    | "height"
    | "id"
    | "locked"
    | "opacity"
    | "rotation"
    | "shadow"
    | "stroke"
    | "background"
    | "bubble"
    | "width"
    | "x"
    | "y"
  >
> & {
  text: string;
};

export type CreateStickerLayerInput = Partial<
  Pick<StickerLayer, "height" | "id" | "locked" | "opacity" | "rotation" | "width" | "x" | "y">
> & {
  stickerId?: string;
};

export type CreateWashiTapeLayerInput = Partial<
  Pick<
    WashiTapeLayer,
    | "assetId"
    | "height"
    | "id"
    | "locked"
    | "opacity"
    | "outline"
    | "pattern"
    | "rotation"
    | "width"
    | "x"
    | "y"
  >
> & {
  tile?: Partial<WashiTapeLayer["tile"]>;
};

const createRandomId = (): string => {
  try {
    const randomUuid = globalThis.crypto?.randomUUID?.() ?? null;

    if (randomUuid) {
      return randomUuid;
    }
  } catch {}

  const bytes = new Uint8Array(16);
  let hasRandomBytes = false;

  try {
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
      hasRandomBytes = true;
    }
  } catch {
    hasRandomBytes = false;
  }

  if (hasRandomBytes) {
    bytes[6] = ((bytes.at(6) ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes.at(8) ?? 0) & 0x3f) | 0x80;

    const hexBytes = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

    return `${hexBytes.slice(0, 4).join("")}-${hexBytes.slice(4, 6).join("")}-${hexBytes
      .slice(6, 8)
      .join("")}-${hexBytes.slice(8, 10).join("")}-${hexBytes.slice(10, 16).join("")}`;
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

const createLayerId = (): string => `layer_${createRandomId()}`;

const parseDocument = (document: PageDocument): PageDocument => pageDocumentSchema.parse(document);

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const svgIdPart = (value: string): string => {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_");

  return sanitized.length > 0 ? sanitized : "svg";
};

const createSvgId = (...parts: Array<number | string>): string =>
  parts.map((part) => svgIdPart(String(part))).join("_");

const layerTransform = (layer: PageLayer): string => {
  const centerX = layer.x + layer.width / 2;
  const centerY = layer.y + layer.height / 2;

  return `rotate(${layer.rotation} ${centerX} ${centerY})`;
};

const layerPoint = (layer: Pick<PageLayer, "height" | "width" | "x" | "y">, x: number, y: number) =>
  `${layer.x + layer.width * x},${layer.y + layer.height * y}`;

const layerPolygon = (
  layer: Pick<PageLayer, "height" | "width" | "x" | "y">,
  points: Array<[number, number]>,
) => points.map(([x, y]) => layerPoint(layer, x, y)).join(" ");

const layerPath = (
  layer: Pick<PageLayer, "height" | "width" | "x" | "y">,
  commands: string,
): string =>
  commands.replaceAll(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g, (_match, x: string, y: string) =>
    layerPoint(layer, Number(x), Number(y)),
  );

export type PhotoFrameRect = Pick<PageLayer, "height" | "width" | "x" | "y"> & {
  radius: number;
};

export type PhotoFrameInsets = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type PhotoFrameLayout = {
  image: PhotoFrameRect;
  insets: PhotoFrameInsets;
  outer: PhotoFrameRect;
};

const minimumPhotoFrameImageSize = 1;

const roundSvgNumber = (value: number): number => {
  const rounded = Math.round(value * 10) / 10;

  return Object.is(rounded, -0) ? 0 : rounded;
};

const createPhotoFrameRect = ({ height, radius, width, x, y }: PhotoFrameRect): PhotoFrameRect => ({
  height: roundSvgNumber(Math.max(0, height)),
  radius: roundSvgNumber(Math.max(0, radius)),
  width: roundSvgNumber(Math.max(0, width)),
  x: roundSvgNumber(x),
  y: roundSvgNumber(y),
});

const constrainPhotoFrameInsets = (
  layer: PhotoLayer,
  insets: PhotoFrameInsets,
): PhotoFrameInsets => {
  const horizontalInset = insets.left + insets.right;
  const verticalInset = insets.top + insets.bottom;
  const horizontalScale =
    horizontalInset > layer.width - minimumPhotoFrameImageSize
      ? Math.max(0, layer.width - minimumPhotoFrameImageSize) / horizontalInset
      : 1;
  const verticalScale =
    verticalInset > layer.height - minimumPhotoFrameImageSize
      ? Math.max(0, layer.height - minimumPhotoFrameImageSize) / verticalInset
      : 1;

  return {
    bottom: roundSvgNumber(Math.max(0, insets.bottom * verticalScale)),
    left: roundSvgNumber(Math.max(0, insets.left * horizontalScale)),
    right: roundSvgNumber(Math.max(0, insets.right * horizontalScale)),
    top: roundSvgNumber(Math.max(0, insets.top * verticalScale)),
  };
};

const createPhotoFrameLayout = (layer: PhotoLayer, insets: PhotoFrameInsets): PhotoFrameLayout => {
  const constrainedInsets = constrainPhotoFrameInsets(layer, insets);
  const largestInset = Math.max(
    constrainedInsets.bottom,
    constrainedInsets.left,
    constrainedInsets.right,
    constrainedInsets.top,
  );
  const image = createPhotoFrameRect({
    height: Math.max(
      minimumPhotoFrameImageSize,
      layer.height - constrainedInsets.top - constrainedInsets.bottom,
    ),
    radius: Math.max(0, layer.border.radius - largestInset * 0.4),
    width: Math.max(
      minimumPhotoFrameImageSize,
      layer.width - constrainedInsets.left - constrainedInsets.right,
    ),
    x: layer.x + constrainedInsets.left,
    y: layer.y + constrainedInsets.top,
  });

  return {
    image,
    insets: constrainedInsets,
    outer: createPhotoFrameRect({
      height: layer.height,
      radius: layer.border.radius,
      width: layer.width,
      x: layer.x,
      y: layer.y,
    }),
  };
};

export const getPhotoFrameLayout = (layer: PhotoLayer): PhotoFrameLayout => {
  const minimumDimension = Math.min(layer.width, layer.height);
  const explicitWidth = layer.border.width > 0;

  switch (layer.border.framePreset) {
    case "mat": {
      const inset = explicitWidth ? layer.border.width : minimumDimension * 0.1;

      return createPhotoFrameLayout(layer, {
        bottom: inset,
        left: inset,
        right: inset,
        top: inset,
      });
    }
    case "polaroid": {
      const sideInset = explicitWidth ? layer.border.width : minimumDimension * 0.07;
      const bottomInset = explicitWidth
        ? Math.max(layer.border.width * 2.3, layer.border.width + minimumDimension * 0.04)
        : Math.max(sideInset * 2.4, layer.height * 0.18);

      return createPhotoFrameLayout(layer, {
        bottom: bottomInset,
        left: sideInset,
        right: sideInset,
        top: sideInset,
      });
    }
    case "film": {
      const sideInset = explicitWidth ? layer.border.width : minimumDimension * 0.11;
      const verticalInset = explicitWidth
        ? Math.max(layer.border.width * 0.62, minimumDimension * 0.035)
        : minimumDimension * 0.06;

      return createPhotoFrameLayout(layer, {
        bottom: verticalInset,
        left: sideInset,
        right: sideInset,
        top: verticalInset,
      });
    }
    case "paper": {
      const inset = explicitWidth ? layer.border.width : minimumDimension * 0.055;

      return createPhotoFrameLayout(layer, {
        bottom: inset,
        left: inset,
        right: inset,
        top: inset,
      });
    }
    case "none":
      return createPhotoFrameLayout(layer, { bottom: 0, left: 0, right: 0, top: 0 });
  }
};

const photoMaskShapeSvg = (
  shape: PhotoLayer["mask"]["shape"],
  rect: PhotoFrameRect,
  inset: number,
  attributes = "",
): string => {
  const extra = attributes ? ` ${attributes}` : "";

  switch (shape) {
    case "rectangle":
      return `<rect${extra} x="${rect.x + rect.width * inset}" y="${rect.y + rect.height * inset}" width="${rect.width * (1 - inset * 2)}" height="${rect.height * (1 - inset * 2)}" rx="${rect.radius}" />`;
    case "ellipse":
      return `<ellipse${extra} cx="${rect.x + rect.width / 2}" cy="${rect.y + rect.height / 2}" rx="${rect.width * (0.5 - inset)}" ry="${rect.height * (0.5 - inset)}" />`;
    case "arch":
      return `<polygon${extra} points="${layerPolygon(rect, [
        [inset, 1],
        [inset, 0.36],
        [0.18, 0.08],
        [0.5, 0],
        [0.82, 0.08],
        [1 - inset, 0.36],
        [1 - inset, 1],
      ])}" />`;
    case "diamond":
      return `<polygon${extra} points="${layerPolygon(rect, [
        [0.5, inset],
        [1 - inset, 0.5],
        [0.5, 1 - inset],
        [inset, 0.5],
      ])}" />`;
    case "ticket":
      return `<polygon${extra} points="${layerPolygon(rect, [
        [inset, inset],
        [0.42, inset],
        [0.5, 0.1],
        [0.58, inset],
        [1 - inset, inset],
        [1 - inset, 0.42],
        [0.9, 0.5],
        [1 - inset, 0.58],
        [1 - inset, 1 - inset],
        [0.58, 1 - inset],
        [0.5, 0.9],
        [0.42, 1 - inset],
        [inset, 1 - inset],
        [inset, 0.58],
        [0.1, 0.5],
        [inset, 0.42],
      ])}" />`;
  }
};

// A non-rectangular (or inset) mask should cut the whole photo object, so anything
// painted behind the image — frame backgrounds, textures, borders — stays transparent
// outside the shape instead of leaving a visible rectangle.
const photoMaskCutsFrame = (layer: PhotoLayer): boolean =>
  layer.mask.shape !== "rectangle" || layer.mask.inset > 0;

const photoClipPath = (layer: PhotoLayer, clipId: string, imageFrame: PhotoFrameRect): string =>
  `<clipPath id="${clipId}">${photoMaskShapeSvg(layer.mask.shape, imageFrame, layer.mask.inset)}</clipPath>`;

const photoFrameClipPath = (
  layer: PhotoLayer,
  clipId: string,
  outerFrame: PhotoFrameRect,
): string =>
  photoMaskCutsFrame(layer)
    ? `<clipPath id="${clipId}">${photoMaskShapeSvg(layer.mask.shape, outerFrame, layer.mask.inset)}</clipPath>`
    : "";

const defaultPhotoFrameColor = "#ffffff";

const photoFrameFill = (layer: PhotoLayer): string => {
  if (
    layer.border.framePreset === "film" &&
    layer.border.color.toLowerCase() === defaultPhotoFrameColor
  ) {
    return "#202426";
  }

  if (
    layer.border.framePreset === "paper" &&
    layer.border.color.toLowerCase() === defaultPhotoFrameColor
  ) {
    return "#fffdf7";
  }

  return layer.border.color;
};

const borderStrokeDasharray = (style: PhotoLayer["border"]["style"]): string =>
  style === "dashed" ? "24 18" : style === "dotted" ? "4 14" : "";

const rectSvg = (rect: PhotoFrameRect): string =>
  `x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${rect.radius}"`;

const renderFilmSprocketHolesSvg = (layer: PhotoLayer, layout: PhotoFrameLayout): string => {
  const sideInset = Math.max(layout.insets.left, layout.insets.right);

  if (sideInset <= 0) {
    return "";
  }

  const holeWidth = Math.max(2, Math.min(sideInset * 0.42, layer.width * 0.05));
  const holeHeight = Math.max(3, Math.min(holeWidth * 1.45, layer.height * 0.1));
  const availableHeight = Math.max(1, layout.image.height);
  const holeCount = Math.max(2, Math.min(12, Math.floor(availableHeight / (holeHeight * 1.65))));
  const step = availableHeight / holeCount;
  const leftX = layer.x + Math.max(0, (layout.insets.left - holeWidth) / 2);
  const rightX =
    layer.x +
    layer.width -
    layout.insets.right +
    Math.max(0, (layout.insets.right - holeWidth) / 2);
  const holes: string[] = [];

  for (let index = 0; index < holeCount; index += 1) {
    const holeY = layout.image.y + step * index + Math.max(0, (step - holeHeight) / 2);

    holes.push(
      `<rect data-frame-detail="film-sprocket" x="${leftX}" y="${holeY}" width="${holeWidth}" height="${holeHeight}" rx="${Math.min(holeWidth, holeHeight) * 0.18}" fill="#fffdf7" opacity="0.92" />`,
      `<rect data-frame-detail="film-sprocket" x="${rightX}" y="${holeY}" width="${holeWidth}" height="${holeHeight}" rx="${Math.min(holeWidth, holeHeight) * 0.18}" fill="#fffdf7" opacity="0.92" />`,
    );
  }

  return holes.join("");
};

const renderPaperTextureSvg = (layer: PhotoLayer): string => {
  const stroke =
    layer.border.color.toLowerCase() === defaultPhotoFrameColor ? "#d8ddd8" : "#ffffff";
  const opacity = layer.border.color.toLowerCase() === defaultPhotoFrameColor ? 0.38 : 0.28;
  const strokeWidth = Math.max(1, Math.min(layer.width, layer.height) * 0.004);
  const paths = [
    `M ${layer.x + layer.width * 0.05} ${layer.y + layer.height * 0.18} C ${layer.x + layer.width * 0.24} ${layer.y + layer.height * 0.1}, ${layer.x + layer.width * 0.34} ${layer.y + layer.height * 0.24}, ${layer.x + layer.width * 0.48} ${layer.y + layer.height * 0.15}`,
    `M ${layer.x + layer.width * 0.68} ${layer.y + layer.height * 0.08} C ${layer.x + layer.width * 0.78} ${layer.y + layer.height * 0.18}, ${layer.x + layer.width * 0.84} ${layer.y + layer.height * 0.1}, ${layer.x + layer.width * 0.94} ${layer.y + layer.height * 0.2}`,
    `M ${layer.x + layer.width * 0.12} ${layer.y + layer.height * 0.86} C ${layer.x + layer.width * 0.28} ${layer.y + layer.height * 0.78}, ${layer.x + layer.width * 0.42} ${layer.y + layer.height * 0.93}, ${layer.x + layer.width * 0.58} ${layer.y + layer.height * 0.84}`,
    `M ${layer.x + layer.width * 0.72} ${layer.y + layer.height * 0.9} C ${layer.x + layer.width * 0.82} ${layer.y + layer.height * 0.82}, ${layer.x + layer.width * 0.9} ${layer.y + layer.height * 0.94}, ${layer.x + layer.width * 0.98} ${layer.y + layer.height * 0.84}`,
  ];

  return paths
    .map(
      (path) =>
        `<path data-frame-detail="paper-fiber" d="${path}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="${opacity}" />`,
    )
    .join("");
};

const photoSilhouetteShapeSvg = (
  layer: PhotoLayer,
  layout: PhotoFrameLayout,
  fill: string,
): string => {
  const hasVisibleFrame = layer.border.framePreset !== "none" || layer.border.width > 0;

  if (hasVisibleFrame && !photoMaskCutsFrame(layer)) {
    const outer = layout.outer;

    return `<rect data-photo-shadow-shape="frame" x="${outer.x}" y="${outer.y}" width="${outer.width}" height="${outer.height}" rx="${outer.radius}" fill="${fill}" />`;
  }

  const silhouetteFrame = hasVisibleFrame ? layout.outer : layout.image;

  return photoMaskShapeSvg(
    layer.mask.shape,
    silhouetteFrame,
    layer.mask.inset,
    `data-photo-shadow-shape="mask-${layer.mask.shape}" fill="${fill}"`,
  );
};

const renderPhotoShadowFilterSvg = (layer: PhotoLayer, filterId: string): string => {
  if (!layer.shadow.enabled || layer.shadow.opacity <= 0) {
    return "";
  }

  const blur = Math.max(0, layer.shadow.blur);
  const spread = layer.shadow.spread;
  const stdDeviation = blur / 2;
  const margin = Math.max(
    24,
    Math.abs(layer.shadow.offsetX) +
      Math.abs(layer.shadow.offsetY) +
      blur * 2 +
      Math.max(0, spread) * 2,
  );
  const parts: string[] = [];

  if (spread > 0) {
    parts.push(
      `<feMorphology in="SourceGraphic" operator="dilate" radius="${spread}" result="photo_shadow_spread" />`,
      `<feGaussianBlur in="photo_shadow_spread" stdDeviation="${stdDeviation}" />`,
    );
  } else if (spread < 0) {
    parts.push(
      `<feMorphology in="SourceGraphic" operator="erode" radius="${-spread}" result="photo_shadow_spread" />`,
      `<feGaussianBlur in="photo_shadow_spread" stdDeviation="${stdDeviation}" />`,
    );
  } else {
    parts.push(`<feGaussianBlur in="SourceGraphic" stdDeviation="${stdDeviation}" />`);
  }

  return `<filter id="${filterId}" filterUnits="userSpaceOnUse" x="${layer.x - margin}" y="${layer.y - margin}" width="${layer.width + margin * 2}" height="${layer.height + margin * 2}" color-interpolation-filters="sRGB">${parts.join("")}</filter>`;
};

const renderPhotoShadowSvg = (
  layer: PhotoLayer,
  layout: PhotoFrameLayout,
  filterId: string,
): string => {
  if (!layer.shadow.enabled || layer.shadow.opacity <= 0) {
    return "";
  }

  const shape = photoSilhouetteShapeSvg(layer, layout, escapeXml(layer.shadow.color));

  return `<g data-photo-shadow="true" transform="translate(${layer.shadow.offsetX} ${layer.shadow.offsetY})" opacity="${layer.shadow.opacity}" filter="url(#${filterId})">${shape}</g>`;
};

// Affine RGB transform: out = linear * in + offset, matching the CSS filter function matrices.
type ColorTransform = { linear: number[][]; offset: number[] };

const luminanceMixMatrix = (weights: [number, number, number], amount: number): number[][] =>
  weights.map((_, row) =>
    weights.map((weight, column) =>
      row === column ? weight + (1 - weight) * amount : weight * (1 - amount),
    ),
  );

const colorTransformFns = {
  sepia: (amount: number): ColorTransform => {
    const keep = 1 - Math.min(Math.max(amount, 0), 1);
    return {
      linear: [
        [0.393 + 0.607 * keep, 0.769 - 0.769 * keep, 0.189 - 0.189 * keep],
        [0.349 - 0.349 * keep, 0.686 + 0.314 * keep, 0.168 - 0.168 * keep],
        [0.272 - 0.272 * keep, 0.534 - 0.534 * keep, 0.131 + 0.869 * keep],
      ],
      offset: [0, 0, 0],
    };
  },
  saturate: (amount: number): ColorTransform => ({
    linear: luminanceMixMatrix([0.213, 0.715, 0.072], amount),
    offset: [0, 0, 0],
  }),
  grayscale: (amount: number): ColorTransform => ({
    linear: luminanceMixMatrix([0.2126, 0.7152, 0.0722], 1 - Math.min(Math.max(amount, 0), 1)),
    offset: [0, 0, 0],
  }),
  hueRotate: (degrees: number): ColorTransform => {
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
      linear: [
        [
          0.213 + cos * 0.787 - sin * 0.213,
          0.715 - cos * 0.715 - sin * 0.715,
          0.072 - cos * 0.072 + sin * 0.928,
        ],
        [
          0.213 - cos * 0.213 + sin * 0.143,
          0.715 + cos * 0.285 + sin * 0.14,
          0.072 - cos * 0.072 - sin * 0.283,
        ],
        [
          0.213 - cos * 0.213 - sin * 0.787,
          0.715 - cos * 0.715 + sin * 0.715,
          0.072 + cos * 0.928 + sin * 0.072,
        ],
      ],
      offset: [0, 0, 0],
    };
  },
  brightness: (amount: number): ColorTransform => ({
    linear: [
      [amount, 0, 0],
      [0, amount, 0],
      [0, 0, amount],
    ],
    offset: [0, 0, 0],
  }),
  contrast: (amount: number): ColorTransform => {
    const intercept = 0.5 - 0.5 * amount;
    return {
      linear: [
        [amount, 0, 0],
        [0, amount, 0],
        [0, 0, amount],
      ],
      offset: [intercept, intercept, intercept],
    };
  },
};

const photoFilterPresetTransforms: Record<PhotoLayer["filter"]["preset"], ColorTransform[]> = {
  none: [],
  warm: [colorTransformFns.sepia(0.18), colorTransformFns.saturate(1.14)],
  cool: [colorTransformFns.saturate(0.95), colorTransformFns.hueRotate(8)],
  mono: [colorTransformFns.grayscale(1)],
  fade: [
    colorTransformFns.contrast(0.86),
    colorTransformFns.saturate(0.72),
    colorTransformFns.brightness(1.08),
  ],
  sepia: [colorTransformFns.sepia(0.72)],
};

const isIdentityPhotoFilter = (filter: PhotoLayer["filter"]): boolean =>
  filter.preset === "none" &&
  filter.brightness === 1 &&
  filter.contrast === 1 &&
  filter.saturation === 1;

const formatMatrixValue = (value: number): string => {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

const renderPhotoColorFilterSvg = (layer: PhotoLayer, filterId: string): string => {
  if (isIdentityPhotoFilter(layer.filter)) {
    return "";
  }

  // One primitive per step so each result is clamped to [0, 1], matching chained CSS filters.
  const adjustments = [
    layer.filter.brightness === 1 ? null : colorTransformFns.brightness(layer.filter.brightness),
    layer.filter.contrast === 1 ? null : colorTransformFns.contrast(layer.filter.contrast),
    layer.filter.saturation === 1 ? null : colorTransformFns.saturate(layer.filter.saturation),
  ].filter((transform): transform is ColorTransform => transform !== null);
  const primitives = [...photoFilterPresetTransforms[layer.filter.preset], ...adjustments]
    .map((transform) => {
      const values = [
        ...transform.linear.flatMap((row, rowIndex) => [
          ...row,
          0,
          transform.offset[rowIndex] ?? 0,
        ]),
        0,
        0,
        0,
        1,
        0,
      ]
        .map(formatMatrixValue)
        .join(" ");
      return `<feColorMatrix type="matrix" values="${values}" />`;
    })
    .join("");

  return `<filter id="${filterId}" data-photo-filter="${layer.filter.preset}" color-interpolation-filters="sRGB">${primitives}</filter>`;
};

const renderPhotoFrameBackgroundSvg = (layer: PhotoLayer, layout: PhotoFrameLayout): string => {
  const fill = escapeXml(photoFrameFill(layer));

  switch (layer.border.framePreset) {
    case "none":
      return `<rect data-frame-preset="none" ${rectSvg(layout.outer)} fill="${escapeXml(layer.border.color)}" opacity="${layer.border.width > 0 ? 1 : 0}" />`;
    case "film":
      return `<rect data-frame-preset="film" ${rectSvg(layout.outer)} fill="${fill}" />${renderFilmSprocketHolesSvg(layer, layout)}`;
    case "paper":
      return `<rect data-frame-preset="paper" ${rectSvg(layout.outer)} fill="${fill}" />${renderPaperTextureSvg(layer)}`;
    case "mat":
    case "polaroid":
      return `<rect data-frame-preset="${layer.border.framePreset}" ${rectSvg(layout.outer)} fill="${fill}" />`;
  }
};

const photoWindowOutlineSvg = (
  layer: PhotoLayer,
  layout: PhotoFrameLayout,
  detail: string,
  strokeAttributes: string,
): string =>
  photoMaskShapeSvg(
    layer.mask.shape,
    layout.image,
    layer.mask.inset,
    `data-frame-detail="${detail}" fill="none" ${strokeAttributes}`,
  );

const photoOuterOutlineSvg = (
  layer: PhotoLayer,
  layout: PhotoFrameLayout,
  strokeWidth: number,
  strokeAttributes: string,
): string =>
  photoMaskCutsFrame(layer)
    ? photoMaskShapeSvg(
        layer.mask.shape,
        layout.outer,
        layer.mask.inset,
        `fill="none" ${strokeAttributes} stroke-width="${strokeWidth * 2}"`,
      )
    : `<rect ${rectSvg(layout.outer)} fill="none" ${strokeAttributes} stroke-width="${strokeWidth}" />`;

const renderPhotoFrameOverlaySvg = (layer: PhotoLayer, layout: PhotoFrameLayout): string => {
  const dasharray = borderStrokeDasharray(layer.border.style);
  const shortestSide = Math.min(layer.width, layer.height);
  const apertureStrokeWidth = Math.max(1, shortestSide * 0.008);
  const outerStrokeWidth = Math.max(1, layer.border.width * 0.12);
  const frameInset = layer.border.width / 2;

  switch (layer.border.framePreset) {
    case "none":
      return photoMaskCutsFrame(layer)
        ? photoMaskShapeSvg(
            layer.mask.shape,
            layout.outer,
            layer.mask.inset,
            `fill="none" stroke="${escapeXml(layer.border.color)}" stroke-width="${layer.border.width * 2}" stroke-dasharray="${dasharray}"`,
          )
        : `<rect x="${layer.x + frameInset}" y="${layer.y + frameInset}" width="${Math.max(0, layer.width - layer.border.width)}" height="${Math.max(0, layer.height - layer.border.width)}" rx="${layer.border.radius}" fill="none" stroke="${escapeXml(layer.border.color)}" stroke-width="${layer.border.width}" stroke-dasharray="${dasharray}" />`;
    case "mat":
      return `${photoWindowOutlineSvg(layer, layout, "mat-window", `stroke="#202426" stroke-opacity="0.12" stroke-width="${apertureStrokeWidth}"`)}${photoOuterOutlineSvg(layer, layout, outerStrokeWidth, `stroke="${escapeXml(layer.border.color)}" stroke-dasharray="${dasharray}" opacity="${layer.border.width > 0 ? 0.7 : 0}"`)}`;
    case "polaroid": {
      const captionLineY = layer.y + layer.height - layout.insets.bottom * 0.42;
      const captionInset = Math.max(layout.insets.left, shortestSide * 0.05);

      return `${photoWindowOutlineSvg(layer, layout, "polaroid-window", `stroke="#202426" stroke-opacity="0.1" stroke-width="${apertureStrokeWidth}"`)}<path data-frame-detail="polaroid-caption" d="M ${layer.x + captionInset} ${captionLineY} L ${layer.x + layer.width - captionInset} ${captionLineY}" stroke="#202426" stroke-opacity="0.12" stroke-width="${Math.max(1, shortestSide * 0.006)}" stroke-linecap="round" />`;
    }
    case "film":
      return `${photoWindowOutlineSvg(layer, layout, "film-window", `stroke="#ffffff" stroke-opacity="0.28" stroke-width="${apertureStrokeWidth}"`)}${photoOuterOutlineSvg(layer, layout, Math.max(1, shortestSide * 0.006), `stroke="#000000" stroke-opacity="0.18"`)}`;
    case "paper":
      return `${photoWindowOutlineSvg(layer, layout, "paper-window", `stroke="#202426" stroke-opacity="0.1" stroke-width="${apertureStrokeWidth}"`)}${photoOuterOutlineSvg(layer, layout, Math.max(1, shortestSide * 0.01), `stroke="${escapeXml(layer.border.color)}" stroke-dasharray="${Math.max(4, shortestSide * 0.035)} ${Math.max(5, shortestSide * 0.028)}" stroke-linecap="round" opacity="0.62"`)}`;
  }
};

const textStrokeSvgAttributes = (layer: TextLayer): string =>
  layer.stroke.enabled && layer.stroke.width > 0
    ? ` stroke="${escapeXml(layer.stroke.color)}" stroke-width="${layer.stroke.width}" stroke-linejoin="round" paint-order="stroke fill"`
    : "";

const renderTextBackgroundSvg = (layer: TextLayer): string => {
  if (!layer.background.enabled) {
    return "";
  }

  const padding = layer.background.padding;

  return `<rect data-text-background="true" x="${-padding}" y="${-padding}" width="${layer.width + padding * 2}" height="${layer.height + padding * 2}" rx="${layer.background.radius}" fill="${escapeXml(layer.background.color)}" opacity="${layer.background.opacity}" />`;
};

const formatBubbleCoord = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

type BubbleLayoutMetrics = {
  radius: number;
  cellWidth: number;
  spaceWidth: number;
};

const bubbleLayoutMetrics = (layer: TextLayer): BubbleLayoutMetrics => {
  const padding = Math.max(0, layer.bubble.padding);
  const spacing = Math.max(0, layer.bubble.spacing);
  const radius = layer.fontSize * 0.55 + padding;
  return {
    radius,
    cellWidth: radius * 2 + spacing,
    spaceWidth: layer.fontSize * 0.35 + spacing,
  };
};

const isBubbleEnabled = (layer: TextLayer): boolean =>
  layer.bubble.enabled && layer.bubble.opacity > 0;

const measureBubbleAdvance = (text: string, metrics: BubbleLayoutMetrics): number => {
  let width = 0;
  for (const character of text) {
    width += character.trim().length === 0 ? metrics.spaceWidth : metrics.cellWidth;
  }
  return width;
};

type CharacterCell = {
  character: string;
  bold: boolean;
  italic: boolean;
};

const flattenLineToCells = (line: RichTextRun[]): CharacterCell[] => {
  const cells: CharacterCell[] = [];
  for (const run of line) {
    for (const character of run.text) {
      cells.push({ character, bold: run.bold, italic: run.italic });
    }
  }
  return cells;
};

const renderBubbleLetterTextLayerSvg = (
  layer: TextLayer,
  bundledFont: Font | null,
  lines: RichTextRun[][],
  lineHeight: number,
  background: string,
  contentAttributes: string,
): string => {
  const metrics = bubbleLayoutMetrics(layer);
  const fontSize = layer.fontSize;
  const strokeAttributes = textStrokeSvgAttributes(layer);
  const fauxBoldStrokeWidth = fontSize * 0.06;
  const italicSkewDegrees = 12;
  const bubbleFill = escapeXml(layer.bubble.color);
  const bubbleOpacity = layer.bubble.opacity;

  const bubbleFragments: string[] = [];
  const textFragments: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line || line.length === 0) continue;
    const cells = flattenLineToCells(line);
    if (cells.length === 0) continue;

    const lineWidth = cells.reduce(
      (total, cell) =>
        total + (cell.character.trim().length === 0 ? metrics.spaceWidth : metrics.cellWidth),
      0,
    );
    const lineStartX =
      layer.align === "center"
        ? layer.width / 2 - lineWidth / 2
        : layer.align === "right"
          ? layer.width - lineWidth
          : 0;
    const baselineY = fontSize + lineIndex * lineHeight;
    const bubbleCy = baselineY - fontSize * 0.35;

    let cursorX = lineStartX;
    for (const { character, bold, italic } of cells) {
      if (character.trim().length === 0) {
        cursorX += metrics.spaceWidth;
        continue;
      }
      const cellCenterX = cursorX + metrics.cellWidth / 2;

      bubbleFragments.push(
        `<circle data-text-bubble="true" cx="${formatBubbleCoord(cellCenterX)}" cy="${formatBubbleCoord(bubbleCy)}" r="${formatBubbleCoord(metrics.radius)}" fill="${bubbleFill}" stroke="none" opacity="${bubbleOpacity}" />`,
      );

      if (bundledFont) {
        const advance = bundledFont.getAdvanceWidth(character, fontSize);
        const glyphX = cellCenterX - advance / 2;
        const glyphPaths = bundledFont
          .getPaths(character, 0, 0, fontSize)
          .map(pathData)
          .filter((pathString) => pathString.length > 0)
          .map((pathString) => `<path d="${pathString}" />`)
          .join("");
        if (glyphPaths.length === 0) {
          cursorX += metrics.cellWidth;
          continue;
        }
        const transformParts = [
          `translate(${formatBubbleCoord(glyphX)} ${formatBubbleCoord(baselineY)})`,
        ];
        if (italic) transformParts.push(`skewX(-${italicSkewDegrees})`);
        const groupAttributes = bold
          ? ` stroke="${escapeXml(layer.color)}" stroke-width="${fauxBoldStrokeWidth}" stroke-linejoin="round" paint-order="stroke fill"`
          : "";
        textFragments.push(
          `<g transform="${transformParts.join(" ")}"${groupAttributes}>${glyphPaths}</g>`,
        );
      } else {
        const styleParts: string[] = [];
        if (bold) styleParts.push('font-weight="bold"');
        if (italic) styleParts.push('font-style="italic"');
        const styleAttr = styleParts.length > 0 ? ` ${styleParts.join(" ")}` : "";
        textFragments.push(
          `<text x="${formatBubbleCoord(cellCenterX)}" y="${formatBubbleCoord(baselineY)}" fill="${escapeXml(layer.color)}" font-family="${escapeXml(layer.fontFamily)}" font-size="${fontSize}" text-anchor="middle"${strokeAttributes}${styleAttr}>${escapeXml(character)}</text>`,
        );
      }
      cursorX += metrics.cellWidth;
    }
  }

  const contentGroupAttributes = bundledFont
    ? ` fill="${escapeXml(layer.color)}"${strokeAttributes}${contentAttributes}`
    : contentAttributes;

  return `<g data-layer-id="${escapeXml(layer.id)}" data-font-family="${escapeXml(layer.fontFamily)}" opacity="${layer.opacity}" transform="${layerTransform(layer)}"><g data-layer-local-transform="true" transform="translate(${layer.x} ${layer.y})">${background}<g${contentGroupAttributes}>${bubbleFragments.join("")}${textFragments.join("")}</g></g></g>`;
};

const renderTextEffectFilterSvg = (layer: TextLayer, filterId: string): string => {
  const filterParts: string[] = [];
  const mergeNodes: string[] = [];
  const shadow = layer.shadow.enabled && layer.shadow.opacity > 0;
  const glow = layer.glow.enabled && layer.glow.opacity > 0;

  if (!shadow && !glow) {
    return "";
  }

  if (shadow) {
    filterParts.push(
      `<feGaussianBlur in="SourceAlpha" stdDeviation="${layer.shadow.blur}" result="text_shadow_blur" />`,
      `<feOffset in="text_shadow_blur" dx="${layer.shadow.offsetX}" dy="${layer.shadow.offsetY}" result="text_shadow_offset" />`,
      `<feFlood flood-color="${escapeXml(layer.shadow.color)}" flood-opacity="${layer.shadow.opacity}" result="text_shadow_color" />`,
      '<feComposite in="text_shadow_color" in2="text_shadow_offset" operator="in" result="text_shadow" />',
    );
    mergeNodes.push('<feMergeNode in="text_shadow" />');
  }

  if (glow) {
    filterParts.push(
      `<feGaussianBlur in="SourceAlpha" stdDeviation="${layer.glow.blur}" result="text_glow_blur" />`,
      `<feFlood flood-color="${escapeXml(layer.glow.color)}" flood-opacity="${layer.glow.opacity}" result="text_glow_color" />`,
      '<feComposite in="text_glow_color" in2="text_glow_blur" operator="in" result="text_glow" />',
    );
    mergeNodes.push('<feMergeNode in="text_glow" />');
  }

  const margin = Math.max(
    layer.stroke.enabled ? layer.stroke.width : 0,
    shadow
      ? Math.abs(layer.shadow.offsetX) + Math.abs(layer.shadow.offsetY) + layer.shadow.blur * 3
      : 0,
    glow ? layer.glow.blur * 3 : 0,
  );

  return `<filter id="${filterId}" filterUnits="userSpaceOnUse" x="${-margin}" y="${-margin}" width="${layer.width + margin * 2}" height="${layer.height + margin * 2}" color-interpolation-filters="sRGB">${filterParts.join("")}<feMerge>${mergeNodes.join("")}<feMergeNode in="SourceGraphic" /></feMerge></filter>`;
};

const textTruncationEllipsis = "…";

const fallbackFontAdvanceFactor = 0.5;

const fallbackFontAdvance = (line: string, fontSize: number): number =>
  line.length * fontSize * fallbackFontAdvanceFactor;

type CanvasTextMeasurer = (line: string) => number;

const canvasMeasurerCache = new Map<string, CanvasTextMeasurer>();
let canvasMeasurerUnavailable = false;

const getCanvasTextMeasurer = (fontFamily: string, fontSize: number): CanvasTextMeasurer | null => {
  if (canvasMeasurerUnavailable) return null;

  const documentRef = (globalThis as { document?: { createElement?(tag: string): unknown } })
    .document;

  if (!documentRef?.createElement) {
    canvasMeasurerUnavailable = true;
    return null;
  }

  const cacheKey = `${fontSize}::${fontFamily}`;
  const cached = canvasMeasurerCache.get(cacheKey);
  if (cached) return cached;

  let context: CanvasRenderingContext2D | null = null;
  try {
    const canvas = documentRef.createElement("canvas") as HTMLCanvasElement;
    context = canvas.getContext("2d");
  } catch {
    canvasMeasurerUnavailable = true;
    return null;
  }

  if (!context) {
    canvasMeasurerUnavailable = true;
    return null;
  }

  context.font = `${fontSize}px ${fontFamily}`;
  const measurer: CanvasTextMeasurer = (line) => context.measureText(line).width;
  canvasMeasurerCache.set(cacheKey, measurer);
  return measurer;
};

type StyledToken = {
  text: string;
  bold: boolean;
  italic: boolean;
  isSpace: boolean;
};

const tokenizeRichParagraph = (runs: RichTextRun[]): StyledToken[] => {
  const tokens: StyledToken[] = [];

  for (const run of runs) {
    if (run.text.length === 0) continue;

    const matches = run.text.match(/\s+|\S+/g);
    if (!matches) continue;

    for (const match of matches) {
      tokens.push({
        text: match,
        bold: run.bold,
        italic: run.italic,
        isSpace: /^\s+$/.test(match),
      });
    }
  }

  return tokens;
};

const tokensJoinText = (tokens: StyledToken[]): string =>
  tokens.map((token) => token.text).join("");

const mergeTokensIntoRuns = (tokens: StyledToken[]): RichTextRun[] => {
  const runs: RichTextRun[] = [];

  for (const token of tokens) {
    if (token.text.length === 0) continue;
    const previous = runs[runs.length - 1];

    if (previous && previous.bold === token.bold && previous.italic === token.italic) {
      previous.text += token.text;
      continue;
    }

    runs.push({ text: token.text, bold: token.bold, italic: token.italic });
  }

  return runs;
};

const trimTrailingSpaceTokens = (tokens: StyledToken[]): StyledToken[] => {
  let end = tokens.length;
  while (end > 0 && tokens[end - 1]?.isSpace === true) {
    end -= 1;
  }
  return tokens.slice(0, end);
};

const wrapRichTextLinesToBox = (
  paragraphs: RichTextRun[][],
  maxWidth: number,
  maxLines: number,
  measure: (line: string) => number,
): { lines: RichTextRun[][]; truncated: boolean } => {
  const plainTextLength = paragraphs.reduce(
    (total, paragraph) =>
      total + paragraph.reduce((paragraphTotal, run) => paragraphTotal + run.text.length, 0),
    0,
  );

  if (maxLines <= 0) {
    return { lines: [], truncated: plainTextLength > 0 };
  }

  if (plainTextLength === 0 && paragraphs.length === 0) {
    return { lines: [], truncated: false };
  }

  const lines: RichTextRun[][] = [];
  let truncated = false;

  const emit = (tokens: StyledToken[]): boolean => {
    if (lines.length >= maxLines) {
      truncated = true;
      return false;
    }

    lines.push(mergeTokensIntoRuns(trimTrailingSpaceTokens(tokens)));
    return true;
  };

  const splitTokenByCharacter = (token: StyledToken): StyledToken[] => {
    return Array.from(token.text, (character) => ({
      text: character,
      bold: token.bold,
      italic: token.italic,
      isSpace: token.isSpace,
    }));
  };

  paragraphLoop: for (let p = 0; p < paragraphs.length; p += 1) {
    const paragraph = paragraphs[p] ?? [];
    const tokens = tokenizeRichParagraph(paragraph);

    if (tokens.length === 0) {
      if (!emit([])) break;
      continue;
    }

    let line: StyledToken[] = [];

    for (const token of tokens) {
      if (token.isSpace) {
        if (line.length === 0) continue;

        if (measure(tokensJoinText(line) + token.text) <= maxWidth) {
          line.push(token);
        } else {
          if (!emit(line)) break paragraphLoop;
          line = [];
        }
        continue;
      }

      const tokenAdvance = measure(token.text);

      if (line.length === 0 || measure(tokensJoinText(line) + token.text) <= maxWidth) {
        if (line.length === 0 && tokenAdvance > maxWidth) {
          let bufferChars: StyledToken[] = [];
          for (const characterToken of splitTokenByCharacter(token)) {
            const candidate = tokensJoinText(bufferChars) + characterToken.text;
            if (bufferChars.length === 0 || measure(candidate) <= maxWidth) {
              bufferChars.push(characterToken);
            } else {
              if (!emit(bufferChars)) break paragraphLoop;
              bufferChars = [characterToken];
            }
          }
          line = bufferChars;
        } else {
          line.push(token);
        }
        continue;
      }

      if (!emit(line)) break paragraphLoop;
      line = [];

      if (tokenAdvance <= maxWidth) {
        line.push(token);
        continue;
      }

      let bufferChars: StyledToken[] = [];
      for (const characterToken of splitTokenByCharacter(token)) {
        const candidate = tokensJoinText(bufferChars) + characterToken.text;
        if (bufferChars.length === 0 || measure(candidate) <= maxWidth) {
          bufferChars.push(characterToken);
        } else {
          if (!emit(bufferChars)) break paragraphLoop;
          bufferChars = [characterToken];
        }
      }
      line = bufferChars;
    }

    if (line.length > 0) {
      if (!emit(line)) break;
    }
  }

  return { lines, truncated };
};

const appendEllipsisToLastRichLine = (
  lines: RichTextRun[][],
  maxWidth: number,
  measure: (line: string) => number,
): RichTextRun[][] => {
  if (lines.length === 0) return lines;

  const lastIndex = lines.length - 1;
  const lastLine = lines[lastIndex] ?? [];
  const working: RichTextRun[] = lastLine.map((run) => ({ ...run }));

  const lineText = (): string => working.map((run) => run.text).join("");

  while (working.length > 0 && measure(lineText() + textTruncationEllipsis) > maxWidth) {
    let runIndex = working.length - 1;
    while (runIndex >= 0 && (working[runIndex]?.text.length ?? 0) === 0) runIndex -= 1;
    if (runIndex < 0) break;
    const targetRun = working[runIndex];
    if (!targetRun) break;
    targetRun.text = targetRun.text.slice(0, -1);
  }

  const filtered = working.filter((run) => run.text.length > 0);
  const finalRuns: RichTextRun[] =
    filtered.length > 0
      ? filtered.map((run, index) =>
          index === filtered.length - 1 ? { ...run, text: run.text + textTruncationEllipsis } : run,
        )
      : [{ text: textTruncationEllipsis, bold: false, italic: false }];

  const result = lines.slice();
  result[lastIndex] = finalRuns;
  return result;
};

const computeTextLayerLines = (
  layer: TextLayer,
  bundledFont: Font | null,
): { lines: RichTextRun[][]; lineHeight: number } => {
  const lineHeight = layer.fontSize * 1.2;
  const maxLines = Math.max(1, Math.floor(layer.height / lineHeight));
  const canvasMeasure = bundledFont
    ? null
    : getCanvasTextMeasurer(layer.fontFamily, layer.fontSize);
  const measure: CanvasTextMeasurer = isBubbleEnabled(layer)
    ? (() => {
        const metrics = bubbleLayoutMetrics(layer);
        return (line: string) => measureBubbleAdvance(line, metrics);
      })()
    : bundledFont
      ? (line: string) => bundledFont.getAdvanceWidth(line, layer.fontSize)
      : canvasMeasure
        ? canvasMeasure
        : (line: string) => fallbackFontAdvance(line, layer.fontSize);
  const paragraphs = parseRichText(layer.text);
  const { lines, truncated } = wrapRichTextLinesToBox(paragraphs, layer.width, maxLines, measure);
  const displayLines = truncated
    ? appendEllipsisToLastRichLine(lines, layer.width, measure)
    : lines;

  return { lines: displayLines, lineHeight };
};

const renderTextLayerSvg = (
  layer: TextLayer,
  index: number,
  idPrefix: string | undefined,
): { body: string; defs: string } => {
  const bundledFont = getBundledEditorFont(layer.fontFamily);
  const filterId = idPrefix
    ? createSvgId(idPrefix, "text", "filter", index)
    : createSvgId("text", "filter", index);
  const clipId = idPrefix
    ? createSvgId(idPrefix, "text", "clip", index)
    : createSvgId("text", "clip", index);
  const filterDef = renderTextEffectFilterSvg(layer, filterId);
  const filterAttribute = filterDef ? ` filter="url(#${filterId})"` : "";
  const clipBounds = isBubbleEnabled(layer)
    ? (() => {
        const bounds = getTextLayerRenderedBounds(layer);
        return {
          x: bounds.x - layer.x,
          y: bounds.y - layer.y,
          width: bounds.width,
          height: bounds.height,
        };
      })()
    : { x: 0, y: 0, width: layer.width, height: layer.height };
  const clipDef = `<clipPath id="${clipId}"><rect x="${clipBounds.x}" y="${clipBounds.y}" width="${clipBounds.width}" height="${clipBounds.height}" /></clipPath>`;
  const contentAttributes = `${filterAttribute} clip-path="url(#${clipId})"`;
  const background = renderTextBackgroundSvg(layer);
  const defs = `${clipDef}${filterDef}`;
  const { lines, lineHeight } = computeTextLayerLines(layer, bundledFont);

  if (isBubbleEnabled(layer)) {
    return {
      body: renderBubbleLetterTextLayerSvg(
        layer,
        bundledFont,
        lines,
        lineHeight,
        background,
        contentAttributes,
      ),
      defs,
    };
  }

  if (bundledFont) {
    return {
      body: renderBundledFontTextLayerSvg(
        layer,
        bundledFont,
        lines,
        lineHeight,
        background,
        contentAttributes,
      ),
      defs,
    };
  }

  const anchor = layer.align === "center" ? "middle" : layer.align === "right" ? "end" : "start";
  const x = layer.align === "center" ? layer.width / 2 : layer.align === "right" ? layer.width : 0;
  const strokeAttributes = textStrokeSvgAttributes(layer);

  const tspans = lines
    .map((line, lineIndex) => {
      const runs = line.length > 0 ? line : [{ text: "", bold: false, italic: false }];
      return runs
        .map((run, runIndex) => {
          const styleAttributes: string[] = [];
          if (runIndex === 0) {
            styleAttributes.push(`x="${x}"`, `dy="${lineIndex === 0 ? 0 : lineHeight}"`);
          }
          if (run.bold) styleAttributes.push('font-weight="bold"');
          if (run.italic) styleAttributes.push('font-style="italic"');
          const attributesString =
            styleAttributes.length > 0 ? ` ${styleAttributes.join(" ")}` : "";
          return `<tspan${attributesString}>${escapeXml(run.text)}</tspan>`;
        })
        .join("");
    })
    .join("");

  return {
    defs,
    body: `<g data-layer-id="${escapeXml(layer.id)}" data-font-family="${escapeXml(layer.fontFamily)}" opacity="${layer.opacity}" transform="${layerTransform(layer)}"><g data-layer-local-transform="true" transform="translate(${layer.x} ${layer.y})">${background}<g${contentAttributes}><text x="${x}" y="${layer.fontSize}" fill="${escapeXml(layer.color)}" font-family="${escapeXml(layer.fontFamily)}" font-size="${layer.fontSize}" text-anchor="${anchor}"${strokeAttributes}>${tspans}</text></g></g></g>`,
  };
};

const pathNumber = (value: number): string | null => {
  if (!Number.isFinite(value)) {
    return null;
  }

  const roundedValue = Math.round(value * 100) / 100;

  return String(Object.is(roundedValue, -0) ? 0 : roundedValue);
};

const pathCommandData = (command: PathCommand): string | null => {
  switch (command.type) {
    case "M":
    case "L": {
      const x = pathNumber(command.x);
      const y = pathNumber(command.y);

      return x && y ? `${command.type}${x} ${y}` : null;
    }
    case "C": {
      const x1 = pathNumber(command.x1);
      const y1 = pathNumber(command.y1);
      const x2 = pathNumber(command.x2);
      const y2 = pathNumber(command.y2);
      const x = pathNumber(command.x);
      const y = pathNumber(command.y);

      return x1 && y1 && x2 && y2 && x && y ? `C${x1} ${y1} ${x2} ${y2} ${x} ${y}` : null;
    }
    case "Q": {
      const x1 = pathNumber(command.x1);
      const y1 = pathNumber(command.y1);
      const x = pathNumber(command.x);
      const y = pathNumber(command.y);

      return x1 && y1 && x && y ? `Q${x1} ${y1} ${x} ${y}` : null;
    }
    case "Z":
      return "Z";
  }
};

const pathData = (path: Path): string =>
  path.commands
    .map(pathCommandData)
    .filter((commandData): commandData is string => commandData !== null)
    .join("");

const renderBundledFontTextLayerSvg = (
  layer: TextLayer,
  bundledFont: Font,
  lines: RichTextRun[][],
  lineHeight: number,
  background: string,
  contentAttributes: string,
): string => {
  const anchorX =
    layer.align === "center" ? layer.width / 2 : layer.align === "right" ? layer.width : 0;
  const strokeAttributes = textStrokeSvgAttributes(layer);
  const fauxBoldStrokeWidth = layer.fontSize * 0.06;
  const italicSkewDegrees = 12;
  const body = lines
    .map((line, lineIndex) => {
      if (line.length === 0) return "";
      const lineText = line.map((run) => run.text).join("");
      const totalAdvance = bundledFont.getAdvanceWidth(lineText, layer.fontSize);
      const lineStartX =
        layer.align === "center"
          ? anchorX - totalAdvance / 2
          : layer.align === "right"
            ? anchorX - totalAdvance
            : anchorX;
      const baselineY = layer.fontSize + lineIndex * lineHeight;

      let cursorX = lineStartX;
      const runFragments: string[] = [];
      for (const run of line) {
        if (run.text.length === 0) continue;
        const runAdvance = bundledFont.getAdvanceWidth(run.text, layer.fontSize);
        const runPaths = bundledFont
          .getPaths(run.text, 0, 0, layer.fontSize)
          .map(pathData)
          .filter((pathString) => pathString.length > 0)
          .map((pathString) => `<path d="${pathString}" />`)
          .join("");

        if (runPaths.length === 0) {
          cursorX += runAdvance;
          continue;
        }

        const transformParts = [`translate(${cursorX} ${baselineY})`];
        if (run.italic) {
          transformParts.push(`skewX(-${italicSkewDegrees})`);
        }
        const transform = transformParts.join(" ");
        const groupAttributes = run.bold
          ? ` stroke="${escapeXml(layer.color)}" stroke-width="${fauxBoldStrokeWidth}" stroke-linejoin="round" paint-order="stroke fill"`
          : "";
        runFragments.push(`<g transform="${transform}"${groupAttributes}>${runPaths}</g>`);
        cursorX += runAdvance;
      }
      return runFragments.join("");
    })
    .join("");

  return `<g data-layer-id="${escapeXml(layer.id)}" data-font-family="${escapeXml(layer.fontFamily)}" opacity="${layer.opacity}" transform="${layerTransform(layer)}"><g data-layer-local-transform="true" transform="translate(${layer.x} ${layer.y})">${background}<g fill="${escapeXml(layer.color)}"${strokeAttributes}${contentAttributes}>${body}</g></g></g>`;
};

const renderPhotoLayerSvg = (
  layer: PhotoLayer,
  href: string | null | undefined,
  index: number,
  idPrefix: string | undefined,
  showFullPhotoPreview: boolean,
): { body: string; defs: string } | null => {
  if (!href) {
    return null;
  }

  const clipId = idPrefix
    ? createSvgId(idPrefix, "photo", "clip", index)
    : createSvgId("photo", "clip", index);
  const frameClipId = idPrefix
    ? createSvgId(idPrefix, "photo", "frameclip", index)
    : createSvgId("photo", "frameclip", index);
  const shadowFilterId = idPrefix
    ? createSvgId(idPrefix, "photo", "shadow", index)
    : createSvgId("photo", "shadow", index);
  const colorFilterId = idPrefix
    ? createSvgId(idPrefix, "photo", "color", index)
    : createSvgId("photo", "color", index);
  const frameLayout = getPhotoFrameLayout(layer);
  const imageWidth = frameLayout.image.width / Math.max(layer.crop.width, 0.05);
  const imageHeight = frameLayout.image.height / Math.max(layer.crop.height, 0.05);
  const imageX =
    frameLayout.image.x -
    layer.crop.x * imageWidth +
    layer.photoTransform.offsetX * imageWidth * 0.5;
  const imageY =
    frameLayout.image.y -
    layer.crop.y * imageHeight +
    layer.photoTransform.offsetY * imageHeight * 0.5;
  const imageCenterX = frameLayout.image.x + frameLayout.image.width / 2;
  const imageCenterY = frameLayout.image.y + frameLayout.image.height / 2;
  const scaleX = layer.photoTransform.flipX
    ? -layer.photoTransform.scale
    : layer.photoTransform.scale;
  const scaleY = layer.photoTransform.flipY
    ? -layer.photoTransform.scale
    : layer.photoTransform.scale;
  const shadowFilter = renderPhotoShadowFilterSvg(layer, shadowFilterId);
  const shadowBody = renderPhotoShadowSvg(layer, frameLayout, shadowFilterId);
  const imageTransform = `translate(${imageCenterX} ${imageCenterY}) rotate(${layer.photoTransform.rotation}) scale(${scaleX} ${scaleY}) translate(${-imageCenterX} ${-imageCenterY})`;
  const preserveAspect = `xMidYMid ${layer.fit === "cover" ? "slice" : "meet"}`;
  const escapedHref = escapeXml(href);
  const colorFilter = renderPhotoColorFilterSvg(layer, colorFilterId);
  const colorFilterAttribute = colorFilter ? ` filter="url(#${colorFilterId})"` : "";
  const fullPhotoPreview = showFullPhotoPreview
    ? `<image data-photo-pan-preview="true" href="${escapedHref}" x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="${preserveAspect}" opacity="0.35" transform="${imageTransform}"${colorFilterAttribute} pointer-events="none" />`
    : "";

  const frameClipDef = photoFrameClipPath(layer, frameClipId, frameLayout.outer);
  const frameContent = `${renderPhotoFrameBackgroundSvg(layer, frameLayout)}${fullPhotoPreview}<g clip-path="url(#${clipId})"><image href="${escapedHref}" x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="${preserveAspect}" transform="${imageTransform}"${colorFilterAttribute} /></g>${renderPhotoFrameOverlaySvg(layer, frameLayout)}`;
  const maskedFrameContent = frameClipDef
    ? `<g data-photo-mask-clip="${layer.mask.shape}" clip-path="url(#${frameClipId})">${frameContent}</g>`
    : frameContent;

  return {
    defs: `${photoClipPath(layer, clipId, frameLayout.image)}${frameClipDef}${shadowFilter}${colorFilter}`,
    body: `<g opacity="${layer.opacity}" transform="${layerTransform(layer)}">${shadowBody}${maskedFrameContent}</g>`,
  };
};

const renderStickerLayerSvg = (
  layer: StickerLayer,
  stickerSvg: StickerSvg | null | undefined,
  stickerHref: string | null | undefined,
): string => {
  if (stickerHref) {
    return `<g opacity="${layer.opacity}" transform="${layerTransform(layer)}"><image x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" href="${escapeXml(stickerHref)}" preserveAspectRatio="xMidYMid meet" /></g>`;
  }

  if (!stickerSvg) {
    return `<g opacity="${layer.opacity}" transform="${layerTransform(layer)}"><rect x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" rx="${Math.min(layer.width, layer.height) * 0.08}" fill="#f7f3eb" stroke="#d8ddd8" stroke-width="6" stroke-dasharray="18 14" /></g>`;
  }

  return `<g opacity="${layer.opacity}" transform="${layerTransform(layer)}"><svg x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" viewBox="${escapeXml(stickerSvg.viewBox)}" preserveAspectRatio="xMidYMid meet">${stickerSvg.body}</svg></g>`;
};

const washiTapeOutlinePath = (layer: WashiTapeLayer): string => {
  switch (layer.outline) {
    case "straight":
      return `M ${layerPoint(layer, 0, 0)} L ${layerPoint(layer, 1, 0)} L ${layerPoint(layer, 1, 1)} L ${layerPoint(layer, 0, 1)} Z`;
    case "angled":
      return `M ${layerPolygon(layer, [
        [0.05, 0.05],
        [0.96, 0],
        [1, 0.08],
        [0.94, 0.95],
        [0.02, 1],
        [0, 0.9],
      ])} Z`;
    case "rounded":
      return layerPath(
        layer,
        "M 0.08,0.08 C 0.12,0.01 0.2,0 0.32,0.02 L 0.9,0.04 C 0.98,0.05 1,0.13 0.98,0.24 L 0.94,0.78 C 0.92,0.94 0.84,1 0.72,0.98 L 0.08,0.95 C 0,0.95 0,0.84 0.02,0.7 L 0.04,0.24 C 0.04,0.16 0.05,0.11 0.08,0.08 Z",
      );
    case "torn":
      return `M ${layerPolygon(layer, [
        [0, 0.08],
        [0.05, 0],
        [0.13, 0.06],
        [0.24, 0.01],
        [0.37, 0.08],
        [0.49, 0.02],
        [0.64, 0.07],
        [0.78, 0],
        [0.91, 0.05],
        [1, 0],
        [1, 0.92],
        [0.94, 1],
        [0.82, 0.94],
        [0.7, 0.99],
        [0.58, 0.93],
        [0.44, 1],
        [0.31, 0.95],
        [0.2, 0.99],
        [0.08, 0.93],
        [0, 1],
      ])} Z`;
    case "notched":
      return `M ${layerPolygon(layer, [
        [0.03, 0],
        [0.98, 0],
        [0.94, 1],
        [0.02, 1],
        [0.06, 0.58],
        [0.02, 0.5],
        [0.06, 0.42],
      ])} Z`;
    case "bracket":
      return layerPath(
        layer,
        "M 0.06,0.08 C 0.1,0.02 0.18,0 0.3,0.02 L 0.94,0.06 C 1,0.07 1,0.15 0.95,0.22 C 0.9,0.3 0.9,0.42 0.97,0.52 C 0.92,0.62 0.91,0.76 0.95,0.9 C 0.9,0.98 0.78,1 0.62,0.98 L 0.04,0.94 C 0,0.82 0,0.7 0.04,0.58 C 0.08,0.48 0.08,0.36 0.03,0.26 C 0.02,0.18 0.03,0.12 0.06,0.08 Z",
      );
    case "pinched":
      return layerPath(
        layer,
        "M 0,0.08 C 0.08,0.01 0.26,0.03 0.46,0.04 L 0.93,0 C 1,0.05 1,0.18 0.96,0.32 C 0.93,0.42 0.94,0.58 0.98,0.7 C 1,0.82 0.96,0.95 0.9,1 L 0.42,0.97 C 0.23,0.96 0.08,0.99 0,0.92 C 0.04,0.8 0.04,0.64 0,0.52 C 0.06,0.42 0.06,0.28 0,0.08 Z",
      );
    case "tapered":
      return `M ${layerPolygon(layer, [
        [0.08, 0.22],
        [0.96, 0],
        [1, 0.06],
        [0.98, 0.34],
        [0.93, 0.54],
        [1, 0.94],
        [0.94, 1],
        [0.06, 0.76],
        [0, 0.62],
        [0.04, 0.48],
      ])} Z`;
    case "scallop":
      return layerPath(
        layer,
        "M 0,0.12 Q 0.06,0 0.12,0.12 T 0.24,0.12 T 0.36,0.12 T 0.48,0.12 T 0.6,0.12 T 0.72,0.12 T 0.84,0.12 T 0.96,0.12 Q 1,0.06 1,0.14 L 1,0.86 Q 0.94,1 0.88,0.88 T 0.76,0.88 T 0.64,0.88 T 0.52,0.88 T 0.4,0.88 T 0.28,0.88 T 0.16,0.88 T 0.04,0.88 Q 0,0.94 0,0.86 Z",
      );
    case "stamp":
      return `M ${layerPolygon(layer, [
        [0.03, 0],
        [0.08, 0.05],
        [0.13, 0],
        [0.18, 0.05],
        [0.23, 0],
        [0.28, 0.05],
        [0.33, 0],
        [0.38, 0.05],
        [0.43, 0],
        [0.48, 0.05],
        [0.53, 0],
        [0.58, 0.05],
        [0.63, 0],
        [0.68, 0.05],
        [0.73, 0],
        [0.78, 0.05],
        [0.83, 0],
        [0.88, 0.05],
        [0.93, 0],
        [1, 0.06],
        [0.96, 0.5],
        [1, 0.94],
        [0.93, 1],
        [0.88, 0.95],
        [0.83, 1],
        [0.78, 0.95],
        [0.73, 1],
        [0.68, 0.95],
        [0.63, 1],
        [0.58, 0.95],
        [0.53, 1],
        [0.48, 0.95],
        [0.43, 1],
        [0.38, 0.95],
        [0.33, 1],
        [0.28, 0.95],
        [0.23, 1],
        [0.18, 0.95],
        [0.13, 1],
        [0.08, 0.95],
        [0.03, 1],
        [0, 0.94],
        [0.04, 0.5],
        [0, 0.06],
      ])} Z`;
    case "wave":
      return layerPath(
        layer,
        "M 0,0.2 C 0.12,0 0.2,0.34 0.32,0.16 S 0.54,0.02 0.66,0.18 S 0.88,0.28 1,0.1 L 1,0.82 C 0.88,1 0.8,0.66 0.68,0.84 S 0.46,0.98 0.34,0.82 S 0.12,0.72 0,0.9 Z",
      );
  }
};

const renderWashiTapeLayerSvg = (
  layer: WashiTapeLayer,
  href: string | null | undefined,
  index: number,
  idPrefix: string | undefined,
): { body: string; defs: string } | null => {
  if (layer.pattern.kind === "customPhoto" && !href) {
    return null;
  }

  const patternId = idPrefix
    ? createSvgId(idPrefix, "washi", "pattern", index)
    : createSvgId("washi", "pattern", index);
  const outline = washiTapeOutlinePath(layer);
  const tileBase = washiTapeTileBaseSize * layer.tile.scale;
  const tileWidth = roundSvgNumber(tileBase * layer.tile.scaleX);
  const tileHeight = roundSvgNumber(tileBase * layer.tile.scaleY);
  const shortestTileSide = Math.min(tileWidth, tileHeight);
  const patternX = roundSvgNumber(layer.x + layer.tile.offsetX * tileWidth);
  const patternY = roundSvgNumber(layer.y + layer.tile.offsetY * tileHeight);
  const patternCenterX = layer.x + layer.width / 2;
  const patternCenterY = layer.y + layer.height / 2;
  const primaryColor = escapeXml(layer.pattern.primaryColor);
  const secondaryColor = escapeXml(layer.pattern.secondaryColor);
  const patternBody = (() => {
    switch (layer.pattern.kind) {
      case "solid":
        return `<rect width="${tileWidth}" height="${tileHeight}" fill="${primaryColor}" />`;
      case "polkaDot": {
        const dotRadius = roundSvgNumber(shortestTileSide * 0.13);
        const dotCenters: Array<[number, number]> = [
          [0.25, 0.25],
          [0.75, 0.25],
          [0.25, 0.75],
          [0.75, 0.75],
        ];
        const dots = dotCenters
          .map(
            ([centerX, centerY]) =>
              `<circle cx="${roundSvgNumber(tileWidth * centerX)}" cy="${roundSvgNumber(tileHeight * centerY)}" r="${dotRadius}" fill="${secondaryColor}" />`,
          )
          .join("");

        return `<rect width="${tileWidth}" height="${tileHeight}" fill="${primaryColor}" />${dots}`;
      }
      case "stripe":
        return `<rect width="${tileWidth}" height="${tileHeight}" fill="${primaryColor}" /><rect y="${roundSvgNumber(tileHeight * 0.18)}" width="${tileWidth}" height="${roundSvgNumber(tileHeight * 0.18)}" fill="${secondaryColor}" /><rect y="${roundSvgNumber(tileHeight * 0.68)}" width="${tileWidth}" height="${roundSvgNumber(tileHeight * 0.18)}" fill="${secondaryColor}" />`;
      case "grid":
        return `<rect width="${tileWidth}" height="${tileHeight}" fill="${primaryColor}" /><path d="M ${roundSvgNumber(tileWidth * 0.5)} 0 V ${tileHeight} M 0 ${roundSvgNumber(tileHeight * 0.5)} H ${tileWidth}" stroke="${secondaryColor}" stroke-width="${Math.max(1, roundSvgNumber(shortestTileSide * 0.08))}" opacity="0.72" />`;
      case "checker":
        return `<rect width="${tileWidth}" height="${tileHeight}" fill="${primaryColor}" /><rect width="${roundSvgNumber(tileWidth * 0.5)}" height="${roundSvgNumber(tileHeight * 0.5)}" fill="${secondaryColor}" /><rect x="${roundSvgNumber(tileWidth * 0.5)}" y="${roundSvgNumber(tileHeight * 0.5)}" width="${roundSvgNumber(tileWidth * 0.5)}" height="${roundSvgNumber(tileHeight * 0.5)}" fill="${secondaryColor}" />`;
      case "customPhoto":
        return `<image href="${escapeXml(href ?? "")}" x="0" y="0" width="${tileWidth}" height="${tileHeight}" preserveAspectRatio="xMidYMid slice" />`;
    }
  })();

  return {
    defs: `<pattern id="${patternId}" patternUnits="userSpaceOnUse" x="${patternX}" y="${patternY}" width="${tileWidth}" height="${tileHeight}" patternTransform="rotate(${layer.tile.rotation} ${patternCenterX} ${patternCenterY})">${patternBody}</pattern>`,
    body: `<g data-layer-id="${escapeXml(layer.id)}" opacity="${layer.opacity}" transform="${layerTransform(layer)}"><path data-washi-outline="${layer.outline}" d="${outline}" fill="url(#${patternId})" /><path d="${outline}" fill="#ffffff" opacity="0.18" /><path d="${outline}" fill="none" stroke="#202426" stroke-opacity="0.14" stroke-width="${Math.max(1, layer.height * 0.025)}" /></g>`,
  };
};

export const renderPageDocumentSvg = (
  document: PageDocument,
  options: RenderPageSvgOptions = {},
): string => {
  const parsedDocument = pageDocumentSchema.parse(document);
  const defs: string[] = [];
  const bodies: string[] = [];

  for (const [index, layer] of parsedDocument.layers.entries()) {
    if (layer.kind === "photo") {
      const rendered = renderPhotoLayerSvg(
        layer,
        options.resolvePhotoHref?.(layer),
        index,
        options.idPrefix,
        options.panPreviewLayerIds?.has(layer.id) ?? false,
      );

      if (rendered) {
        defs.push(rendered.defs);
        bodies.push(rendered.body);
      }

      continue;
    }

    if (layer.kind === "washiTape") {
      const rendered = renderWashiTapeLayerSvg(
        layer,
        layer.pattern.kind === "customPhoto" ? options.resolveWashiTapeHref?.(layer) : undefined,
        index,
        options.idPrefix,
      );

      if (rendered) {
        defs.push(rendered.defs);
        bodies.push(rendered.body);
      }

      continue;
    }

    if (layer.kind === "text") {
      const rendered = renderTextLayerSvg(layer, index, options.idPrefix);

      if (rendered.defs) {
        defs.push(rendered.defs);
      }

      bodies.push(rendered.body);
      continue;
    }

    bodies.push(
      renderStickerLayerSvg(
        layer,
        options.resolveStickerSvg?.(layer),
        options.resolveStickerHref?.(layer),
      ),
    );
  }

  const background =
    options.includeBackground === false
      ? ""
      : `<rect width="100%" height="100%" fill="${escapeXml(parsedDocument.canvas.backgroundColor)}" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${parsedDocument.canvas.width}" height="${parsedDocument.canvas.height}" viewBox="0 0 ${parsedDocument.canvas.width} ${parsedDocument.canvas.height}"><defs>${defs.join("")}</defs>${background}${bodies.join("")}</svg>`;
};

export const createPageDocument = (input: CreatePageDocumentInput = {}): PageDocument =>
  pageDocumentSchema.parse({
    version: 1,
    canvas: {
      width: input.canvas?.width ?? 2400,
      height: input.canvas?.height ?? 3000,
      backgroundColor: input.canvas?.backgroundColor ?? "#fffdf7",
    },
    layers: input.layers ?? [],
  });

export const createPhotoLayer = (input: CreatePhotoLayerInput): PhotoLayer =>
  photoLayerSchema.parse({
    id: input.id ?? createLayerId(),
    kind: "photo",
    assetId: input.assetId,
    x: input.x ?? 240,
    y: input.y ?? 240,
    width: input.width ?? 960,
    height: input.height ?? 720,
    rotation: input.rotation ?? 0,
    opacity: input.opacity ?? 1,
    locked: input.locked ?? false,
    fit: input.fit ?? "cover",
    photoTransform: input.photoTransform ?? defaultPhotoTransform,
    crop: input.crop ?? defaultPhotoCrop,
    border: input.border ?? defaultPhotoBorder,
    shadow: input.shadow ?? defaultPhotoShadow,
    mask: input.mask ?? defaultPhotoMask,
    filter: input.filter ?? defaultPhotoFilter,
  });

export const createTextLayer = (input: CreateTextLayerInput): TextLayer =>
  textLayerSchema.parse({
    id: input.id ?? createLayerId(),
    kind: "text",
    text: input.text,
    x: input.x ?? 240,
    y: input.y ?? 1080,
    width: input.width ?? 960,
    height: input.height ?? 180,
    rotation: input.rotation ?? 0,
    opacity: input.opacity ?? 1,
    locked: input.locked ?? false,
    fontFamily: input.fontFamily ?? defaultTextFontFamily,
    fontSize: input.fontSize ?? 72,
    color: input.color ?? "#202426",
    align: input.align ?? "left",
    stroke: input.stroke ?? defaultTextStroke,
    shadow: input.shadow ?? defaultTextShadow,
    glow: input.glow ?? defaultTextGlow,
    background: input.background ?? defaultTextBackground,
    bubble: input.bubble ?? defaultTextBubble,
  });

export const createStickerLayer = (input: CreateStickerLayerInput = {}): StickerLayer =>
  stickerLayerSchema.parse({
    id: input.id ?? createLayerId(),
    kind: "sticker",
    x: input.x ?? 360,
    y: input.y ?? 360,
    width: input.width ?? 360,
    height: input.height ?? 360,
    rotation: input.rotation ?? 0,
    opacity: input.opacity ?? 1,
    locked: input.locked ?? false,
    stickerId: input.stickerId ?? "noto:red-heart",
  });

export const createWashiTapeLayer = (input: CreateWashiTapeLayerInput): WashiTapeLayer =>
  washiTapeLayerSchema.parse({
    id: input.id ?? createLayerId(),
    kind: "washiTape",
    assetId: input.assetId,
    x: input.x ?? 240,
    y: input.y ?? 240,
    width: input.width ?? 960,
    height: input.height ?? 180,
    rotation: input.rotation ?? -3,
    opacity: input.opacity ?? 0.86,
    locked: input.locked ?? false,
    outline: input.outline ?? "torn",
    pattern:
      input.pattern ??
      (input.assetId
        ? { ...legacyPhotoWashiTapePattern, assetId: input.assetId }
        : defaultWashiTapePattern),
    tile: input.tile ? { ...defaultWashiTapeTile, ...input.tile } : defaultWashiTapeTile,
  });

export const resetPhotoLayerEdits = (layer: PhotoLayer): PhotoLayer =>
  photoLayerSchema.parse({
    ...layer,
    fit: "cover",
    photoTransform: defaultPhotoTransform,
    crop: defaultPhotoCrop,
    border: defaultPhotoBorder,
    shadow: defaultPhotoShadow,
    mask: defaultPhotoMask,
    filter: defaultPhotoFilter,
  });

export const addLayer = (
  document: PageDocument,
  layer: PageLayer,
  insertIndex = document.layers.length,
): PageDocument => {
  const parsedDocument = parseDocument(document);
  const parsedLayer = pageLayerSchema.parse(layer);
  const nextLayers = [...parsedDocument.layers];
  const boundedIndex = Math.max(0, Math.min(insertIndex, nextLayers.length));

  nextLayers.splice(boundedIndex, 0, parsedLayer);

  return parseDocument({ ...parsedDocument, layers: nextLayers });
};

export const updateLayer = (
  document: PageDocument,
  layerId: string,
  update: Partial<PageLayer>,
): PageDocument => {
  const parsedDocument = parseDocument(document);
  const nextLayers = parsedDocument.layers.map((layer) =>
    layer.id === layerId ? pageLayerSchema.parse({ ...layer, ...update, id: layer.id }) : layer,
  );

  return parseDocument({ ...parsedDocument, layers: nextLayers });
};

export const deleteLayer = (document: PageDocument, layerId: string): PageDocument => {
  const parsedDocument = parseDocument(document);

  return parseDocument({
    ...parsedDocument,
    layers: parsedDocument.layers.filter((layer) => layer.id !== layerId),
  });
};

export const reorderLayer = (
  document: PageDocument,
  layerId: string,
  toIndex: number,
): PageDocument => {
  const parsedDocument = parseDocument(document);
  const fromIndex = parsedDocument.layers.findIndex((layer) => layer.id === layerId);

  if (fromIndex === -1) {
    return parsedDocument;
  }

  const nextLayers = [...parsedDocument.layers];
  const [layer] = nextLayers.splice(fromIndex, 1);

  if (!layer) {
    return parsedDocument;
  }

  const boundedIndex = Math.max(0, Math.min(toIndex, nextLayers.length));
  nextLayers.splice(boundedIndex, 0, layer);

  return parseDocument({ ...parsedDocument, layers: nextLayers });
};

export const duplicateLayer = (
  document: PageDocument,
  layerId: string,
  newLayerId = createLayerId(),
): PageDocument => {
  const parsedDocument = parseDocument(document);
  const layerIndex = parsedDocument.layers.findIndex((layer) => layer.id === layerId);
  const layer = parsedDocument.layers[layerIndex];

  if (!layer) {
    return parsedDocument;
  }

  const duplicate = pageLayerSchema.parse({
    ...layer,
    id: newLayerId,
    x: layer.x + 80,
    y: layer.y + 80,
  });

  return addLayer(parsedDocument, duplicate, layerIndex + 1);
};

export const updateCanvas = (
  document: PageDocument,
  canvas: Partial<PageDocument["canvas"]>,
): PageDocument => {
  const parsedDocument = parseDocument(document);

  return parseDocument({
    ...parsedDocument,
    canvas: { ...parsedDocument.canvas, ...canvas },
  });
};

export const getTextLayerRenderedBounds = (
  layer: TextLayer,
): { x: number; y: number; width: number; height: number } => {
  if (!isBubbleEnabled(layer)) {
    return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  }

  const bundledFont = getBundledEditorFont(layer.fontFamily);
  const { lines, lineHeight } = computeTextLayerLines(layer, bundledFont);
  const metrics = bubbleLayoutMetrics(layer);

  const renderedLines: { width: number; startX: number }[] = [];
  for (const line of lines) {
    if (!line || line.length === 0) continue;
    let width = 0;
    for (const run of line) {
      for (const character of run.text) {
        width += character.trim().length === 0 ? metrics.spaceWidth : metrics.cellWidth;
      }
    }
    if (width === 0) continue;
    const startX =
      layer.align === "center"
        ? layer.width / 2 - width / 2
        : layer.align === "right"
          ? layer.width - width
          : 0;
    renderedLines.push({ width, startX });
  }

  if (renderedLines.length === 0) {
    return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  }

  let leftLocal = Number.POSITIVE_INFINITY;
  let rightLocal = Number.NEGATIVE_INFINITY;
  for (const { width, startX } of renderedLines) {
    if (startX < leftLocal) leftLocal = startX;
    if (startX + width > rightLocal) rightLocal = startX + width;
  }
  const topLocal = layer.fontSize * 0.1 - Math.max(0, layer.bubble.padding);
  const bottomLocal = renderedLines.length * lineHeight + Math.max(0, layer.bubble.padding);

  const left = Math.min(0, leftLocal);
  const right = Math.max(layer.width, rightLocal);
  const top = Math.min(0, topLocal);
  const bottom = Math.max(layer.height, bottomLocal);

  return {
    x: layer.x + left,
    y: layer.y + top,
    width: right - left,
    height: bottom - top,
  };
};

export const resizePageDocument = (
  document: PageDocument,
  canvas: Pick<PageDocument["canvas"], "height" | "width">,
): PageDocument => {
  const parsedDocument = parseDocument(document);
  const scaleX = canvas.width / parsedDocument.canvas.width;
  const scaleY = canvas.height / parsedDocument.canvas.height;
  const textScale = Math.min(scaleX, scaleY);

  return parseDocument({
    ...parsedDocument,
    canvas: { ...parsedDocument.canvas, ...canvas },
    layers: parsedDocument.layers.map((layer) =>
      pageLayerSchema.parse({
        ...layer,
        x: layer.x * scaleX,
        y: layer.y * scaleY,
        width: layer.width * scaleX,
        height: layer.height * scaleY,
        ...(layer.kind === "text"
          ? {
              fontSize: layer.fontSize * textScale,
              stroke: { ...layer.stroke, width: layer.stroke.width * textScale },
              shadow: {
                ...layer.shadow,
                offsetX: layer.shadow.offsetX * scaleX,
                offsetY: layer.shadow.offsetY * scaleY,
                blur: layer.shadow.blur * textScale,
              },
              glow: { ...layer.glow, blur: layer.glow.blur * textScale },
              background: {
                ...layer.background,
                padding: layer.background.padding * textScale,
                radius: layer.background.radius * textScale,
              },
              bubble: {
                ...layer.bubble,
                padding: layer.bubble.padding * textScale,
                spacing: layer.bubble.spacing * textScale,
              },
            }
          : {}),
        ...(layer.kind === "photo"
          ? {
              shadow: {
                ...layer.shadow,
                offsetX: layer.shadow.offsetX * scaleX,
                offsetY: layer.shadow.offsetY * scaleY,
                blur: layer.shadow.blur * textScale,
                spread: layer.shadow.spread * textScale,
              },
            }
          : {}),
      }),
    ),
  });
};

const createSingleBookSpread = (page: OrderedBookPage, spreadIndex: number): BookSpread => ({
  spreadIndex,
  kind: "single",
  leftPageId: page.pageId,
  rightPageId: null,
  pageIds: [page.pageId],
});

const createSequentialBookSpreads = (
  pages: OrderedBookPage[],
  startingSpreadIndex: number,
): BookSpread[] =>
  pages.reduce<BookSpread[]>((spreads, page, index) => {
    const spreadIndex = startingSpreadIndex + Math.floor(index / 2);
    const isLeftPage = index % 2 === 0;

    if (isLeftPage) {
      spreads.push(createSingleBookSpread(page, spreadIndex));

      return spreads;
    }

    const spread = spreads[spreads.length - 1];

    if (!spread) {
      return spreads;
    }

    spread.kind = "facing";
    spread.rightPageId = page.pageId;
    spread.pageIds = [spread.leftPageId, page.pageId].filter((pageId): pageId is string =>
      Boolean(pageId),
    );

    return spreads;
  }, []);

export const createBookSpreads = (
  pages: OrderedBookPage[],
  options: CreateBookSpreadsOptions = {},
): BookSpread[] => {
  const sortedPages = [...pages].sort((first, second) => first.sortOrder - second.sortOrder);

  if (sortedPages.length <= 1) {
    return createSequentialBookSpreads(sortedPages, 0);
  }

  const frontCover = sortedPages[0];
  const backCover = sortedPages[sortedPages.length - 1];
  const interiorPages = sortedPages.slice(1, -1);

  if (!frontCover || !backCover) {
    return [];
  }

  if (options.coverSpreadEnabled ?? true) {
    return [
      {
        spreadIndex: 0,
        kind: "facing",
        leftPageId: frontCover.pageId,
        rightPageId: backCover.pageId,
        pageIds: [frontCover.pageId, backCover.pageId],
      },
      ...createSequentialBookSpreads(interiorPages, 1),
    ];
  }

  return [
    createSingleBookSpread(frontCover, 0),
    ...createSequentialBookSpreads(interiorPages, 1),
    createSingleBookSpread(backCover, Math.ceil(interiorPages.length / 2) + 1),
  ];
};
