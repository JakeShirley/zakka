import {
  AddRegular,
  ArrowAutofitHeightRegular,
  ArrowAutofitWidthRegular,
  ArrowClockwiseRegular,
  ArrowDownRegular,
  ArrowUpRegular,
  DeleteRegular,
  EditRegular,
  HandLeftRegular,
  ImageBorderRegular,
  SubtractRegular,
  TextTRegular,
} from "@fluentui/react-icons";
import {
  type PageDocument,
  type PageLayer,
  type PhotoLayer,
  isCustomStickerId,
  renderPageDocumentSvg,
  type StickerSvg,
  type WashiTapeLayer,
} from "@zakka/editor-core";
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Asset } from "../../types";
import { assetDragMimeType } from "./AssetRail";
import type { ActiveTransform, CanvasPoint, ResizeHandle, TransformMode } from "./editorTypes";
import { FontFamilySelect } from "./FontFamilySelect";
import { RichTextEditor, type RichTextEditorHandle } from "./RichTextEditor";
import { TextAlignmentControl } from "./TextAlignmentControl";
import {
  applyGroupMove,
  applyGroupRotate,
  applyGroupScale,
  clampPhotoPanOffset,
  cropPhotoLayerFromHandle,
  type GroupBoundingBox,
  getAngle,
  getGroupScaleFromHandle,
  getLayerCenter,
  getLayerSelectionFrame,
  getMultiSelectionBoundingBox,
  type LayerTransformUpdate,
  type MultiSelectionResizeHandle,
  multiSelectionResizeHandles,
  normalizeRotation,
  panPhotoLayer,
  resizeHandles,
  resizeLayerFromHandle,
  scaleLayerFromCornerHandle,
} from "./transforms";

export type SelectionPanel = "edit" | "frame";

export type ReorderLayerCommand = "bottom" | "down" | "top" | "up";

export type SpreadReorderCapabilities = ReadonlyMap<
  string,
  { canMoveDown: boolean; canMoveUp: boolean }
>;

export type CanvasPreviewLayer = {
  layer: PageLayer;
  sourcePageId: string;
  stackIndex: number;
};

/** Dashed outlines showing where an arrange action will move layers. */
export type ArrangeCanvasPreview = {
  anchorLabel: string | null;
  anchorLayer: PageLayer | null;
  ghosts: PageLayer[];
};

type InteractiveCanvasLayer =
  | {
      kind: "document";
      layer: PageLayer;
      stackIndex: number;
    }
  | {
      kind: "preview";
      layer: PageLayer;
      sourcePageId: string;
      stackIndex: number;
    };

const mergeCanvasLayers = (
  layers: PageLayer[],
  previewLayers: CanvasPreviewLayer[],
): InteractiveCanvasLayer[] =>
  [
    ...layers.map((layer, stackIndex) => ({ kind: "document" as const, layer, stackIndex })),
    ...previewLayers.map(({ layer, sourcePageId, stackIndex }) => ({
      kind: "preview" as const,
      layer,
      sourcePageId,
      stackIndex,
    })),
  ].sort((left, right) => left.stackIndex - right.stackIndex);

const applyLayerUpdate = (layer: PageLayer, update: Partial<PageLayer>): PageLayer =>
  ({ ...layer, ...update }) as PageLayer;

const layerRotationTransform = (layer: PageLayer): string => {
  const centerX = layer.x + layer.width / 2;
  const centerY = layer.y + layer.height / 2;

  return `rotate(${layer.rotation} ${centerX} ${centerY})`;
};

const framePresetOptions: PhotoLayer["border"]["framePreset"][] = [
  "none",
  "mat",
  "polaroid",
  "film",
  "paper",
];

const photoHandleLabels: Record<ResizeHandle, string> = {
  n: "Crop from top",
  s: "Crop from bottom",
  e: "Crop from right",
  w: "Crop from left",
  ne: "Scale from top right",
  nw: "Scale from top left",
  se: "Scale from bottom right",
  sw: "Scale from bottom left",
};

const maskShapeOptions: PhotoLayer["mask"]["shape"][] = [
  "rectangle",
  "ellipse",
  "arch",
  "diamond",
  "ticket",
];

const formatFramePreset = (preset: PhotoLayer["border"]["framePreset"]) =>
  preset === "none" ? "None" : preset.charAt(0).toUpperCase() + preset.slice(1);

const formatMaskShape = (shape: PhotoLayer["mask"]["shape"]) =>
  shape.charAt(0).toUpperCase() + shape.slice(1);

export const formatLayerKindLabel = (kind: PageLayer["kind"]): string =>
  kind === "photo"
    ? "Photo"
    : kind === "text"
      ? "Text"
      : kind === "sticker"
        ? "Sticker"
        : "Washi tape";

const nativeBrowserImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const resolveBrowserPreviewHref = (asset: Asset): string | undefined =>
  asset.variants.find(
    (variant) => variant.kind === "preview" && nativeBrowserImageMimeTypes.has(variant.mimeType),
  )?.contentUrl;

const resolveBrowserPhotoHref = (asset: Asset | undefined): string | undefined => {
  if (!asset) {
    return undefined;
  }

  const previewHref = resolveBrowserPreviewHref(asset);

  return nativeBrowserImageMimeTypes.has(asset.mimeType)
    ? (asset.originalContentUrl ?? previewHref ?? asset.thumbnailUrl)
    : (previewHref ?? asset.thumbnailUrl ?? asset.originalContentUrl);
};

export const resolveBrowserWashiTapeHref = (
  assetById: Map<string, Asset>,
  layer: WashiTapeLayer,
): string | undefined =>
  resolveBrowserPhotoHref(
    assetById.get(
      layer.pattern.kind === "customPhoto" ? (layer.pattern.assetId ?? layer.assetId ?? "") : "",
    ),
  );

export type SelectLayerOptions = { additive?: boolean };

const PHOTO_SCALE_MIN = 1;
const PHOTO_SCALE_MAX = 5;
const PHOTO_SCALE_STEP = 0.1;
/** Gap kept between the zoom pill and the photo edges or pan handle; mirrors the CSS `bottom` inset. */
const PHOTO_SCALE_SLIDER_INSET = 10;
/** Mirrors the `.transform-pan-handle` CSS size. */
const PHOTO_PAN_HANDLE_SIZE = 36;

const clampPhotoScale = (value: number): number =>
  Math.min(PHOTO_SCALE_MAX, Math.max(PHOTO_SCALE_MIN, Math.round(value * 10) / 10));

/**
 * The slider is laid out in the photo's rotated box, so a mostly upside-down photo needs the
 * opposite local side to end up physically away from the layer toolbar.
 */
const getPhotoScaleSliderOutsidePlacement = (
  rotationDegrees: number,
  toolbarPlacement: "above" | "below",
): "above" | "below" => {
  const awayFromToolbar = toolbarPlacement === "below" ? "above" : "below";
  if (Math.cos((rotationDegrees * Math.PI) / 180) >= 0) return awayFromToolbar;
  return awayFromToolbar === "above" ? "below" : "above";
};

