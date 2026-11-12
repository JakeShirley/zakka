import {
  createPageDocument,
  createPhotoLayer,
  createStickerLayer,
  createTextLayer,
  type PageDocument,
  type PageLayer,
  type StickerId,
} from "@zakka/editor-core";

import {
  readMetadataValue,
  type ShutterflyLayeredItem,
  type ShutterflyProject,
  type ShutterflySurface,
} from "./schemas.js";

export type ShutterflyPhotoReference = { mediaId: string; imageId: string };

export type ShutterflyProjectReferences = {
  photos: ShutterflyPhotoReference[];
  fontAssetIds: string[];
  stickerAssetIds: string[];
  backgroundAssetIds: string[];
};

export type ShutterflyResolvedBackground =
  | { kind: "color"; color: string }
  | { kind: "image"; assetId: string };

export type ShutterflyMappingResolvers = {
  /** Returns the Zakka asset id for a Shutterfly photo, or null if it could not be imported. */
  photoAssetId: (mediaId: string) => string | null;
  /** Returns a `custom:` sticker id for a Shutterfly embellishment design asset. */
  stickerId: (designAssetId: string) => StickerId | null;
  /** Resolves a Shutterfly background design asset to a flat color or an imported Zakka asset. */
  background: (designAssetId: string) => ShutterflyResolvedBackground | null;
  /** Returns the Zakka font family to use for a Shutterfly font design asset. */
  fontFamily: (designAssetId: string | null) => { family: string; matched: boolean };
};

export type MappedBookPage = { title: string; document: PageDocument };

export type MappedShutterflyBook = {
  title: string;
  pageWidth: number;
  pageHeight: number;
  pages: MappedBookPage[];
  warnings: string[];
};

type Rect = { x: number; y: number; w: number; h: number; rot: number };
type SurfaceTransform = { scale: number; offsetX: number; offsetY: number };
type PagePlacement = { pageIndex: number; transform: SurfaceTransform; layerIdSuffix: string };

type PageDraft = {
  title: string;
  backgroundColor: string | null;
  backgroundCoversCenter: boolean;
  layers: PageLayer[];
  layerIds: Set<string>;
};

const defaultBackgroundColor = "#ffffff";
const minZakkaFontSize = 6;
const maxZakkaFontSize = 240;
const maxLayersPerPage = 200;
// Matches the text background padding limit in the editor-core text layer schema.
const maxZakkaTextBackgroundPadding = 120;
const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const numberValue = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;

  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

