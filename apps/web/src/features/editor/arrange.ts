import type { PageDocument, PageLayer, TextLayer } from "@zakka/editor-core";

import { getLayerSelectionFrame, type LayerTransformUpdate } from "./transforms";

export type ArrangeTab = "align" | "spread" | "grid";

export type AlignReference =
  | "lastSelected"
  | "firstSelected"
  | "largest"
  | "smallest"
  | "page"
  | "selection";
export type HorizontalAlign = "none" | "left" | "center" | "right";
export type VerticalAlign = "none" | "top" | "middle" | "bottom";

export type SpreadWithin = "selection" | "page";
export type SpreadGapMode = "even" | "fixed";
export type SpreadMode =
  | "gapsHorizontal"
  | "gapsVertical"
  | "left"
  | "centerX"
  | "right"
  | "top"
  | "centerY"
  | "bottom";

export type GridArea = "selection" | "page";
export type GridCellSize = "largest" | "fit";
export type GridOrder = "reading" | "selection";
export type CellAlign = "start" | "center" | "end";

export type ArrangeSettings = {
  tab: ArrangeTab;
  align: {
    asGroup: boolean;
    horizontal: HorizontalAlign;
    relativeTo: AlignReference;
    vertical: VerticalAlign;
  };
  spread: {
    gap: number;
    gapMode: SpreadGapMode;
    mode: SpreadMode;
    within: SpreadWithin;
  };
  grid: {
    area: GridArea;
    cellAlignX: CellAlign;
    cellAlignY: CellAlign;
    cellSize: GridCellSize;
    /** `null` picks a near-square grid for the current selection. */
    columns: number | null;
    gapX: number;
    gapY: number;
    order: GridOrder;
  };
};

export const defaultArrangeSettings: ArrangeSettings = {
  tab: "align",
  align: { asGroup: false, horizontal: "none", relativeTo: "lastSelected", vertical: "none" },
  spread: { gap: 40, gapMode: "even", mode: "gapsHorizontal", within: "selection" },
  grid: {
    area: "selection",
    cellAlignX: "center",
    cellAlignY: "center",
    cellSize: "largest",
    columns: null,
    gapX: 40,
    gapY: 40,
    order: "reading",
  },
};

export const alignReferenceLabels: Record<AlignReference, string> = {
  firstSelected: "First selected",
  largest: "Largest",
  lastSelected: "Last selected",
  page: "Page",
  selection: "Selection bounds",
  smallest: "Smallest",
};

export type ArrangePlan = {
  /** Layer the others were aligned to; it never moves. */
  anchorLayerId: string | null;
  updates: LayerTransformUpdate[];
};

type Bounds = { height: number; width: number; x: number; y: number };

type Canvas = PageDocument["canvas"];

const epsilon = 1e-6;

/** Visual bounds of a layer: its selection frame rotated about the layer center. */
export const getLayerVisualBounds = (layer: PageLayer): Bounds => {
  const frame = getLayerSelectionFrame(layer);
  const radians = (layer.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const centerX = layer.x + layer.width / 2;
  const centerY = layer.y + layer.height / 2;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const [cornerX, cornerY] of [
    [frame.x, frame.y],
    [frame.x + frame.width, frame.y],
    [frame.x + frame.width, frame.y + frame.height],
    [frame.x, frame.y + frame.height],
  ] as const) {
    const offsetX = cornerX - centerX;
    const offsetY = cornerY - centerY;
    const x = centerX + offsetX * cos - offsetY * sin;
    const y = centerY + offsetX * sin + offsetY * cos;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }

  return { height: bottom - top, width: right - left, x: left, y: top };
};

const unionBounds = (bounds: Bounds[]): Bounds | null => {
  if (bounds.length === 0) return null;
  const left = Math.min(...bounds.map((box) => box.x));
  const top = Math.min(...bounds.map((box) => box.y));
  const right = Math.max(...bounds.map((box) => box.x + box.width));
  const bottom = Math.max(...bounds.map((box) => box.y + box.height));

  return { height: bottom - top, width: right - left, x: left, y: top };
};

const area = (bounds: Bounds) => bounds.width * bounds.height;

type MeasuredLayer = { bounds: Bounds; layer: PageLayer };

const measure = (layers: PageLayer[]): MeasuredLayer[] =>
  layers.map((layer) => ({ bounds: getLayerVisualBounds(layer), layer }));

const moveUpdate = (layer: PageLayer, dx: number, dy: number): LayerTransformUpdate | null =>
  Math.abs(dx) < epsilon && Math.abs(dy) < epsilon
    ? null
    : { layerId: layer.id, update: { x: layer.x + dx, y: layer.y + dy } };