function PhotoScaleSlider({
  layer,
  outsidePlacement,
  onChange,
}: {
  layer: PhotoLayer;
  /** Side of the frame to use when the photo is too small to hold the slider (opposite the layer toolbar). */
  outsidePlacement: "above" | "below";
  onChange: (scale: number) => void;
}) {
  const scale = layer.photoTransform.scale;
  const sliderRef = useRef<HTMLDivElement>(null);
  const [fitsInside, setFitsInside] = useState(true);
  const commit = (next: number) => {
    const clamped = clampPhotoScale(next);
    if (clamped !== scale) onChange(clamped);
  };

  useLayoutEffect(() => {
    const slider = sliderRef.current;
    const frame = slider?.parentElement;
    if (!slider || !frame) return;
    const updatePlacement = () => {
      const panHandleHalfHeight = PHOTO_PAN_HANDLE_SIZE / 2;
      const frameWidth = frame.clientWidth;
      const frameHeight = frame.clientHeight;
      // Layout sizes (not bounding rects) so the check ignores layer rotation.
      const fitsWidth = slider.offsetWidth + PHOTO_SCALE_SLIDER_INSET * 2 <= frameWidth;
      const fitsHeight =
        frameHeight / 2 + panHandleHalfHeight + PHOTO_SCALE_SLIDER_INSET <=
        frameHeight - PHOTO_SCALE_SLIDER_INSET - slider.offsetHeight;
      setFitsInside(fitsWidth && fitsHeight);
    };
    updatePlacement();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updatePlacement);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="transform-scale-slider"
      data-placement={fitsInside ? "inside" : outsidePlacement}
      ref={sliderRef}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Zoom photo out"
        className="transform-scale-button"
        title="Zoom out"
        disabled={scale <= PHOTO_SCALE_MIN}
        onClick={() => commit(scale - PHOTO_SCALE_STEP)}
      >
        <SubtractRegular />
      </button>
      <input
        aria-label="Photo zoom"
        className="transform-scale-range"
        max={PHOTO_SCALE_MAX}
        min={PHOTO_SCALE_MIN}
        step={PHOTO_SCALE_STEP}
        title={`Zoom ${(scale * 100).toFixed(0)}%`}
        type="range"
        value={scale}
        onChange={(event) => commit(Number(event.currentTarget.value))}
      />
      <button
        type="button"
        aria-label="Zoom photo in"
        className="transform-scale-button"
        title="Zoom in"
        disabled={scale >= PHOTO_SCALE_MAX}
        onClick={() => commit(scale + PHOTO_SCALE_STEP)}
      >
        <AddRegular />
      </button>
    </div>
  );
}

type ActiveGroupTransform = {
  layerIds: string[];
  mode: "move" | "resize" | "rotate";
  pointerId: number;
  startBox: GroupBoundingBox;
  startCenter: CanvasPoint;
  startLayers: PageLayer[];
  startPointer: CanvasPoint;
  startPointerAngle: number;
  handle?: MultiSelectionResizeHandle;
};