const normalizeRotation = (rotation: number): number => {
  const normalized = rotation % 360;

  return normalized > 180 ? normalized - 360 : normalized < -180 ? normalized + 360 : normalized;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const readImageId = (assetRef: string | null): string | null => {
  if (!assetRef) {
    return null;
  }

  return new URLSearchParams(assetRef).get("imageID");
};

const surfaceType = (surface: ShutterflySurface): string | null =>
  stringValue(readMetadataValue(surface.surfaceMetadata, "renderingSurfaceType"));

const itemParentSurfaceType = (item: ShutterflyLayeredItem): string | null =>
  stringValue(readMetadataValue(item.layerMetadata, "parentSurfaceType"));

const surfaceNumber = (surface: ShutterflySurface): number | null => {
  const parsed = Number(surface.surfaceNumber);

  return Number.isInteger(parsed) ? parsed : null;
};

const getCategorySurfaces = (project: ShutterflyProject, categoryName: string) =>
  project.surfaceCategories.find((category) => category.categoryName === categoryName)?.surfaces ??
  [];

const isSpreadSurface = (surface: ShutterflySurface, pageWidth: number): boolean =>
  surfaceType(surface) === "spread" || surface.surfaceData.pageDetails.width > pageWidth * 1.5;

const userDataString = (item: ShutterflyLayeredItem, key: string): string | null =>
  stringValue(item.content.userData[key]);

/** Reads the fill Shutterfly draws across the whole text box, if any. */
const textBackground = (item: ShutterflyLayeredItem): { color: string; opacity: number } | null => {
  const color = userDataString(item, "backgroundColor");

  if (!color || !hexColorPattern.test(color)) {
    return null;
  }

  const opacity =
    numberValue(item.content.userData.backgroundOpacity) ??
    numberValue(item.content.userData.backgroundColorOpacity) ??
    1;

  return opacity > 0 ? { color: color.toLowerCase(), opacity: clamp(opacity, 0, 1) } : null;
};

const photoMediaId = (item: ShutterflyLayeredItem): string | null =>
  userDataString(item, "mediaId");

const itemText = (item: ShutterflyLayeredItem): string => {
  const fullText = item.content.userData.fullText;

  if (typeof fullText === "string" && fullText.trim().length > 0) {
    return fullText.replace(/\r\n?/g, "\n");
  }

  const lines = item.content.userData.linesOfText;

  if (!Array.isArray(lines)) {
    return "";
  }

  return lines
    .map((line) =>
      typeof line === "object" &&
      line !== null &&
      typeof (line as { text?: unknown }).text === "string"
        ? (line as { text: string }).text
        : "",
    )
    .join("\n")
    .trim();
};

/** Lists the photos and design assets that must be resolved before a project can be mapped. */
export const collectShutterflyProjectReferences = (
  project: ShutterflyProject,
): ShutterflyProjectReferences => {
  const photos = new Map<string, ShutterflyPhotoReference>();
  const fontAssetIds = new Set<string>();
  const stickerAssetIds = new Set<string>();
  const backgroundAssetIds = new Set<string>();
  const photoWellImageIds = new Map(
    project.photoWell.map((entry) => [entry.id, readImageId(entry.assetRef ?? null)]),
  );

  for (const category of project.surfaceCategories) {
    if (category.categoryName === "logo") {
      continue;
    }

    for (const surface of category.surfaces) {
      for (const item of surface.surfaceData.layeredItems) {
        const assetId = userDataString(item, "assetId");

        if (item.type === "photo") {
          const mediaId = photoMediaId(item);
          const imageId = readImageId(assetId) ?? (mediaId ? photoWellImageIds.get(mediaId) : null);

          if (mediaId && imageId) {
            photos.set(mediaId, { mediaId, imageId });
          }
        } else if (item.type === "text" && assetId && itemText(item)) {
          fontAssetIds.add(assetId);
        } else if (item.type === "embellishment" && assetId) {
          stickerAssetIds.add(assetId);
        } else if (
          item.type === "background" &&
          item.content.contentType !== "SolidColor" &&
          assetId
        ) {
          backgroundAssetIds.add(assetId);
        }
      }
    }
  }

  return {
    photos: [...photos.values()],
    fontAssetIds: [...fontAssetIds],
    stickerAssetIds: [...stickerAssetIds],
    backgroundAssetIds: [...backgroundAssetIds],
  };
};

const applyTransform = (rect: Rect, transform: SurfaceTransform): Rect => ({
  x: rect.x * transform.scale + transform.offsetX,
  y: rect.y * transform.scale + transform.offsetY,
  w: rect.w * transform.scale,
  h: rect.h * transform.scale,
  rot: rect.rot,
});

/** Checks the layer's bounds after rotation about its center, as editor-core renders it. */
const overlapsPage = (rect: Rect, pageWidth: number, pageHeight: number): boolean => {
  if (rect.w <= 0 || rect.h <= 0) {
    return false;
  }

  const radians = (rect.rot * Math.PI) / 180;
  const halfWidth =
    (Math.abs(rect.w * Math.cos(radians)) + Math.abs(rect.h * Math.sin(radians))) / 2;
  const halfHeight =
    (Math.abs(rect.w * Math.sin(radians)) + Math.abs(rect.h * Math.cos(radians))) / 2;
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;

  return (
    centerX - halfWidth < pageWidth &&
    centerX + halfWidth > 0 &&
    centerY - halfHeight < pageHeight &&
    centerY + halfHeight > 0
  );
};

const maxZakkaTextLength = 2000;
const markdownSyntaxPattern = /[\\`*_[\]<>!~#|]/g;

/** Shutterfly text is plain; escape characters Zakka's Markdown renderer would treat as formatting. */
export const escapeShutterflyText = (text: string): { text: string; truncated: boolean } => {
  let escaped = "";

  for (const character of text) {
    const next = character.replace(markdownSyntaxPattern, "\\$&");

    if (escaped.length + next.length > maxZakkaTextLength) {
      return { text: escaped, truncated: true };
    }

    escaped += next;
  }

  return { text: escaped, truncated: false };
};

const coversPageCenter = (rect: Rect, pageWidth: number, pageHeight: number): boolean =>
  rect.x <= pageWidth / 2 &&
  rect.x + rect.w >= pageWidth / 2 &&
  rect.y <= pageHeight / 2 &&
  rect.y + rect.h >= pageHeight / 2;

const photoCrop = (frame: Rect, item: ShutterflyLayeredItem) => {
  const image = {
    x: numberValue(item.content.userData.x),
    y: numberValue(item.content.userData.y),
    w: numberValue(item.content.userData.w),
    h: numberValue(item.content.userData.h),
  };

  if (
    image.x === null ||
    image.y === null ||
    !image.w ||
    !image.h ||
    image.w <= 0 ||
    image.h <= 0
  ) {
    return undefined;
  }

  // Shutterfly stores the full image rectangle in surface coordinates; Zakka stores the visible
  // fraction of the image. Both are independent of the surface-to-page transform.
  const width = clamp(frame.w / image.w, 0.05, 1);
  const height = clamp(frame.h / image.h, 0.05, 1);

  return {
    x: clamp((frame.x - image.x) / image.w, 0, 1 - width),
    y: clamp((frame.y - image.y) / image.h, 0, 1 - height),
    width,
    height,
    aspectRatioPreset: "free" as const,
  };
};

const alignmentFromAnchor = (anchor: unknown): "left" | "center" | "right" => {
  const value = String(anchor ?? "");

  if (["1", "4", "7"].includes(value)) {
    return "left";
  }

  if (["3", "6", "9"].includes(value)) {
    return "right";
  }

  return "center";
};

const firstLineBaseline = (item: ShutterflyLayeredItem): number | null => {
  const lines = item.content.userData.linesOfText;

  if (!Array.isArray(lines) || lines.length === 0) {
    return null;
  }

  const firstLine = lines[0] as { y?: unknown };

  return numberValue(firstLine?.y);
};

type MapContext = {
  pageWidth: number;
  pageHeight: number;
  pages: PageDraft[];
  resolvers: ShutterflyMappingResolvers;
  warnings: Map<string, Set<string>>;
};

/** Records a warning once per source element, even when a spread element lands on two pages. */
const warn = (context: MapContext, message: string, elementKey: string) => {
  const elements = context.warnings.get(message) ?? new Set<string>();
  elements.add(elementKey);
  context.warnings.set(message, elements);
};

const pushLayer = (context: MapContext, page: PageDraft, layer: PageLayer) => {
  if (page.layerIds.has(layer.id)) {
    return;
  }

  if (page.layers.length >= maxLayersPerPage) {
    warn(
      context,
      `Skipped elements beyond the ${maxLayersPerPage}-layer limit on "${page.title}"`,
      layer.id,
    );
    return;
  }

  page.layerIds.add(layer.id);
  page.layers.push(layer);
};

const mapItemToPlacement = (
  context: MapContext,
  item: ShutterflyLayeredItem,
  itemKey: string,
  surface: ShutterflySurface,
  placement: PagePlacement,
) => {
  const page = context.pages[placement.pageIndex];

  if (!page) {
    return;
  }

  const sourceRect: Rect = { ...item.container };
  const layerId = `sfly_${itemKey}${placement.layerIdSuffix}`;
  const assetId = userDataString(item, "assetId");
  const rect = applyTransform(sourceRect, placement.transform);

  if (!overlapsPage(rect, context.pageWidth, context.pageHeight)) {
    return;
  }

  const common = {
    id: layerId,
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
    rotation: normalizeRotation(rect.rot),
  };

  switch (item.type) {
    case "background": {
      const setBackgroundColor = (fill: string | null) => {
        if (
          fill &&
          hexColorPattern.test(fill) &&
          (!page.backgroundCoversCenter || page.backgroundColor === null)
        ) {
          page.backgroundColor = fill.toLowerCase();
          page.backgroundCoversCenter = coversPageCenter(
            rect,
            context.pageWidth,
            context.pageHeight,
          );
        }
      };

      if (item.content.contentType === "SolidColor") {
        setBackgroundColor(userDataString(item, "fill"));
        return;
      }

      const background = assetId ? context.resolvers.background(assetId) : null;

      if (!background) {
        warn(context, "Skipped backgrounds that could not be downloaded", itemKey);
        return;
      }

      if (background.kind === "color") {
        setBackgroundColor(background.color);
        return;
      }

      const crop = photoCrop(sourceRect, item);
      const backgroundLayer = createPhotoLayer({
        ...common,
        assetId: background.assetId,
        locked: true,
        ...(crop ? { crop } : {}),
      });
      page.layerIds.add(layerId);
      page.layers.unshift(backgroundLayer);
      return;
    }

    case "photo": {
      const mediaId = photoMediaId(item);

      if (!mediaId) {
        return;
      }

      const zakkaAssetId = context.resolvers.photoAssetId(mediaId);

      if (!zakkaAssetId) {
        warn(context, "Skipped photos that could not be downloaded", itemKey);
        return;
      }

      const borderUserData = item.border?.userData ?? {};
      const borderWidth =
        item.border?.contentType === "SolidColorBorder"
          ? (numberValue(borderUserData.borderWidthPixels) ?? 0)
          : 0;
      const borderColor = stringValue(borderUserData.borderColor);
      // Shutterfly borders straddle the frame edge by `borderOverlap`; Zakka draws borders inside the layer.
      const borderOutset =
        borderWidth > 0
          ? Math.max(0, borderWidth - (numberValue(borderUserData.borderOverlap) ?? 0))
          : 0;
      const frameRect = applyTransform(
        {
          ...sourceRect,
          x: sourceRect.x - borderOutset,
          y: sourceRect.y - borderOutset,
          w: sourceRect.w + borderOutset * 2,
          h: sourceRect.h + borderOutset * 2,
        },
        placement.transform,
      );
      const crop = photoCrop(sourceRect, item);

      pushLayer(
        context,
        page,
        createPhotoLayer({
          ...common,
          x: frameRect.x,
          y: frameRect.y,
          width: frameRect.w,
          height: frameRect.h,
          assetId: zakkaAssetId,
          fit: "cover",
          ...(crop ? { crop } : {}),
          ...(borderWidth > 0 && borderColor && hexColorPattern.test(borderColor)
            ? {
                border: {
                  width: clamp(borderWidth * placement.transform.scale, 0, 160),
                  color: borderColor.toLowerCase(),
                  radius: 0,
                  style: "solid" as const,
                  framePreset: "none" as const,
                },
              }
            : {}),
        }),
      );
      return;
    }

    case "text": {
      const text = itemText(item);

      if (!text) {
        return;
      }

      if (item.textBoxType === "SpineText") {
        warn(context, "Skipped spine text because Zakka books have no spine", itemKey);
        return;
      }

      const dpi = surface.surfaceData.pageDetails.dpi || 300;
      const pointSize = numberValue(item.content.userData.fontSize) ?? 18;
      const sourceFontPixels = (pointSize * dpi) / 72;
      const scaledFontSize = sourceFontPixels * placement.transform.scale;
      const fontSize = clamp(scaledFontSize, minZakkaFontSize, maxZakkaFontSize);

      if (fontSize !== scaledFontSize) {
        warn(context, "Resized text that was outside Zakka's supported font sizes", itemKey);
      }

      const font = context.resolvers.fontFamily(assetId);

      if (!font.matched) {
        warn(
          context,
          "Replaced Shutterfly fonts that have no Zakka equivalent with the default font",
          itemKey,
        );
      }

      // Zakka places the first baseline at `y + fontSize`; Shutterfly records the baseline inside the box.
      const baseline = firstLineBaseline(item);
      const topInset =
        baseline === null
          ? 0
          : clamp(baseline - sourceFontPixels, 0, sourceRect.h) * placement.transform.scale;
      const color = userDataString(item, "fontColor");
      const escapedText = escapeShutterflyText(text);

      if (escapedText.truncated) {
        warn(
          context,
          `Shortened text longer than Zakka's ${maxZakkaTextLength}-character limit`,
          itemKey,
        );
      }

      const background = textBackground(item);
      // Zakka pads a text background evenly on every side. Padding by the top inset puts the
      // background's top edge on Shutterfly's box without shrinking the text area, so the
      // fill can extend slightly past Shutterfly's box on the other sides.
      const backgroundPadding = background ? Math.min(topInset, maxZakkaTextBackgroundPadding) : 0;

      pushLayer(
        context,
        page,
        createTextLayer({
          ...common,
          y: rect.y + topInset,
          height: Math.max(rect.h - topInset, fontSize * 1.2),
          text: escapedText.text,
          fontFamily: font.family,
          fontSize,
          color: color && hexColorPattern.test(color) ? color.toLowerCase() : "#000000",
          align: alignmentFromAnchor(item.content.userData.alignmentAnchor),
          ...(background
            ? {
                background: {
                  enabled: true,
                  color: background.color,
                  opacity: background.opacity,
                  padding: backgroundPadding,
                  radius: 0,
                },
              }
            : {}),
        }),
      );
      return;
    }

    case "embellishment": {
      const stickerId = assetId ? context.resolvers.stickerId(assetId) : null;

      if (!stickerId) {
        warn(context, "Skipped stickers that could not be downloaded", itemKey);
        return;
      }

      pushLayer(context, page, createStickerLayer({ ...common, stickerId }));
      return;
    }

    case "logo":
      return;

    default:
      warn(context, `Skipped unsupported "${item.type}" elements`, itemKey);
  }
};