const compact = (updates: (LayerTransformUpdate | null)[]): LayerTransformUpdate[] =>
  updates.filter((update): update is LayerTransformUpdate => update !== null);

/** Resolves selected layer ids, in selection order, to layers on the page. */
export const getSelectedLayersInOrder = (
  document: PageDocument,
  selectedLayerIds: string[],
): PageLayer[] =>
  selectedLayerIds.flatMap((layerId) => {
    const layer = document.layers.find((candidate) => candidate.id === layerId);
    return layer ? [layer] : [];
  });

const resolveAnchorLayer = (
  measured: MeasuredLayer[],
  reference: AlignReference,
): MeasuredLayer | null => {
  if (measured.length === 0) return null;
  switch (reference) {
    case "lastSelected":
      return measured[measured.length - 1] ?? null;
    case "firstSelected":
      return measured[0] ?? null;
    case "largest":
      return measured.reduce((best, item) => (area(item.bounds) > area(best.bounds) ? item : best));
    case "smallest":
      return measured.reduce((best, item) => (area(item.bounds) < area(best.bounds) ? item : best));
    default:
      return null;
  }
};

/** Whether "Move selection as a group" means anything for the chosen reference. */
export const canAlignAsGroup = (reference: AlignReference): boolean => reference === "page";

const alignOffset = (
  bounds: Bounds,
  target: Bounds,
  horizontal: HorizontalAlign,
  vertical: VerticalAlign,
): { dx: number; dy: number } => ({
  dx:
    horizontal === "left"
      ? target.x - bounds.x
      : horizontal === "center"
        ? target.x + target.width / 2 - (bounds.x + bounds.width / 2)
        : horizontal === "right"
          ? target.x + target.width - (bounds.x + bounds.width)
          : 0,
  dy:
    vertical === "top"
      ? target.y - bounds.y
      : vertical === "middle"
        ? target.y + target.height / 2 - (bounds.y + bounds.height / 2)
        : vertical === "bottom"
          ? target.y + target.height - (bounds.y + bounds.height)
          : 0,
});

/**
 * Aligns layers to a reference. Locked layers never move but can still be the anchor or count
 * towards the selection bounds. Returns `null` when the settings can't produce an alignment.
 */
export const planAlign = (
  layers: PageLayer[],
  canvas: Canvas,
  settings: ArrangeSettings["align"],
): ArrangePlan | null => {
  const { horizontal, relativeTo, vertical } = settings;
  if (horizontal === "none" && vertical === "none") return null;
  if (layers.length === 0) return null;
  if (layers.length === 1 && relativeTo !== "page") return null;

  const measured = measure(layers);
  const movable = measured.filter(({ layer }) => !layer.locked);
  if (movable.length === 0) return null;

  if (relativeTo === "page" || relativeTo === "selection") {
    const target: Bounds =
      relativeTo === "page"
        ? { height: canvas.height, width: canvas.width, x: 0, y: 0 }
        : (unionBounds(measured.map(({ bounds }) => bounds)) as Bounds);

    if (relativeTo === "page" && settings.asGroup) {
      const groupBounds = unionBounds(movable.map(({ bounds }) => bounds)) as Bounds;
      const { dx, dy } = alignOffset(groupBounds, target, horizontal, vertical);
      return {
        anchorLayerId: null,
        updates: compact(movable.map(({ layer }) => moveUpdate(layer, dx, dy))),
      };
    }

    return {
      anchorLayerId: null,
      updates: compact(
        movable.map(({ bounds, layer }) => {
          const { dx, dy } = alignOffset(bounds, target, horizontal, vertical);
          return moveUpdate(layer, dx, dy);
        }),
      ),
    };
  }

  const anchor = resolveAnchorLayer(measured, relativeTo);
  if (!anchor) return null;

  return {
    anchorLayerId: anchor.layer.id,
    updates: compact(
      movable
        .filter(({ layer }) => layer.id !== anchor.layer.id)
        .map(({ bounds, layer }) => {
          const { dx, dy } = alignOffset(bounds, anchor.bounds, horizontal, vertical);
          return moveUpdate(layer, dx, dy);
        }),
    ),
  };
};

const isHorizontalSpread = (mode: SpreadMode) =>
  mode === "gapsHorizontal" || mode === "left" || mode === "centerX" || mode === "right";

const usesGaps = (mode: SpreadMode) => mode === "gapsHorizontal" || mode === "gapsVertical";

/** Gap settings only affect the equal-gap modes. */
export const spreadUsesGapSetting = usesGaps;

const edgeFraction = (mode: SpreadMode): number =>
  mode === "left" || mode === "top" ? 0 : mode === "right" || mode === "bottom" ? 1 : 0.5;

