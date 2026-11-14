import {
  createPhotoLayer,
  createTextLayer,
  fillPhotoLayerUpdate,
  isTextPlaceholder,
  type PageDocument,
  type PageLayer,
  type PhotoLayer,
  pageDocumentSchema,
  type TextLayer,
} from "./index.js";

export type PageLayoutOrientation = "square" | "portrait" | "landscape";

export type PageLayoutPhotoSlot = {
  kind: "photo";
  /** Slot geometry as fractions (0..1) of the page width and height. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  frame?: PhotoLayer["border"]["framePreset"];
  mask?: PhotoLayer["mask"]["shape"];
  shadow?: boolean;
};

export type PageLayoutTextSlot = {
  kind: "text";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  role: "title" | "body";
  align: TextLayer["align"];
};

export type PageLayoutSlot = PageLayoutPhotoSlot | PageLayoutTextSlot;

export type PageLayout = {
  id: string;
  name: string;
  source: "zakka" | "shutterfly";
  /** Page shapes the layout was designed for; "any" layouts stretch to every page. */
  orientation: PageLayoutOrientation | "any";
  /** Slots in stacking order, bottom first. */
  slots: readonly PageLayoutSlot[];
  photoSlotCount: number;
  textSlotCount: number;
};

/** Compact checked-in form of imported layouts: [source id, orientation, encoded slots]. */
export type EncodedPageLayout = readonly [
  sourceId: string,
  orientation: PageLayoutOrientation,
  slots: string,
];

const encodedUnits = 10000;

const describeLayout = (photoSlotCount: number, textSlotCount: number): string => {
  const parts: string[] = [];
  if (photoSlotCount > 0) parts.push(`${photoSlotCount} photo${photoSlotCount === 1 ? "" : "s"}`);
  if (textSlotCount > 0) parts.push(`${textSlotCount} text`);
  return parts.length > 0 ? parts.join(", ") : "Blank";
};

const finishLayout = (
  layout: Omit<PageLayout, "photoSlotCount" | "textSlotCount" | "name"> & { name?: string },
): PageLayout => {
  const photoSlotCount = layout.slots.filter((slot) => slot.kind === "photo").length;
  const textSlotCount = layout.slots.length - photoSlotCount;
  return {
    ...layout,
    name: layout.name ?? describeLayout(photoSlotCount, textSlotCount),
    photoSlotCount,
    textSlotCount,
  };
};

const decodeAlign = (code: string | undefined): TextLayer["align"] =>
  code === "c" ? "center" : code === "r" ? "right" : "left";

const decodeSlot = (encoded: string): PageLayoutSlot | null => {
  const [kind, geometry = "", style = ""] = encoded.split(":");
  const [x = 0, y = 0, width = 0, height = 0, rotation = 0] = geometry
    .split(",")
    .map((value) => Number(value));
  const box = {
    x: x / encodedUnits,
    y: y / encodedUnits,
    width: width / encodedUnits,
    height: height / encodedUnits,
    rotation,
  };

  if (box.width <= 0 || box.height <= 0) return null;
  if (kind === "p") return { kind: "photo", ...box };
  if (kind === "t") {
    return {
      kind: "text",
      ...box,
      role: style.startsWith("T") ? "title" : "body",
      align: decodeAlign(style.slice(1)),
    };
  }
  return null;
};

/** Expands imported layouts (see scripts/import-shutterfly-layouts.mjs) into page layouts. */
export const decodePageLayouts = (
  encoded: readonly EncodedPageLayout[],
  source: PageLayout["source"] = "shutterfly",
): PageLayout[] =>
  encoded.map(([sourceId, orientation, slots]) =>
    finishLayout({
      id: `${source}:${sourceId}`,
      source,
      orientation,
      slots: slots
        .split(" ")
        .map(decodeSlot)
        .filter((slot): slot is PageLayoutSlot => slot !== null),
    }),
  );

const photo = (
  x: number,
  y: number,
  width: number,
  height: number,
  style: Partial<Pick<PageLayoutPhotoSlot, "rotation" | "frame" | "mask" | "shadow">> = {},
): PageLayoutPhotoSlot => ({ kind: "photo", x, y, width, height, rotation: 0, ...style });