const mapSurface = (
  context: MapContext,
  surface: ShutterflySurface,
  surfaceKey: string,
  placements: PagePlacement[],
  includeItem: (item: ShutterflyLayeredItem, placement: PagePlacement) => boolean = () => true,
) => {
  for (const [itemIndex, item] of surface.surfaceData.layeredItems.entries()) {
    for (const placement of placements) {
      if (includeItem(item, placement)) {
        mapItemToPlacement(context, item, `${surfaceKey}_${itemIndex}`, surface, placement);
      }
    }
  }
};

const singlePageSize = (
  insideSurfaces: ShutterflySurface[],
): { width: number; height: number } | null => {
  const single = insideSurfaces.find((surface) => surfaceType(surface) !== "spread");
  const reference = single ?? insideSurfaces[0];

  if (!reference) {
    return null;
  }

  const { width, height } = reference.surfaceData.pageDetails;

  return single ? { width, height } : { width: width / 2, height };
};

const coverRegions = (cover: ShutterflySurface) => {
  const regions = new Map<string, Rect>();

  for (const item of cover.surfaceData.layeredItems) {
    const parent = itemParentSurfaceType(item);

    if (item.type === "background" && parent && !regions.has(parent)) {
      regions.set(parent, { ...item.container });
    }
  }

  const { width, height } = cover.surfaceData.pageDetails;

  return {
    back: regions.get("back") ?? { x: 0, y: 0, w: width / 2, h: height, rot: 0 },
    front: regions.get("front") ?? { x: width / 2, y: 0, w: width / 2, h: height, rot: 0 },
  };
};