/** Minimum unlocked layers a spread needs before it can change anything. */
export const getMinimumSpreadLayers = (settings: ArrangeSettings["spread"]): number =>
  settings.within === "page" || (usesGaps(settings.mode) && settings.gapMode === "fixed") ? 2 : 3;

/**
 * Spreads unlocked layers along one axis. Within the selection the outer layers stay put; within
 * the page the layers are spread across the full page width or height.
 */
export const planSpread = (
  layers: PageLayer[],
  canvas: Canvas,
  settings: ArrangeSettings["spread"],
): ArrangePlan | null => {
  const movable = measure(layers.filter((layer) => !layer.locked));
  if (movable.length < getMinimumSpreadLayers(settings)) return null;

  const horizontal = isHorizontalSpread(settings.mode);
  const start = (bounds: Bounds) => (horizontal ? bounds.x : bounds.y);
  const size = (bounds: Bounds) => (horizontal ? bounds.width : bounds.height);
  const pageSize = horizontal ? canvas.width : canvas.height;
  const offsetUpdate = ({ layer }: MeasuredLayer, delta: number) =>
    horizontal ? moveUpdate(layer, delta, 0) : moveUpdate(layer, 0, delta);

  if (usesGaps(settings.mode)) {
    const sorted = [...movable].sort(
      (left, right) =>
        start(left.bounds) + size(left.bounds) / 2 - (start(right.bounds) + size(right.bounds) / 2),
    );
    const totalSize = sorted.reduce((sum, item) => sum + size(item.bounds), 0);
    const count = sorted.length;
    let cursor: number;
    let gap: number;

    if (settings.within === "page") {
      if (settings.gapMode === "fixed") {
        gap = settings.gap;
        cursor = (pageSize - (totalSize + gap * (count - 1))) / 2;
      } else {
        gap = (pageSize - totalSize) / (count + 1);
        cursor = gap;
      }
    } else {
      // Span from the first sorted layer's start to the last one's end so both stay put.
      const first = sorted[0] as MeasuredLayer;
      const last = sorted[count - 1] as MeasuredLayer;
      cursor = start(first.bounds);
      if (settings.gapMode === "fixed") {
        gap = settings.gap;
      } else {
        const end = start(last.bounds) + size(last.bounds);
        gap = (end - cursor - totalSize) / (count - 1);
      }
    }

    const updates = sorted.map((item) => {
      const delta = cursor - start(item.bounds);
      cursor += size(item.bounds) + gap;
      return offsetUpdate(item, delta);
    });

    return { anchorLayerId: null, updates: compact(updates) };
  }

  const fraction = edgeFraction(settings.mode);
  const edge = (bounds: Bounds) => start(bounds) + size(bounds) * fraction;
  const sorted = [...movable].sort((left, right) => edge(left.bounds) - edge(right.bounds));
  const first = sorted[0] as MeasuredLayer;
  const last = sorted[sorted.length - 1] as MeasuredLayer;
  const firstEdge = settings.within === "page" ? size(first.bounds) * fraction : edge(first.bounds);
  const lastEdge =
    settings.within === "page" ? pageSize - size(last.bounds) * (1 - fraction) : edge(last.bounds);
  const step = (lastEdge - firstEdge) / (sorted.length - 1);

  return {
    anchorLayerId: null,
    updates: compact(
      sorted.map((item, index) => offsetUpdate(item, firstEdge + step * index - edge(item.bounds))),
    ),
  };
};

export const getGridColumns = (settings: ArrangeSettings["grid"], count: number): number => {
  const columns = settings.columns ?? Math.ceil(Math.sqrt(count));
  return Math.max(1, Math.min(Math.round(columns), Math.max(count, 1)));
};

/** Groups layers into their current visual rows (by vertical overlap), then reads each row left to right. */
const sortReadingOrder = (measured: MeasuredLayer[]): MeasuredLayer[] => {
  const centerX = ({ bounds }: MeasuredLayer) => bounds.x + bounds.width / 2;
  const centerY = ({ bounds }: MeasuredLayer) => bounds.y + bounds.height / 2;
  const byY = [...measured].sort((left, right) => centerY(left) - centerY(right));
  const rows: MeasuredLayer[][] = [];
  let rowBottom = Number.NEGATIVE_INFINITY;

  for (const item of byY) {
    const row = rows[rows.length - 1];
    if (row && item.bounds.y < rowBottom) {
      row.push(item);
      rowBottom = Math.max(rowBottom, item.bounds.y + item.bounds.height);
    } else {
      rows.push([item]);
      rowBottom = item.bounds.y + item.bounds.height;
    }
  }

  return rows.flatMap((row) => row.sort((left, right) => centerX(left) - centerX(right)));
};