const text = (
  x: number,
  y: number,
  width: number,
  height: number,
  role: PageLayoutTextSlot["role"],
  align: TextLayer["align"] = "center",
  rotation = 0,
): PageLayoutTextSlot => ({ kind: "text", x, y, width, height, rotation, role, align });

const polaroid = (rotation: number) =>
  ({ frame: "polaroid", shadow: true, rotation }) satisfies Partial<PageLayoutPhotoSlot>;

/** Hand-made scrapbook layouts that lean on Zakka's frames, masks, and rotation. */
export const zakkaPageLayouts: readonly PageLayout[] = [
  {
    id: "zakka:polaroid-pair",
    name: "Polaroid pair",
    slots: [
      photo(0.07, 0.12, 0.42, 0.5, polaroid(-5)),
      photo(0.51, 0.27, 0.42, 0.5, polaroid(4)),
      text(0.1, 0.83, 0.8, 0.08, "body"),
    ],
  },
  {
    id: "zakka:scattered-snapshots",
    name: "Scattered snapshots",
    slots: [
      photo(0.06, 0.06, 0.36, 0.42, polaroid(-7)),
      photo(0.56, 0.05, 0.36, 0.42, polaroid(5)),
      photo(0.32, 0.3, 0.36, 0.42, polaroid(-2)),
      photo(0.07, 0.53, 0.36, 0.42, polaroid(4)),
      photo(0.57, 0.53, 0.36, 0.42, polaroid(-4)),
    ],
  },
  {
    id: "zakka:hero-title",
    name: "Hero with title",
    slots: [
      photo(0, 0, 1, 0.7),
      text(0.08, 0.75, 0.84, 0.1, "title"),
      text(0.12, 0.87, 0.76, 0.07, "body"),
    ],
  },
  {
    id: "zakka:circle-trio",
    name: "Circle trio",
    slots: [
      text(0.1, 0.1, 0.8, 0.1, "title"),
      photo(0.06, 0.34, 0.27, 0.27, { mask: "ellipse" }),
      photo(0.365, 0.34, 0.27, 0.27, { mask: "ellipse" }),
      photo(0.67, 0.34, 0.27, 0.27, { mask: "ellipse" }),
      text(0.06, 0.66, 0.27, 0.08, "body"),
      text(0.365, 0.66, 0.27, 0.08, "body"),
      text(0.67, 0.66, 0.27, 0.08, "body"),
    ],
  },
  {
    id: "zakka:film-strip",
    name: "Film strip",
    slots: [
      text(0.1, 0.07, 0.8, 0.1, "title"),
      photo(0.22, 0.22, 0.56, 0.24, { frame: "film", rotation: -2 }),
      photo(0.22, 0.48, 0.56, 0.24, { frame: "film", rotation: -2 }),
      text(0.12, 0.8, 0.76, 0.1, "body"),
    ],
  },
  {
    id: "zakka:arch-journal",
    name: "Arch journal",
    slots: [
      photo(0.07, 0.08, 0.44, 0.84, { mask: "arch" }),
      text(0.57, 0.12, 0.36, 0.12, "title", "left"),
      text(0.57, 0.3, 0.36, 0.6, "body", "left"),
    ],
  },
  {
    id: "zakka:journal-page",
    name: "Journal page",
    slots: [
      text(0.08, 0.06, 0.84, 0.09, "title", "left"),
      photo(0.08, 0.19, 0.5, 0.4, { frame: "mat", shadow: true }),
      text(0.62, 0.2, 0.3, 0.38, "body", "left"),
      text(0.08, 0.64, 0.38, 0.3, "body", "left"),
      photo(0.5, 0.63, 0.42, 0.32, { frame: "mat", shadow: true }),
    ],
  },
  {
    id: "zakka:overlap-collage",
    name: "Overlap collage",
    slots: [
      photo(0.06, 0.07, 0.56, 0.44, { shadow: true, rotation: -3 }),
      photo(0.38, 0.32, 0.56, 0.4, { shadow: true, rotation: 2 }),
      photo(0.1, 0.56, 0.42, 0.36, { shadow: true, rotation: -1 }),
      text(0.56, 0.78, 0.36, 0.12, "body"),
    ],
  },
  {
    id: "zakka:ticket-stubs",
    name: "Ticket stubs",
    slots: [
      text(0.08, 0.06, 0.84, 0.1, "title"),
      photo(0.08, 0.2, 0.56, 0.22, { mask: "ticket", rotation: -3 }),
      photo(0.36, 0.45, 0.56, 0.22, { mask: "ticket", rotation: 2 }),
      photo(0.08, 0.7, 0.56, 0.22, { mask: "ticket", rotation: -1 }),
    ],
  },
  {
    id: "zakka:mat-grid",
    name: "Captioned grid",
    slots: [
      photo(0.08, 0.07, 0.4, 0.33, { frame: "mat" }),
      photo(0.52, 0.07, 0.4, 0.33, { frame: "mat" }),
      text(0.08, 0.41, 0.4, 0.06, "body"),
      text(0.52, 0.41, 0.4, 0.06, "body"),
      photo(0.08, 0.53, 0.4, 0.33, { frame: "mat" }),
      photo(0.52, 0.53, 0.4, 0.33, { frame: "mat" }),
      text(0.08, 0.87, 0.4, 0.06, "body"),
      text(0.52, 0.87, 0.4, 0.06, "body"),
    ],
  },
  {
    id: "zakka:diamond-feature",
    name: "Diamond feature",
    slots: [
      photo(0.2, 0.08, 0.6, 0.6, { mask: "diamond" }),
      text(0.1, 0.72, 0.8, 0.1, "title"),
      text(0.15, 0.84, 0.7, 0.08, "body"),
    ],
  },
  {
    id: "zakka:paper-scraps",
    name: "Paper scraps",
    slots: [
      photo(0.08, 0.1, 0.5, 0.42, { frame: "paper", shadow: true, rotation: -4 }),
      text(0.6, 0.16, 0.32, 0.3, "body", "left", 3),
      text(0.1, 0.6, 0.32, 0.3, "body", "left", -2),
      photo(0.42, 0.5, 0.5, 0.42, { frame: "paper", shadow: true, rotation: 3 }),
    ],
  },
  {
    id: "zakka:chapter-title",
    name: "Chapter title",
    slots: [
      text(0.1, 0.3, 0.8, 0.14, "title"),
      text(0.18, 0.47, 0.64, 0.08, "body"),
      photo(0.36, 0.6, 0.28, 0.28, { frame: "polaroid", shadow: true, rotation: 3 }),
    ],
  },
].map((layout) => finishLayout({ ...layout, source: "zakka", orientation: "any" }));