const centeredRegionTransform = (
  region: Rect,
  pageWidth: number,
  pageHeight: number,
): SurfaceTransform => {
  const scale = Math.max(1, pageWidth / region.w, pageHeight / region.h);

  return {
    scale,
    offsetX: pageWidth / 2 - (region.x + region.w / 2) * scale,
    offsetY: pageHeight / 2 - (region.y + region.h / 2) * scale,
  };
};

/**
 * Maps covers stored as separate front, spine, and back surfaces (non-layflat hardcovers).
 * Each surface includes the board wrap, so it is center-cropped to the page size.
 */
const mapSeparateCoverSurfaces = (
  context: MapContext,
  surfaces: ShutterflySurface[],
  backCoverIndex: number,
) => {
  const front =
    surfaces.find((surface) => surfaceType(surface) === "right") ??
    surfaces.find((surface) => surfaceNumber(surface) === 0);
  const back =
    surfaces.find((surface) => surfaceType(surface) === "left") ??
    surfaces.find((surface) => surfaceNumber(surface) === 2);

  for (const [surface, pageIndex, suffix] of [
    [front, 0, "front"],
    [back, backCoverIndex, "back"],
  ] as const) {
    if (!surface) {
      continue;
    }

    const { width, height } = surface.surfaceData.pageDetails;

    mapSurface(context, surface, `cover_${suffix}`, [
      {
        pageIndex,
        transform: centeredRegionTransform(
          { x: 0, y: 0, w: width, h: height, rot: 0 },
          context.pageWidth,
          context.pageHeight,
        ),
        layerIdSuffix: "",
      },
    ]);
  }

  for (const surface of surfaces) {
    if (surface === front || surface === back) {
      continue;
    }

    for (const [itemIndex, item] of surface.surfaceData.layeredItems.entries()) {
      if (item.type === "text" && itemText(item)) {
        warn(
          context,
          "Skipped spine text because Zakka books have no spine",
          `cover_spine_${surface.surfaceNumber}_${itemIndex}`,
        );
      }
    }
  }
};