export function PageCanvas({
  activeSelectionPanel = null,
  arrangePreview = null,
  assetById,
  document,
  previewLayers = [],
  selectedLayerIds,
  spreadReorderCapabilities,
  onActiveSelectionPanelChange,
  onDeleteLayer,
  onChangeLayer,
  onDropAsset,
  onDropFiles,
  onReorderLayer,
  onSelectPreviewLayer,
  onSelectLayer,
  onTransformEnd,
  onTransformLayer,
  onTransformLayers,
  onTransformLayersEnd,
}: {
  activeSelectionPanel?: SelectionPanel | null;
  arrangePreview?: ArrangeCanvasPreview | null;
  assetById: Map<string, Asset>;
  document: PageDocument;
  previewLayers?: CanvasPreviewLayer[];
  selectedLayerIds: string[];
  spreadReorderCapabilities?: SpreadReorderCapabilities;
  onActiveSelectionPanelChange?: ((panel: SelectionPanel | null) => void) | undefined;
  onDeleteLayer: (layerId: string) => void;
  onChangeLayer?: (layerId: string, update: Partial<PageLayer>) => void;
  onDropAsset?: (assetId: string, canvasPoint: CanvasPoint) => void;
  onDropFiles?: (files: File[], canvasPoint: CanvasPoint) => void;
  onReorderLayer: (layerId: string, command: ReorderLayerCommand) => void;
  onSelectPreviewLayer?: (pageId: string, layerId: string) => void;
  onSelectLayer: (layerId: string | null, options?: SelectLayerOptions) => void;
  onTransformEnd?: (layerId: string, update: Partial<PageLayer> | null) => void;
  onTransformLayer: (layerId: string, update: Partial<PageLayer>) => void;
  onTransformLayers?: (updates: LayerTransformUpdate[]) => void;
  onTransformLayersEnd?: (updates: LayerTransformUpdate[] | null) => void;
}) {
  const svgIdPrefix = useId();
  const canvasRef = useRef<HTMLFieldSetElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renderSurfaceRef = useRef<HTMLDivElement>(null);
  const inlineTextEditorRef = useRef<RichTextEditorHandle | null>(null);
  const textTransformPreviewRef = useRef<{
    group: SVGGElement;
    localGroup: SVGGElement;
    localTransform: string | null;
    outerTransform: string | null;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const [activeTransform, setActiveTransform] = useState<ActiveTransform | null>(null);
  const [activeTransformUpdate, setActiveTransformUpdate] = useState<Partial<PageLayer> | null>(
    null,
  );
  const [activeGroupTransform, setActiveGroupTransform] = useState<ActiveGroupTransform | null>(
    null,
  );
  const [activeGroupTransformUpdates, setActiveGroupTransformUpdates] = useState<
    LayerTransformUpdate[] | null
  >(null);
  const setActiveSelectionPanel = useCallback(
    (next: SelectionPanel | null | ((current: SelectionPanel | null) => SelectionPanel | null)) => {
      if (!onActiveSelectionPanelChange) return;
      const nextValue = typeof next === "function" ? next(activeSelectionPanel) : next;
      if (nextValue !== activeSelectionPanel) onActiveSelectionPanelChange(nextValue);
    },
    [activeSelectionPanel, onActiveSelectionPanelChange],
  );
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null);
  const [panPreviewLayerId, setPanPreviewLayerId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ layerId: string; x: number; y: number } | null>(
    null,
  );
  const [stickerSvgById, setStickerSvgById] = useState<Map<string, StickerSvg>>(new Map());
  const interactiveLayers = useMemo<InteractiveCanvasLayer[]>(
    () => mergeCanvasLayers(document.layers, previewLayers),
    [document.layers, previewLayers],
  );
  const stickerIds = useMemo(
    () => [
      ...new Set(
        interactiveLayers.flatMap(({ layer }) =>
          layer.kind === "sticker" && !isCustomStickerId(layer.stickerId) ? [layer.stickerId] : [],
        ),
      ),
    ],
    [interactiveLayers],
  );
  const renderedDocument = useMemo(
    () => ({
      ...document,
      layers: interactiveLayers
        .map(({ layer }) => layer)
        .filter((layer) => layer.id !== editingTextLayerId),
    }),
    [document, editingTextLayerId, interactiveLayers],
  );
  const displayedInteractiveLayers = useMemo<InteractiveCanvasLayer[]>(() => {
    if (activeGroupTransformUpdates && activeGroupTransform) {
      const updatesById = new Map(
        activeGroupTransformUpdates.map((entry) => [entry.layerId, entry.update]),
      );

      return interactiveLayers.map((interactiveLayer) => {
        if (interactiveLayer.kind !== "document") return interactiveLayer;
        const groupUpdate = updatesById.get(interactiveLayer.layer.id);
        return groupUpdate
          ? {
              ...interactiveLayer,
              layer: applyLayerUpdate(interactiveLayer.layer, groupUpdate),
            }
          : interactiveLayer;
      });
    }

    if (!activeTransformUpdate || !activeTransform) {
      return interactiveLayers;
    }

    return interactiveLayers.map((interactiveLayer) =>
      interactiveLayer.kind === "document" && interactiveLayer.layer.id === activeTransform.layerId
        ? {
            ...interactiveLayer,
            layer: applyLayerUpdate(interactiveLayer.layer, activeTransformUpdate),
          }
        : interactiveLayer,
    );
  }, [
    activeGroupTransform,
    activeGroupTransformUpdates,
    activeTransform,
    activeTransformUpdate,
    interactiveLayers,
  ]);
  const renderedSvg = useMemo(
    () =>
      renderPageDocumentSvg(renderedDocument, {
        idPrefix: svgIdPrefix,
        resolvePhotoHref: (layer) => resolveBrowserPhotoHref(assetById.get(layer.assetId)),
        resolveStickerSvg: (layer) => stickerSvgById.get(layer.stickerId),
        resolveStickerHref: (layer) =>
          isCustomStickerId(layer.stickerId)
            ? `/api/v1/custom-stickers/${layer.stickerId.slice("custom:".length)}/content`
            : null,
        resolveWashiTapeHref: (layer) => resolveBrowserWashiTapeHref(assetById, layer),
        ...(panPreviewLayerId ? { panPreviewLayerIds: new Set([panPreviewLayerId]) } : {}),
      }),
    [assetById, renderedDocument, stickerSvgById, svgIdPrefix, panPreviewLayerId],
  );
  const contextLayerIndex = contextMenu
    ? document.layers.findIndex((layer) => layer.id === contextMenu.layerId)
    : -1;
  const contextLayer = contextLayerIndex >= 0 ? document.layers[contextLayerIndex] : null;
  const contextLayerSpreadCapabilities = contextLayer
    ? spreadReorderCapabilities?.get(contextLayer.id)
    : undefined;
  const canMoveContextUp = contextLayer
    ? (contextLayerSpreadCapabilities?.canMoveUp ?? contextLayerIndex < document.layers.length - 1)
    : false;
  const canMoveContextDown = contextLayer
    ? (contextLayerSpreadCapabilities?.canMoveDown ?? contextLayerIndex > 0)
    : false;
  const primarySelectedLayerId = selectedLayerIds.length === 1 ? selectedLayerIds[0] : null;
  const isMultiSelected = selectedLayerIds.length > 1;
  const selectedLayer =
    displayedInteractiveLayers.find(
      (interactiveLayer) =>
        interactiveLayer.kind === "document" &&
        interactiveLayer.layer.id === primarySelectedLayerId,
    )?.layer ?? null;
  const multiSelectedLayers = useMemo<PageLayer[]>(
    () =>
      isMultiSelected
        ? selectedLayerIds
            .map(
              (layerId) =>
                displayedInteractiveLayers.find(
                  (interactiveLayer) =>
                    interactiveLayer.kind === "document" && interactiveLayer.layer.id === layerId,
                )?.layer,
            )
            .filter((layer): layer is PageLayer => Boolean(layer))
        : [],
    [displayedInteractiveLayers, isMultiSelected, selectedLayerIds],
  );
  const multiSelectionBoundingBox = useMemo(
    () =>
      multiSelectedLayers.length > 0 ? getMultiSelectionBoundingBox(multiSelectedLayers) : null,
    [multiSelectedLayers],
  );
  const selectedLayerLabel = selectedLayer
    ? `${formatLayerKindLabel(selectedLayer.kind)} layer`
    : null;
  const contextLayerLabel = contextLayer
    ? `${formatLayerKindLabel(contextLayer.kind)} layer`
    : null;
  const selectedSelectionFrame = selectedLayer ? getLayerSelectionFrame(selectedLayer) : null;
  const selectedLayerMenuPlacement =
    selectedSelectionFrame && selectedSelectionFrame.y > document.canvas.height * 0.16
      ? "above"
      : "below";
  const selectedPhotoLayer = selectedLayer?.kind === "photo" ? selectedLayer : null;
  const getLayerBoxStyle = (layer: PageLayer): CSSProperties => ({
    left: `${(layer.x / document.canvas.width) * 100}%`,
    top: `${(layer.y / document.canvas.height) * 100}%`,
    width: `${(layer.width / document.canvas.width) * 100}%`,
    height: `${(layer.height / document.canvas.height) * 100}%`,
    transform: `rotate(${layer.rotation}deg)`,
  });
  const getLayerFrameStyle = (layer: PageLayer): CSSProperties => {
    const frame = getLayerSelectionFrame(layer);
    return {
      left: `${(frame.x / document.canvas.width) * 100}%`,
      top: `${(frame.y / document.canvas.height) * 100}%`,
      width: `${(frame.width / document.canvas.width) * 100}%`,
      height: `${(frame.height / document.canvas.height) * 100}%`,
      // Text frames are already measured from the rotated, rendered text.
      transform: layer.kind === "text" ? undefined : `rotate(${layer.rotation}deg)`,
    };
  };
  const selectedLayerMenuHalfWidth = selectedLayer
    ? selectedLayer.kind === "text"
      ? 248
      : selectedLayer.kind === "photo"
        ? 164
        : 68
    : 68;
  const selectedLayerMenuStyle: CSSProperties | undefined = selectedSelectionFrame
    ? {
        left: `clamp(${selectedLayerMenuHalfWidth + 8}px, ${
          ((selectedSelectionFrame.x + selectedSelectionFrame.width / 2) / document.canvas.width) *
          100
        }%, calc(100% - ${selectedLayerMenuHalfWidth + 8}px))`,
        top: `${
          ((selectedLayerMenuPlacement === "above"
            ? selectedSelectionFrame.y
            : selectedSelectionFrame.y + selectedSelectionFrame.height) /
            document.canvas.height) *
          100
        }%`,
      }
    : undefined;
  const closeContextMenu = () => setContextMenu(null);
  const changeLayer = (layerId: string, update: Partial<PageLayer>) =>
    (onChangeLayer ?? onTransformLayer)(layerId, update);
  const restoreTextTransformPreview = useCallback(() => {
    const preview = textTransformPreviewRef.current;

    if (!preview) return;

    if (preview.outerTransform === null) {
      preview.group.removeAttribute("transform");
    } else {
      preview.group.setAttribute("transform", preview.outerTransform);
    }

    if (preview.localTransform === null) {
      preview.localGroup.removeAttribute("transform");
    } else {
      preview.localGroup.setAttribute("transform", preview.localTransform);
    }

    textTransformPreviewRef.current = null;
  }, []);

  useEffect(() => {
    const missingStickerIds = stickerIds.filter((stickerId) => !stickerSvgById.has(stickerId));

    if (missingStickerIds.length === 0) {
      return;
    }

    let isCancelled = false;

    import("@zakka/editor-core/stickers").then(({ getStickerSvg }) => {
      if (isCancelled) {
        return;
      }

      setStickerSvgById((currentStickerSvgs) => {
        const nextStickerSvgs = new Map(currentStickerSvgs);

        for (const stickerId of missingStickerIds) {
          const stickerSvg = getStickerSvg(stickerId);

          if (stickerSvg) {
            nextStickerSvgs.set(stickerId, stickerSvg);
          }
        }

        return nextStickerSvgs;
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [stickerIds, stickerSvgById]);

  useEffect(() => {
    if (activeTransform) setActiveSelectionPanel(null);
  }, [activeTransform, setActiveSelectionPanel]);

  useEffect(() => {
    if (!panPreviewLayerId) return;
    if (panPreviewLayerId !== primarySelectedLayerId || activeTransform) {
      setPanPreviewLayerId(null);
    }
  }, [activeTransform, panPreviewLayerId, primarySelectedLayerId]);

  useEffect(() => {
    if (editingTextLayerId && editingTextLayerId !== primarySelectedLayerId) {
      setEditingTextLayerId(null);
    }
  }, [editingTextLayerId, primarySelectedLayerId]);

  useEffect(() => {
    if (!editingTextLayerId) return;
    if (activeGroupTransform) {
      setEditingTextLayerId(null);
      return;
    }
    // Resizing the box that is being typed into is supported, so only bail out of
    // inline editing for transforms that would move the caret out from under the pointer.
    if (
      activeTransform &&
      (activeTransform.layerId !== editingTextLayerId || activeTransform.mode !== "resize")
    ) {
      setEditingTextLayerId(null);
    }
  }, [activeGroupTransform, activeTransform, editingTextLayerId]);

  useEffect(() => {
    if (!editingTextLayerId) return;
    inlineTextEditorRef.current?.focus({ placeCaretAtEnd: true });
  }, [editingTextLayerId]);

  useLayoutEffect(() => {
    if (
      !activeTransform ||
      activeTransform.mode !== "move" ||
      activeTransform.startLayer.kind !== "text"
    ) {
      restoreTextTransformPreview();
      return;
    }

    const group = [
      ...(renderSurfaceRef.current?.querySelectorAll<SVGGElement>("[data-layer-id]") ?? []),
    ].find((candidateGroup) => candidateGroup.dataset.layerId === activeTransform.layerId);
    const localGroup = group?.querySelector<SVGGElement>('[data-layer-local-transform="true"]');

    if (!group || !localGroup) {
      return;
    }

    const currentPreview = textTransformPreviewRef.current;

    if (
      !currentPreview ||
      currentPreview.group !== group ||
      currentPreview.localGroup !== localGroup
    ) {
      restoreTextTransformPreview();
      textTransformPreviewRef.current = {
        group,
        localGroup,
        localTransform: localGroup.getAttribute("transform"),
        outerTransform: group.getAttribute("transform"),
      };
    }

    const previewLayer = activeTransformUpdate
      ? applyLayerUpdate(activeTransform.startLayer, activeTransformUpdate)
      : activeTransform.startLayer;

    group.setAttribute("transform", layerRotationTransform(previewLayer));
    localGroup.setAttribute("transform", `translate(${previewLayer.x} ${previewLayer.y})`);
  }, [activeTransform, activeTransformUpdate, restoreTextTransformPreview]);

  useLayoutEffect(() => () => restoreTextTransformPreview(), [restoreTextTransformPreview]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeOnPointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    const closeOnViewportChange = () => setContextMenu(null);

    globalThis.document.addEventListener("pointerdown", closeOnPointerDown);
    globalThis.document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);

    return () => {
      globalThis.document.removeEventListener("pointerdown", closeOnPointerDown);
      globalThis.document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [contextMenu]);
  const getCanvasPoint = (event: ReactPointerEvent): CanvasPoint | null => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return null;
    const bounds = canvasElement.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * document.canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * document.canvas.height,
    };
  };
  const startTransform = (
    event: ReactPointerEvent<HTMLElement>,
    layer: PageLayer,
    mode: TransformMode,
    handle?: ResizeHandle,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
    onSelectLayer(layer.id);
    if (layer.locked) return;
    const pointer = getCanvasPoint(event);
    if (!pointer) return;
    const center = getLayerCenter(layer);
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveTransformUpdate(null);
    setActiveTransform({
      center,
      handle,
      layerId: layer.id,
      mode,
      pointerId: event.pointerId,
      startLayer: layer,
      startPointer: pointer,
      startPointerAngle: getAngle(center, pointer),
    });
  };
  const startGroupTransform = (
    event: ReactPointerEvent<HTMLElement>,
    mode: "move" | "resize" | "rotate",
    handle?: MultiSelectionResizeHandle,
  ) => {
    if (event.button !== 0) return;
    if (!multiSelectionBoundingBox || multiSelectedLayers.length === 0) return;
    const movableLayers = multiSelectedLayers.filter((layer) => !layer.locked);
    if (movableLayers.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
    const pointer = getCanvasPoint(event);
    if (!pointer) return;
    const center: CanvasPoint = {
      x: multiSelectionBoundingBox.x + multiSelectionBoundingBox.width / 2,
      y: multiSelectionBoundingBox.y + multiSelectionBoundingBox.height / 2,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveGroupTransformUpdates(null);
    setActiveGroupTransform({
      ...(handle ? { handle } : {}),
      layerIds: movableLayers.map((layer) => layer.id),
      mode,
      pointerId: event.pointerId,
      startBox: multiSelectionBoundingBox,
      startCenter: center,
      startLayers: movableLayers,
      startPointer: pointer,
      startPointerAngle: getAngle(center, pointer),
    });
  };
  const computeGroupUpdates = (
    transform: ActiveGroupTransform,
    pointer: CanvasPoint,
  ): LayerTransformUpdate[] => {
    if (transform.mode === "move") {
      return applyGroupMove(transform.startLayers, {
        x: pointer.x - transform.startPointer.x,
        y: pointer.y - transform.startPointer.y,
      });
    }
    if (transform.mode === "resize" && transform.handle) {
      const { pivot, scale } = getGroupScaleFromHandle(
        transform.handle,
        transform.startBox,
        pointer,
        transform.startPointer,
      );
      return applyGroupScale(transform.startLayers, pivot, scale);
    }
    const angleDelta = normalizeRotation(
      getAngle(transform.startCenter, pointer) - transform.startPointerAngle,
    );
    return applyGroupRotate(transform.startLayers, transform.startCenter, angleDelta);
  };
  const getTransformUpdate = (
    transform: ActiveTransform,
    pointer: CanvasPoint,
  ): Partial<PageLayer> => {
    if (transform.mode === "move") {
      return {
        x: transform.startLayer.x + pointer.x - transform.startPointer.x,
        y: transform.startLayer.y + pointer.y - transform.startPointer.y,
      };
    }
    if (transform.mode === "pan" && transform.startLayer.kind === "photo") {
      const nextOffset = panPhotoLayer(transform.startLayer, pointer, transform.startPointer, {
        offsetX: transform.startLayer.photoTransform.offsetX,
        offsetY: transform.startLayer.photoTransform.offsetY,
      });
      return {
        photoTransform: {
          ...transform.startLayer.photoTransform,
          offsetX: nextOffset.offsetX,
          offsetY: nextOffset.offsetY,
        },
      } as Partial<PageLayer>;
    }
    if (transform.mode === "resize" && transform.handle) {
      // Photos: cardinal handles adjust the crop frame (image stays put), corners
      // uniformly scale the photo. Other layer kinds keep the original free resize.
      if (transform.startLayer.kind === "photo") {
        const isCornerHandle = transform.handle.length === 2;
        if (isCornerHandle) {
          return scaleLayerFromCornerHandle(
            transform.startLayer,
            transform.handle,
            pointer,
            transform.startPointer,
          );
        }
        return cropPhotoLayerFromHandle(
          transform.startLayer,
          transform.handle,
          pointer,
          transform.startPointer,
        ) as Partial<PageLayer>;
      }
      return resizeLayerFromHandle(
        transform.startLayer,
        transform.handle,
        pointer,
        transform.startPointer,
      );
    }

    return {
      rotation: normalizeRotation(
        transform.startLayer.rotation +
          getAngle(transform.center, pointer) -
          transform.startPointerAngle,
      ),
    };
  };
  const transformLayer = (event: ReactPointerEvent<HTMLElement>) => {
    if (activeGroupTransform && event.pointerId === activeGroupTransform.pointerId) {
      const pointer = getCanvasPoint(event);
      if (!pointer) return;
      event.preventDefault();
      const updates = computeGroupUpdates(activeGroupTransform, pointer);
      if (onTransformLayers) {
        onTransformLayers(updates);
      } else {
        setActiveGroupTransformUpdates(updates);
      }
      return;
    }
    if (!activeTransform || event.pointerId !== activeTransform.pointerId) return;
    const pointer = getCanvasPoint(event);
    if (!pointer) return;
    event.preventDefault();
    const update = getTransformUpdate(activeTransform, pointer);

    if (activeTransform.mode === "move" && activeTransform.startLayer.kind === "text") {
      setActiveTransformUpdate(update);
      return;
    }

    onTransformLayer(activeTransform.layerId, update);
  };
  const stopTransform = (event: ReactPointerEvent<HTMLElement>) => {
    if (activeGroupTransform && event.pointerId === activeGroupTransform.pointerId) {
      const groupTransform = activeGroupTransform;
      const pointer = getCanvasPoint(event);
      const updates = pointer ? computeGroupUpdates(groupTransform, pointer) : null;
      setActiveGroupTransform(null);
      setActiveGroupTransformUpdates(null);
      suppressNextClickRef.current = true;
      if (onTransformLayersEnd) {
        onTransformLayersEnd(updates);
        return;
      }
      if (updates && onTransformLayers) {
        onTransformLayers(updates);
      }
      return;
    }
    if (activeTransform?.pointerId !== event.pointerId) return;
    const transform = activeTransform;
    const pointer = getCanvasPoint(event);
    const update = pointer ? getTransformUpdate(transform, pointer) : null;

    setActiveTransform(null);
    setActiveTransformUpdate(null);
    suppressNextClickRef.current = true;

    if (editingTextLayerId === transform.layerId) {
      inlineTextEditorRef.current?.focus();
    }

    if (onTransformEnd) {
      onTransformEnd(transform.layerId, update);
      return;
    }

    if (update) {
      onTransformLayer(transform.layerId, update);
    }
  };
  const openContextMenu = (event: ReactMouseEvent, layer: PageLayer) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveTransform(null);
    onSelectLayer(layer.id);

    const menuWidth = 204;
    const menuHeight = 226;
    const margin = 8;
    setContextMenu({
      layerId: layer.id,
      x: Math.max(margin, Math.min(event.clientX, window.innerWidth - menuWidth - margin)),
      y: Math.max(margin, Math.min(event.clientY, window.innerHeight - menuHeight - margin)),
    });
  };
  const selectPreviewLayer = (
    event: ReactPointerEvent<HTMLElement>,
    previewLayer: CanvasPreviewLayer,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
    setActiveSelectionPanel(null);
    onSelectPreviewLayer?.(previewLayer.sourcePageId, previewLayer.layer.id);
  };
  const runContextAction = (action: () => void) => {
    action();
    closeContextMenu();
  };
  const toggleSelectionPanel = (panel: SelectionPanel) => {
    closeContextMenu();
    setEditingTextLayerId(null);
    setActiveSelectionPanel((currentPanel) => (currentPanel === panel ? null : panel));
  };
  const openSelectionPanel = (panel: SelectionPanel) => {
    closeContextMenu();
    setEditingTextLayerId(null);
    setActiveSelectionPanel(panel);
  };
  const openLayerEditor = (event: ReactMouseEvent, layer: PageLayer) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveTransform(null);
    closeContextMenu();
    onSelectLayer(layer.id);
    setActiveSelectionPanel("edit");
  };
  const beginInlineTextEdit = (layer: PageLayer) => {
    if (layer.kind !== "text" || layer.locked) return false;
    setActiveTransform(null);
    closeContextMenu();
    setActiveSelectionPanel(null);
    onSelectLayer(layer.id);
    setEditingTextLayerId(layer.id);
    return true;
  };
  const updateSelectedPhotoBorder = (update: Partial<PhotoLayer["border"]>) => {
    if (!selectedLayer || selectedLayer.kind !== "photo") return;

    changeLayer(selectedLayer.id, {
      border: { ...selectedLayer.border, ...update },
    } as Partial<PageLayer>);
  };
  const updateSelectedPhotoMask = (update: Partial<PhotoLayer["mask"]>) => {
    if (!selectedLayer || selectedLayer.kind !== "photo") return;

    changeLayer(selectedLayer.id, {
      mask: { ...selectedLayer.mask, ...update },
    } as Partial<PageLayer>);
  };
  const scaleSelectedPhotoToCanvas = (axis: "height" | "width") => {
    if (!selectedLayer || selectedLayer.kind !== "photo") return;

    const aspectRatio = selectedLayer.width / selectedLayer.height;
    const size =
      axis === "height"
        ? {
            height: document.canvas.height,
            width: document.canvas.height * aspectRatio,
          }
        : {
            height: document.canvas.width / aspectRatio,
            width: document.canvas.width,
          };

    changeLayer(selectedLayer.id, {
      ...size,
      x: (document.canvas.width - size.width) / 2,
      y: (document.canvas.height - size.height) / 2,
    } as Partial<PageLayer>);
  };
  const clearSelection = (event: ReactPointerEvent<HTMLFieldSetElement>) => {
    if (event.button !== 0 || activeTransform || activeGroupTransform) return;
    if (contextMenuRef.current?.contains(event.target as Node)) return;
    closeContextMenu();
    setActiveSelectionPanel(null);
    onSelectLayer(null);
  };

  const [isAssetDragOver, setIsAssetDragOver] = useState(false);
  const dragOverDepthRef = useRef(0);
  const hasAssetDragPayload = (event: ReactDragEvent<HTMLFieldSetElement>): boolean =>
    Array.from(event.dataTransfer.types).includes(assetDragMimeType);
  const hasFileDragPayload = (event: ReactDragEvent<HTMLFieldSetElement>): boolean =>
    Array.from(event.dataTransfer.types).includes("Files");
  const isAcceptedDragPayload = (event: ReactDragEvent<HTMLFieldSetElement>): boolean =>
    (Boolean(onDropAsset) && hasAssetDragPayload(event)) ||
    (Boolean(onDropFiles) && hasFileDragPayload(event));
  const getDropCanvasPoint = (event: ReactDragEvent<HTMLFieldSetElement>): CanvasPoint | null => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return null;
    const bounds = canvasElement.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * document.canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * document.canvas.height,
    };
  };
  const handleAssetDragEnter = (event: ReactDragEvent<HTMLFieldSetElement>) => {
    if (!isAcceptedDragPayload(event)) return;
    dragOverDepthRef.current += 1;
    setIsAssetDragOver(true);
  };
  const handleAssetDragOver = (event: ReactDragEvent<HTMLFieldSetElement>) => {
    if (!isAcceptedDragPayload(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const handleAssetDragLeave = (event: ReactDragEvent<HTMLFieldSetElement>) => {
    if (!isAcceptedDragPayload(event)) return;
    dragOverDepthRef.current = Math.max(0, dragOverDepthRef.current - 1);
    if (dragOverDepthRef.current === 0) setIsAssetDragOver(false);
  };
  const handleAssetDrop = (event: ReactDragEvent<HTMLFieldSetElement>) => {
    if (!isAcceptedDragPayload(event)) return;
    event.preventDefault();
    dragOverDepthRef.current = 0;
    setIsAssetDragOver(false);
    const point = getDropCanvasPoint(event);
    if (!point) return;
    if (onDropFiles && hasFileDragPayload(event)) {
      const files = Array.from(event.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length > 0) {
        onDropFiles(files, point);
        return;
      }
    }
    if (!onDropAsset) return;
    const assetId =
      event.dataTransfer.getData(assetDragMimeType) || event.dataTransfer.getData("text/plain");
    if (!assetId) return;
    onDropAsset(assetId, point);
  };

  return (
    <fieldset
      ref={canvasRef}
      className="editor-canvas"
      data-asset-drop-target={isAssetDragOver || undefined}
      style={{
        aspectRatio: `${document.canvas.width} / ${document.canvas.height}`,
        background: document.canvas.backgroundColor,
        maxWidth: `min(760px, calc(72vh * ${document.canvas.width / document.canvas.height}))`,
      }}
      onPointerCancel={stopTransform}
      onPointerDown={clearSelection}
      onPointerMove={transformLayer}
      onPointerUp={stopTransform}
      onDragEnter={handleAssetDragEnter}
      onDragOver={handleAssetDragOver}
      onDragLeave={handleAssetDragLeave}
      onDrop={handleAssetDrop}
      onContextMenu={(event) => {
        event.preventDefault();
        closeContextMenu();
      }}
    >
      <legend className="visually-hidden">Editable page canvas</legend>
      <div
        className="editor-render-surface"
        /* biome-ignore lint/security/noDangerouslySetInnerHtml: Generated from validated page schema and escaped by editor-core. */
        dangerouslySetInnerHTML={{ __html: renderedSvg }}
        ref={renderSurfaceRef}
      />
      {/* Bounds layer hitboxes and their controls to one stacking tier below the toolbar and menus. */}
      <div className="canvas-layer-stack">
        {displayedInteractiveLayers.map((interactiveLayer, layerIndex) => {
          const { layer } = interactiveLayer;
          const isPreview = interactiveLayer.kind === "preview";
          const isSelected = !isPreview && layer.id === primarySelectedLayerId;
          const isGroupSelected =
            !isPreview && isMultiSelected && selectedLayerIds.includes(layer.id);
          const layerStyle: CSSProperties = {
            ...getLayerBoxStyle(layer),
            zIndex: layerIndex + 1,
            opacity: layer.opacity,
          };
          const selectionFrame = getLayerSelectionFrame(layer);
          const selectionFrameStyle: CSSProperties = {
            left: `${((selectionFrame.x - layer.x) / layer.width) * 100}%`,
            top: `${((selectionFrame.y - layer.y) / layer.height) * 100}%`,
            width: `${(selectionFrame.width / layer.width) * 100}%`,
            height: `${(selectionFrame.height / layer.height) * 100}%`,
            transform: `rotate(${selectionFrame.rotation}deg)`,
          };
          const layerLabel = `${formatLayerKindLabel(layer.kind)} layer`;
          const isInlineEditingText = editingTextLayerId === layer.id && layer.kind === "text";
          return (
            <div
              key={isPreview ? `${interactiveLayer.sourcePageId}:${layer.id}` : layer.id}
              className="canvas-layer"
              data-kind={layer.kind}
              data-layer-id={layer.id}
              data-locked={layer.locked}
              data-preview={isPreview}
              data-selected={isSelected}
              data-group-selected={isGroupSelected}
              data-transforming={
                activeTransform?.layerId === layer.id ||
                activeGroupTransform?.layerIds.includes(layer.id)
              }
              style={layerStyle}
            >
              <button
                type="button"
                aria-label={`${layerLabel}${isPreview ? " from adjacent page" : ""}`}
                className="canvas-layer-hitbox"
                onClick={(event) => {
                  if (interactiveLayer.kind === "preview") {
                    onSelectPreviewLayer?.(interactiveLayer.sourcePageId, layer.id);
                    return;
                  }

                  if (suppressNextClickRef.current) {
                    suppressNextClickRef.current = false;
                    return;
                  }

                  if (event.shiftKey && event.detail > 0) {
                    return;
                  }

                  onSelectLayer(layer.id, { additive: event.shiftKey });
                }}
                onContextMenu={(event) => {
                  if (interactiveLayer.kind === "preview") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeContextMenu();
                    onSelectPreviewLayer?.(interactiveLayer.sourcePageId, layer.id);
                    return;
                  }

                  openContextMenu(event, layer);
                }}
                onDoubleClick={(event) => {
                  if (interactiveLayer.kind === "preview") return;
                  if (layer.kind === "text" && !layer.locked) {
                    event.preventDefault();
                    event.stopPropagation();
                    beginInlineTextEdit(layer);
                    return;
                  }
                  openLayerEditor(event, layer);
                }}
                onPointerDown={(event) => {
                  if (interactiveLayer.kind === "preview") {
                    selectPreviewLayer(event, interactiveLayer);
                    return;
                  }

                  if (event.shiftKey) {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    closeContextMenu();
                    onSelectLayer(layer.id, { additive: true });
                    return;
                  }

                  if (isMultiSelected && selectedLayerIds.includes(layer.id)) {
                    startGroupTransform(event, "move");
                    return;
                  }

                  startTransform(event, layer, "move");
                }}
              />
              <div className="canvas-selection-frame" style={selectionFrameStyle}>
                <span className="canvas-layer-content" />
                {isSelected && !layer.locked ? (
                  <>
                    {isInlineEditingText ? null : (
                      <button
                        type="button"
                        aria-label="Rotate layer"
                        className="transform-rotate-handle"
                        title="Rotate"
                        onPointerDown={(event) => startTransform(event, layer, "rotate")}
                      >
                        <ArrowClockwiseRegular />
                      </button>
                    )}
                    {resizeHandles.map(({ handle, label }) => {
                      const photoLabel = layer.kind === "photo" ? photoHandleLabels[handle] : null;
                      const handleLabel = photoLabel ?? label;
                      return (
                        <button
                          type="button"
                          aria-label={handleLabel}
                          className="transform-resize-handle"
                          data-handle={handle}
                          data-kind={layer.kind}
                          data-role={handle.length === 2 ? "scale" : "crop"}
                          key={handle}
                          title={handleLabel}
                          onPointerDown={(event) => startTransform(event, layer, "resize", handle)}
                        />
                      );
                    })}
                    {layer.kind === "photo" ? (
                      <button
                        type="button"
                        aria-label="Click and drag to adjust photo"
                        className="transform-pan-handle"
                        title="Click and drag to adjust photo"
                        onPointerDown={(event) => {
                          setPanPreviewLayerId(null);
                          startTransform(event, layer, "pan");
                        }}
                        onPointerEnter={() => setPanPreviewLayerId(layer.id)}
                        onPointerLeave={() => {
                          setPanPreviewLayerId((current) =>
                            current === layer.id ? null : current,
                          );
                        }}
                        onFocus={() => setPanPreviewLayerId(layer.id)}
                        onBlur={() => {
                          setPanPreviewLayerId((current) =>
                            current === layer.id ? null : current,
                          );
                        }}
                      >
                        <HandLeftRegular />
                      </button>
                    ) : null}
                  </>
                ) : null}
                {isInlineEditingText ? (
                  <RichTextEditor
                    ref={inlineTextEditorRef}
                    ariaLabel="Edit text"
                    className="canvas-inline-text-editor"
                    spellCheck
                    value={layer.text}
                    style={{
                      color: layer.color,
                      fontFamily: `"${layer.fontFamily}", sans-serif`,
                      fontSize: `calc(${layer.fontSize / document.canvas.width} * 100cqi)`,
                      textAlign: layer.align,
                    }}
                    onBlur={(event) => {
                      const next = event.relatedTarget as Node | null;
                      if (next && canvasRef.current?.contains(next)) return;
                      setEditingTextLayerId(null);
                    }}
                    onChange={(text) =>
                      changeLayer(layer.id, {
                        text,
                      } as Partial<PageLayer>)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        setEditingTextLayerId(null);
                      }
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
        {selectedPhotoLayer && !selectedPhotoLayer.locked ? (
          // Rendered above every layer so neighbouring hitboxes can't steal clicks when the slider
          // sits outside a small photo; the box mirrors the layer's geometry and rotation.
          <div
            className="canvas-layer-controls"
            data-layer-id={selectedPhotoLayer.id}
            style={{
              ...getLayerBoxStyle(selectedPhotoLayer),
              zIndex: displayedInteractiveLayers.length + 1,
              opacity: selectedPhotoLayer.opacity,
            }}
          >
            <PhotoScaleSlider
              layer={selectedPhotoLayer}
              outsidePlacement={getPhotoScaleSliderOutsidePlacement(
                selectedPhotoLayer.rotation,
                selectedLayerMenuPlacement,
              )}
              onChange={(scale) => {
                const layer = selectedPhotoLayer;
                const nextPhotoTransform = { ...layer.photoTransform, scale };
                const clampedOffset = clampPhotoPanOffset(
                  { ...layer, photoTransform: nextPhotoTransform },
                  {
                    offsetX: layer.photoTransform.offsetX,
                    offsetY: layer.photoTransform.offsetY,
                  },
                );
                changeLayer(layer.id, {
                  photoTransform: { ...nextPhotoTransform, ...clampedOffset },
                } as Partial<PageLayer>);
              }}
            />
          </div>
        ) : null}
      </div>
      {arrangePreview && !activeTransform && !activeGroupTransform ? (
        <div className="canvas-arrange-preview" aria-hidden="true" data-testid="arrange-preview">
          {arrangePreview.ghosts.map((layer) => (
            <div
              className="canvas-arrange-ghost"
              data-layer-id={layer.id}
              key={layer.id}
              style={getLayerFrameStyle(layer)}
            />
          ))}
          {arrangePreview.anchorLayer ? (
            <div
              className="canvas-arrange-anchor"
              data-layer-id={arrangePreview.anchorLayer.id}
              style={getLayerFrameStyle(arrangePreview.anchorLayer)}
            >
              {arrangePreview.anchorLabel ? (
                <span className="canvas-arrange-anchor-badge">{arrangePreview.anchorLabel}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {isMultiSelected && multiSelectionBoundingBox ? (
        <div
          className="canvas-group-selection"
          data-transforming={Boolean(activeGroupTransform)}
          style={{
            left: `${(multiSelectionBoundingBox.x / document.canvas.width) * 100}%`,
            top: `${(multiSelectionBoundingBox.y / document.canvas.height) * 100}%`,
            width: `${(multiSelectionBoundingBox.width / document.canvas.width) * 100}%`,
            height: `${(multiSelectionBoundingBox.height / document.canvas.height) * 100}%`,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Rotate selection"
            className="transform-rotate-handle"
            title="Rotate"
            onPointerDown={(event) => startGroupTransform(event, "rotate")}
          >
            <ArrowClockwiseRegular />
          </button>
          {multiSelectionResizeHandles.map(({ handle, label }) => (
            <button
              type="button"
              aria-label={label}
              className="transform-resize-handle"
              data-handle={handle}
              key={handle}
              title={label}
              onPointerDown={(event) => startGroupTransform(event, "resize", handle)}
            />
          ))}
        </div>
      ) : null}
      {selectedLayer && selectedLayerMenuStyle && !activeTransform ? (
        <div
          className="selected-layer-tools"
          data-placement={selectedLayerMenuPlacement}
          style={selectedLayerMenuStyle}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div
            aria-label={`${selectedLayerLabel} actions`}
            className="selected-layer-action-bar"
            role="toolbar"
          >
            {selectedLayer.kind === "photo" ? (
              <button
                type="button"
                aria-label="Frame photo"
                aria-pressed={activeSelectionPanel === "frame"}
                title="Frame"
                onClick={() => toggleSelectionPanel("frame")}
              >
                <ImageBorderRegular />
                <span>Frame</span>
              </button>
            ) : null}
            {selectedLayer.kind === "photo" ? (
              <button
                type="button"
                aria-label="Scale photo to full page height"
                title="Full height"
                onClick={() => scaleSelectedPhotoToCanvas("height")}
              >
                <ArrowAutofitHeightRegular />
                <span>Height</span>
              </button>
            ) : null}
            {selectedLayer.kind === "photo" ? (
              <button
                type="button"
                aria-label="Scale photo to full page width"
                title="Full width"
                onClick={() => scaleSelectedPhotoToCanvas("width")}
              >
                <ArrowAutofitWidthRegular />
                <span>Width</span>
              </button>
            ) : null}
            {selectedLayer.kind === "text" ? (
              <button
                type="button"
                aria-label="Type text"
                aria-pressed={editingTextLayerId === selectedLayer.id}
                title="Type"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (editingTextLayerId === selectedLayer.id) {
                    setEditingTextLayerId(null);
                  } else {
                    beginInlineTextEdit(selectedLayer);
                  }
                }}
              >
                <TextTRegular />
                <span>Type</span>
              </button>
            ) : null}
            {selectedLayer.kind === "text" ? (
              <label
                className="selected-layer-font-control"
                htmlFor={`selected-layer-font-${selectedLayer.id}`}
              >
                <span className="visually-hidden">Font</span>
                <FontFamilySelect
                  compact
                  id={`selected-layer-font-${selectedLayer.id}`}
                  value={selectedLayer.fontFamily}
                  onChange={(fontFamily) =>
                    changeLayer(selectedLayer.id, {
                      fontFamily,
                    } as Partial<PageLayer>)
                  }
                />
              </label>
            ) : null}
            {selectedLayer.kind === "text" ? (
              <TextAlignmentControl
                compact
                className="selected-layer-align-control"
                value={selectedLayer.align}
                onChange={(align) =>
                  changeLayer(selectedLayer.id, {
                    align,
                  } as Partial<PageLayer>)
                }
              />
            ) : null}
            <button
              type="button"
              aria-label="Delete layer"
              className="danger-action"
              title="Delete"
              onClick={() => onDeleteLayer(selectedLayer.id)}
            >
              <DeleteRegular />
              <span>Delete</span>
            </button>
          </div>
          {activeSelectionPanel === "frame" && selectedLayer.kind === "photo" ? (
            <div
              className="selected-layer-popover frame-popover"
              role="dialog"
              aria-label="Frame photo"
            >
              <fieldset className="frame-preset-grid">
                <legend className="visually-hidden">Frame preset</legend>
                {framePresetOptions.map((preset) => (
                  <button
                    type="button"
                    aria-pressed={selectedLayer.border.framePreset === preset}
                    key={preset}
                    onClick={() => updateSelectedPhotoBorder({ framePreset: preset })}
                  >
                    {formatFramePreset(preset)}
                  </button>
                ))}
              </fieldset>
              <label className="frame-popover-range">
                <span>Width</span>
                <input
                  max={160}
                  min={0}
                  type="range"
                  value={selectedLayer.border.width}
                  onChange={(event) =>
                    updateSelectedPhotoBorder({ width: Number(event.currentTarget.value) })
                  }
                />
              </label>
              <div className="frame-popover-field-row">
                <label>
                  <span>Color</span>
                  <input
                    type="color"
                    value={selectedLayer.border.color}
                    onChange={(event) =>
                      updateSelectedPhotoBorder({ color: event.currentTarget.value })
                    }
                  />
                </label>
                <label>
                  <span>Mask</span>
                  <select
                    value={selectedLayer.mask.shape}
                    onChange={(event) =>
                      updateSelectedPhotoMask({
                        shape: event.currentTarget.value as PhotoLayer["mask"]["shape"],
                      })
                    }
                  >
                    {maskShapeOptions.map((shape) => (
                      <option value={shape} key={shape}>
                        {formatMaskShape(shape)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {contextMenu && contextLayer ? (
        <div
          ref={contextMenuRef}
          aria-label={`${contextLayerLabel} actions`}
          className="layer-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => openSelectionPanel("edit")}>
            <EditRegular />
            <span>Edit</span>
          </button>
          <button
            type="button"
            disabled={!canMoveContextUp}
            role="menuitem"
            onClick={() => runContextAction(() => onReorderLayer(contextLayer.id, "top"))}
          >
            <ArrowUpRegular />
            <span>Move to top</span>
          </button>
          <button
            type="button"
            disabled={!canMoveContextDown}
            role="menuitem"
            onClick={() => runContextAction(() => onReorderLayer(contextLayer.id, "bottom"))}
          >
            <ArrowDownRegular />
            <span>Move to bottom</span>
          </button>
          <button
            type="button"
            disabled={!canMoveContextUp}
            role="menuitem"
            onClick={() => runContextAction(() => onReorderLayer(contextLayer.id, "up"))}
          >
            <ArrowUpRegular />
            <span>Move up</span>
          </button>
          <button
            type="button"
            disabled={!canMoveContextDown}
            role="menuitem"
            onClick={() => runContextAction(() => onReorderLayer(contextLayer.id, "down"))}
          >
            <ArrowDownRegular />
            <span>Move down</span>
          </button>
          <button
            type="button"
            className="danger-menuitem"
            role="menuitem"
            onClick={() => runContextAction(() => onDeleteLayer(contextLayer.id))}
          >
            <DeleteRegular />
            <span>Delete</span>
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