const squareTolerance = 0.1;

export const getPageOrientation = (canvas: PageDocument["canvas"]): PageLayoutOrientation => {
  const aspect = canvas.width / canvas.height;
  if (aspect > 1 + squareTolerance) return "landscape";
  if (aspect < 1 - squareTolerance) return "portrait";
  return "square";
};

/** Layouts designed for the page's shape, plus the shape-agnostic Zakka layouts. */
export const filterPageLayoutsForCanvas = (
  layouts: readonly PageLayout[],
  canvas: PageDocument["canvas"],
): PageLayout[] => {
  const orientation = getPageOrientation(canvas);
  return layouts.filter(
    (layout) => layout.orientation === "any" || layout.orientation === orientation,
  );
};

type Box = { x: number; y: number; width: number; height: number };

const rotatedBounds = (layer: PageLayer): Box => {
  const radians = (layer.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = layer.width * cos + layer.height * sin;
  const height = layer.width * sin + layer.height * cos;
  return {
    x: layer.x + layer.width / 2 - width / 2,
    y: layer.y + layer.height / 2 - height / 2,
    width,
    height,
  };
};

/**
 * Layers a layout may move: unlocked photos and text that sit on the page. Layers hanging off the
 * page (such as spread-spanning frames mirrored onto the facing page) are left alone.
 */
const isLayoutEligible = (layer: PageLayer, canvas: PageDocument["canvas"]): boolean => {
  if (layer.locked || (layer.kind !== "photo" && layer.kind !== "text")) return false;
  const bounds = rotatedBounds(layer);
  const tolerance = Math.max(canvas.width, canvas.height) * 0.02;
  return (
    bounds.x >= -tolerance &&
    bounds.y >= -tolerance &&
    bounds.x + bounds.width <= canvas.width + tolerance &&
    bounds.y + bounds.height <= canvas.height + tolerance
  );
};

const isFilledPhoto = (layer: PageLayer): layer is PhotoLayer & { assetId: string } =>
  layer.kind === "photo" && Boolean(layer.assetId);

const isFilledText = (layer: PageLayer): layer is TextLayer =>
  layer.kind === "text" && !isTextPlaceholder(layer);

export type PageLayoutFit = {
  photoCount: number;
  textCount: number;
  /** Photos the layout has no room for; applying the layout removes them from the page. */
  extraPhotoCount: number;
  /** Text boxes the layout has no slot for; they stay where they are. */
  extraTextCount: number;
  fits: boolean;
};

export const getPageLayoutFit = (document: PageDocument, layout: PageLayout): PageLayoutFit => {
  const eligible = document.layers.filter((layer) => isLayoutEligible(layer, document.canvas));
  const photoCount = eligible.filter(isFilledPhoto).length;
  const textCount = eligible.filter(isFilledText).length;
  const extraPhotoCount = Math.max(0, photoCount - layout.photoSlotCount);
  return {
    photoCount,
    textCount,
    extraPhotoCount,
    extraTextCount: Math.max(0, textCount - layout.textSlotCount),
    fits: extraPhotoCount === 0,
  };
};

/** Minimum-cost assignment of rows to distinct columns (rows <= columns); returns row -> column. */
const solveAssignment = (cost: readonly (readonly number[])[], columns: number): number[] => {
  const rows = cost.length;
  const rowPotential = new Array<number>(rows + 1).fill(0);
  const columnPotential = new Array<number>(columns + 1).fill(0);
  const columnOwner = new Array<number>(columns + 1).fill(0);
  const previous = new Array<number>(columns + 1).fill(0);
  const value = (list: number[], index: number) => list[index] ?? 0;

  for (let row = 1; row <= rows; row += 1) {
    columnOwner[0] = row;
    let current = 0;
    const slack = new Array<number>(columns + 1).fill(Number.POSITIVE_INFINITY);
    const visited = new Array<boolean>(columns + 1).fill(false);

    do {
      visited[current] = true;
      const owner = value(columnOwner, current);
      let delta = Number.POSITIVE_INFINITY;
      let next = 0;

      for (let column = 1; column <= columns; column += 1) {
        if (visited[column]) continue;
        const reduced =
          (cost[owner - 1]?.[column - 1] ?? Number.POSITIVE_INFINITY) -
          value(rowPotential, owner) -
          value(columnPotential, column);
        if (reduced < value(slack, column)) {
          slack[column] = reduced;
          previous[column] = current;
        }
        if (value(slack, column) < delta) {
          delta = value(slack, column);
          next = column;
        }
      }

      for (let column = 0; column <= columns; column += 1) {
        if (visited[column]) {
          const columnRow = value(columnOwner, column);
          rowPotential[columnRow] = value(rowPotential, columnRow) + delta;
          columnPotential[column] = value(columnPotential, column) - delta;
        } else {
          slack[column] = value(slack, column) - delta;
        }
      }

      current = next;
    } while (value(columnOwner, current) !== 0);

    do {
      const prior = value(previous, current);
      columnOwner[current] = value(columnOwner, prior);
      current = prior;
    } while (current !== 0);
  }

  const assignment = new Array<number>(rows).fill(-1);
  for (let column = 1; column <= columns; column += 1) {
    const owner = value(columnOwner, column);
    if (owner > 0) assignment[owner - 1] = column - 1;
  }
  return assignment;
};

/** Sorts boxes top-to-bottom in rows, then left-to-right, returning each box's rank. */
const readingRanks = (boxes: readonly Box[], rowTolerance: number): number[] => {
  const order = boxes
    .map((box, index) => ({ box, index }))
    .sort((left, right) => {
      const rowDelta = left.box.y - right.box.y;
      return Math.abs(rowDelta) > rowTolerance ? rowDelta : left.box.x - right.box.x;
    });
  const ranks = new Array<number>(boxes.length).fill(0);
  order.forEach(({ index }, rank) => {
    ranks[index] = rank;
  });
  return ranks;
};

const normalizedRank = (rank: number, count: number) => (count > 1 ? rank / (count - 1) : 0);

export type ApplyPageLayoutOptions = {
  /** Natural width / height of a photo, used to put landscape photos in landscape slots. */
  getPhotoAspectRatio?: (layer: PhotoLayer) => number | null | undefined;
};

export type ApplyPageLayoutResult = {
  document: PageDocument;
  /** Photo layers dropped because the layout has fewer photo slots than the page has photos. */
  removedPhotoLayerIds: string[];
};

const clampFontSize = (size: number) => Math.max(6, Math.min(240, Math.round(size)));

/**
 * Rearranges a page into a layout. Existing photos move into the photo slots that best match
 * their shape, text moves into text slots, and any unfilled slots become placeholders. Stickers,
 * washi tape, maps, locked layers, and layers hanging off the page are left untouched.
 */
export const applyPageLayout = (
  document: PageDocument,
  layout: PageLayout,
  options: ApplyPageLayoutOptions = {},
): ApplyPageLayoutResult => {
  const { canvas } = document;
  const toPage = (slot: PageLayoutSlot) => ({
    x: Math.round(slot.x * canvas.width),
    y: Math.round(slot.y * canvas.height),
    width: Math.max(1, Math.round(slot.width * canvas.width)),
    height: Math.max(1, Math.round(slot.height * canvas.height)),
    rotation: slot.rotation,
  });
  const rowTolerance = canvas.height * 0.05;
  const eligible = document.layers.filter((layer) => isLayoutEligible(layer, canvas));
  const photoSlots = layout.slots.filter((slot) => slot.kind === "photo");
  const textSlots = layout.slots.filter((slot) => slot.kind === "text");

  // Photos: keep the most prominent photos that fit, then match them to slots by shape and order.
  const filledPhotos = eligible.filter(isFilledPhoto);
  const keptPhotos = [...filledPhotos]
    .sort((left, right) => right.width * right.height - left.width * left.height)
    .slice(0, photoSlots.length);
  const keptPhotoIds = new Set(keptPhotos.map((layer) => layer.id));
  const orderedPhotos = filledPhotos.filter((layer) => keptPhotoIds.has(layer.id));
  const removedPhotoLayerIds = filledPhotos
    .filter((layer) => !keptPhotoIds.has(layer.id))
    .map((layer) => layer.id);
  const photoRanks = readingRanks(orderedPhotos, rowTolerance);
  const slotRanks = readingRanks(photoSlots.map(toPage), rowTolerance);
  const photoCost = orderedPhotos.map((layer, photoIndex) => {
    const photoAspect = options.getPhotoAspectRatio?.(layer) || layer.width / layer.height;
    return photoSlots.map((slot, slotIndex) => {
      const box = toPage(slot);
      const aspectCost = Math.abs(Math.log(box.width / box.height / photoAspect));
      const orderCost = Math.abs(
        normalizedRank(photoRanks[photoIndex] ?? 0, orderedPhotos.length) -
          normalizedRank(slotRanks[slotIndex] ?? 0, photoSlots.length),
      );
      return aspectCost + orderCost * 0.35;
    });
  });
  const photoAssignment = solveAssignment(photoCost, photoSlots.length);
  const photoBySlot = new Map<number, PhotoLayer>();
  orderedPhotos.forEach((layer, index) => {
    const slotIndex = photoAssignment[index];
    if (slotIndex !== undefined && slotIndex >= 0) photoBySlot.set(slotIndex, layer);
  });
  const sparePhotoPlaceholders = eligible
    .filter((layer): layer is PhotoLayer => layer.kind === "photo" && !layer.assetId)
    .sort((left, right) => left.y - right.y || left.x - right.x);

  const arrangedPhotos = photoSlots.map((slot, slotIndex) => {
    const box = toPage(slot);
    const existing = photoBySlot.get(slotIndex) ?? sparePhotoPlaceholders.shift();
    const base = existing ?? createPhotoLayer({});
    const { crop, photoTransform } = fillPhotoLayerUpdate(base.assetId ?? "");
    return {
      ...base,
      ...box,
      crop,
      photoTransform: {
        ...photoTransform,
        flipX: base.photoTransform.flipX,
        flipY: base.photoTransform.flipY,
      },
      border: { ...base.border, framePreset: slot.frame ?? "none" },
      mask: { ...base.mask, shape: slot.mask ?? "rectangle" },
      shadow: slot.shadow === undefined ? base.shadow : { ...base.shadow, enabled: slot.shadow },
    } satisfies PhotoLayer;
  });

  // Text: the largest text fills title slots, the rest flows into body slots in reading order.
  const filledTexts = eligible.filter(isFilledText);
  const textRanks = readingRanks(filledTexts, rowTolerance);
  const textsInReadingOrder = filledTexts
    .map((layer, index) => ({ layer, rank: textRanks[index] ?? 0 }))
    .sort((left, right) => left.rank - right.rank)
    .map(({ layer }) => layer);
  const titleSlotIndexes = textSlots.flatMap((slot, index) =>
    slot.role === "title" ? [index] : [],
  );
  const bodySlotIndexes = textSlots.flatMap((slot, index) => (slot.role === "body" ? [index] : []));
  const titleTexts = [...textsInReadingOrder]
    .sort((left, right) => right.fontSize - left.fontSize)
    .slice(0, titleSlotIndexes.length);
  const bodyTexts = textsInReadingOrder.filter((layer) => !titleTexts.includes(layer));
  const textBySlot = new Map<number, TextLayer>();
  titleTexts
    .sort((left, right) => textsInReadingOrder.indexOf(left) - textsInReadingOrder.indexOf(right))
    .forEach((layer, index) => {
      const slotIndex = titleSlotIndexes[index];
      if (slotIndex !== undefined) textBySlot.set(slotIndex, layer);
    });
  bodyTexts.slice(0, bodySlotIndexes.length).forEach((layer, index) => {
    const slotIndex = bodySlotIndexes[index];
    if (slotIndex !== undefined) textBySlot.set(slotIndex, layer);
  });
  const spareTextPlaceholders = eligible
    .filter((layer): layer is TextLayer => layer.kind === "text" && isTextPlaceholder(layer))
    .sort((left, right) => left.y - right.y || left.x - right.x);

  const arrangedTexts = textSlots.map((slot, slotIndex) => {
    const box = toPage(slot);
    const existing = textBySlot.get(slotIndex);
    if (existing) {
      return {
        ...existing,
        ...box,
        align: slot.align,
        fontSize: clampFontSize(Math.min(existing.fontSize, box.height / 1.25)),
      } satisfies TextLayer;
    }

    const placeholderSize =
      slot.role === "title"
        ? Math.min(box.height * 0.6, canvas.width * 0.065)
        : Math.min(box.height * 0.45, canvas.width * 0.03);
    const base = spareTextPlaceholders.shift() ?? createTextLayer({ text: "" });
    return {
      ...base,
      ...box,
      text: "",
      align: slot.align,
      fontSize: clampFontSize(placeholderSize),
    } satisfies TextLayer;
  });

  // Rebuild the stack: photos take the place of the first photo they replace (or the bottom of the
  // page), text takes the place of the first text it replaces (or the top of the page).
  const replacedIds = new Set<string>([
    ...eligible.filter((layer) => layer.kind === "photo").map((layer) => layer.id),
    ...filledTexts.filter((layer) => [...textBySlot.values()].includes(layer)).map((l) => l.id),
    ...eligible
      .filter((layer) => layer.kind === "text" && isTextPlaceholder(layer))
      .map((l) => l.id),
  ]);
  const layers: PageLayer[] = [];
  let photosPlaced = false;
  let textsPlaced = false;
  for (const layer of document.layers) {
    if (replacedIds.has(layer.id)) {
      if (layer.kind === "photo" && !photosPlaced) {
        layers.push(...arrangedPhotos);
        photosPlaced = true;
      } else if (layer.kind === "text" && !textsPlaced) {
        layers.push(...arrangedTexts);
        textsPlaced = true;
      }
      continue;
    }
    layers.push(layer);
  }
  if (!photosPlaced) layers.unshift(...arrangedPhotos);
  if (!textsPlaced) layers.push(...arrangedTexts);

  return {
    document: pageDocumentSchema.parse({ ...document, layers }),
    removedPhotoLayerIds,
  };
};