/**
 * Maps a Shutterfly photo book project into an ordered list of Zakka page documents:
 * front cover, optional inside-front blank, inside pages, optional inside-back blank, back cover.
 * Blank inside covers are added so Shutterfly's facing pages and layflat spreads stay paired
 * in Zakka, which groups interior pages into sequential left/right spreads.
 */
export const mapShutterflyProject = (
  project: ShutterflyProject,
  resolvers: ShutterflyMappingResolvers,
): MappedShutterflyBook => {
  const insideSurfaces = getCategorySurfaces(project, "inside")
    .flatMap((surface) => {
      const number = surfaceNumber(surface);

      return number !== null && number >= 0 ? [{ number, surface }] : [];
    })
    .sort((first, second) => first.number - second.number);
  const size = singlePageSize(insideSurfaces.map(({ surface }) => surface));

  if (!size) {
    throw new Error("This Shutterfly project has no book pages to import");
  }

  const pageWidth = clamp(Math.round(size.width), 320, 10000);
  const pageHeight = clamp(Math.round(size.height), 320, 10000);
  const spreads = insideSurfaces.filter(({ surface }) => isSpreadSurface(surface, pageWidth));
  const insidePageCount = insideSurfaces.reduce(
    (count, { number, surface }) =>
      Math.max(count, number + (isSpreadSurface(surface, pageWidth) ? 2 : 1)),
    0,
  );
  const firstSurface = insideSurfaces.find(({ number }) => number === 0)?.surface;
  // Shutterfly books open on a right-hand page unless the project says otherwise.
  const needsInsideFrontCover = !(
    (firstSurface !== undefined && surfaceType(firstSurface) === "left") ||
    spreads.some(({ number }) => number % 2 === 0)
  );
  const needsInsideBackCover = (insidePageCount + (needsInsideFrontCover ? 1 : 0)) % 2 === 1;

  const createDraft = (title: string): PageDraft => ({
    title,
    backgroundColor: null,
    backgroundCoversCenter: false,
    layers: [],
    layerIds: new Set(),
  });
  const pages: PageDraft[] = [createDraft("Front cover")];

  if (needsInsideFrontCover) {
    pages.push(createDraft("Inside front cover"));
  }

  const firstInsidePageIndex = pages.length;

  for (let pageNumber = 1; pageNumber <= insidePageCount; pageNumber += 1) {
    pages.push(createDraft(`Page ${pageNumber}`));
  }

  if (needsInsideBackCover) {
    pages.push(createDraft("Inside back cover"));
  }

  pages.push(createDraft("Back cover"));

  const context: MapContext = { pageWidth, pageHeight, pages, resolvers, warnings: new Map() };

  for (const { number, surface } of insideSurfaces) {
    const { width, height } = surface.surfaceData.pageDetails;
    const surfaceKey = `inside_${number}`;

    if (isSpreadSurface(surface, pageWidth)) {
      // Fit the spread across two Zakka pages with one uniform scale so a layer shared by both
      // pages keeps Zakka's spread convention: same layer id, x offset by the left page width.
      const scale = (pageWidth * 2) / width;
      const offsetY = (pageHeight - height * scale) / 2;

      mapSurface(context, surface, surfaceKey, [
        {
          pageIndex: firstInsidePageIndex + number,
          transform: { scale, offsetX: 0, offsetY },
          layerIdSuffix: "",
        },
        {
          pageIndex: firstInsidePageIndex + number + 1,
          transform: { scale, offsetX: -pageWidth, offsetY },
          layerIdSuffix: "",
        },
      ]);
      continue;
    }

    mapSurface(context, surface, surfaceKey, [
      {
        pageIndex: firstInsidePageIndex + number,
        transform: centeredRegionTransform(
          { x: 0, y: 0, w: width, h: height, rot: 0 },
          pageWidth,
          pageHeight,
        ),
        layerIdSuffix: "",
      },
    ]);
  }

  const cover = getCategorySurfaces(project, "coverSpread")[0];
  const backCoverIndex = pages.length - 1;

  if (!cover) {
    mapSeparateCoverSurfaces(context, getCategorySurfaces(project, "cover"), backCoverIndex);
  } else {
    const regions = coverRegions(cover);

    mapSurface(
      context,
      cover,
      "cover",
      [
        {
          pageIndex: 0,
          transform: centeredRegionTransform(regions.front, pageWidth, pageHeight),
          layerIdSuffix: "_front",
        },
        {
          pageIndex: backCoverIndex,
          transform: centeredRegionTransform(regions.back, pageWidth, pageHeight),
          layerIdSuffix: "_back",
        },
      ],
      (item, placement) => {
        const parent = itemParentSurfaceType(item);

        // Region backgrounds only apply to their own side of the cover.
        return !parent || (placement.pageIndex === 0 ? parent === "front" : parent === "back");
      },
    );
  }

  return {
    title: (project.projectName ?? "").trim().slice(0, 120) || "Shutterfly book",
    pageWidth,
    pageHeight,
    pages: pages.map((page) => ({
      title: page.title,
      document: createPageDocument({
        canvas: {
          width: pageWidth,
          height: pageHeight,
          backgroundColor: page.backgroundColor ?? defaultBackgroundColor,
        },
        layers: page.layers,
      }),
    })),
    warnings: [...context.warnings.entries()].map(([message, elements]) =>
      elements.size > 1 ? `${message} (${elements.size})` : message,
    ),
  };
};