const scaleLayerAboutCenter = (layer: PageLayer, scale: number): Partial<PageLayer> => {
  const width = Math.max(layer.width * scale, 1);
  const height = Math.max(layer.height * scale, 1);
  const update: Partial<PageLayer> = {
    height,
    width,
    x: layer.x + (layer.width - width) / 2,
    y: layer.y + (layer.height - height) / 2,
  };

  if (layer.kind === "text") {
    (update as Partial<TextLayer>).fontSize = Math.min(
      Math.max((layer as TextLayer).fontSize * scale, 6),
      240,
    );
  }

  return update;
};

const cellOffset = (align: CellAlign, cellSize: number, itemSize: number) =>
  align === "start" ? 0 : align === "end" ? cellSize - itemSize : (cellSize - itemSize) / 2;

/** Arranges unlocked layers into a grid of equal cells. "Fit area" resizes layers to the cells. */
export const planGrid = (
  layers: PageLayer[],
  canvas: Canvas,
  settings: ArrangeSettings["grid"],
): ArrangePlan | null => {
  const movable = measure(layers.filter((layer) => !layer.locked));
  if (movable.length < 2) return null;

  const columns = getGridColumns(settings, movable.length);
  const rows = Math.ceil(movable.length / columns);
  const ordered = settings.order === "reading" ? sortReadingOrder(movable) : [...movable];
  const selectionBounds = unionBounds(movable.map(({ bounds }) => bounds)) as Bounds;
  const pageBounds: Bounds = { height: canvas.height, width: canvas.width, x: 0, y: 0 };
  let cellWidth: number;
  let cellHeight: number;
  let originX: number;
  let originY: number;

  if (settings.cellSize === "fit") {
    const areaBounds = settings.area === "page" ? pageBounds : selectionBounds;
    cellWidth = Math.max((areaBounds.width - settings.gapX * (columns - 1)) / columns, 1);
    cellHeight = Math.max((areaBounds.height - settings.gapY * (rows - 1)) / rows, 1);
    originX = areaBounds.x;
    originY = areaBounds.y;
  } else {
    cellWidth = Math.max(...movable.map(({ bounds }) => bounds.width));
    cellHeight = Math.max(...movable.map(({ bounds }) => bounds.height));
    const gridWidth = cellWidth * columns + settings.gapX * (columns - 1);
    const gridHeight = cellHeight * rows + settings.gapY * (rows - 1);
    originX = settings.area === "page" ? (canvas.width - gridWidth) / 2 : selectionBounds.x;
    originY = settings.area === "page" ? (canvas.height - gridHeight) / 2 : selectionBounds.y;
  }

  const updates = ordered.map(({ bounds, layer }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = originX + column * (cellWidth + settings.gapX);
    const cellY = originY + row * (cellHeight + settings.gapY);
    let nextLayer = layer;
    let nextBounds = bounds;
    let scaleUpdate: Partial<PageLayer> = {};

    if (settings.cellSize === "fit" && bounds.width > 0 && bounds.height > 0) {
      const scale = Math.min(cellWidth / bounds.width, cellHeight / bounds.height);
      if (Math.abs(scale - 1) > epsilon) {
        scaleUpdate = scaleLayerAboutCenter(layer, scale);
        nextLayer = { ...layer, ...scaleUpdate } as PageLayer;
        nextBounds = getLayerVisualBounds(nextLayer);
      }
    }

    const dx = cellX + cellOffset(settings.cellAlignX, cellWidth, nextBounds.width) - nextBounds.x;
    const dy =
      cellY + cellOffset(settings.cellAlignY, cellHeight, nextBounds.height) - nextBounds.y;
    const move = moveUpdate(nextLayer, dx, dy);

    if (Object.keys(scaleUpdate).length === 0) return move;
    const update: Partial<PageLayer> = {
      ...scaleUpdate,
      ...(move?.update ?? {}),
    } as Partial<PageLayer>;
    return { layerId: layer.id, update };
  });

  return { anchorLayerId: null, updates: compact(updates) };
};

/** Plans the active tab's action for the selected layers (given in selection order). */
export const planArrange = (
  layers: PageLayer[],
  canvas: Canvas,
  settings: ArrangeSettings,
): ArrangePlan | null => {
  switch (settings.tab) {
    case "align":
      return planAlign(layers, canvas, settings.align);
    case "spread":
      return planSpread(layers, canvas, settings.spread);
    case "grid":
      return planGrid(layers, canvas, settings.grid);
  }
};

/** Single-layer selections can only align to the page. */
export const getSingleLayerArrangeSettings = (settings: ArrangeSettings): ArrangeSettings => ({
  ...settings,
  tab: "align",
  align: { ...settings.align, asGroup: false, relativeTo: "page" },
});
