import { Button, Portal, Switch } from "@fluentui/react-components";
import {
  AddRegular,
  ArrowResetRegular,
  ArrowRotateClockwiseRegular,
  DismissRegular,
  FlipHorizontalRegular,
  FlipVerticalRegular,
  SubtractRegular,
} from "@fluentui/react-icons";
import {
  createPageDocument,
  createPhotoLayer,
  type PhotoLayer,
  renderPageDocumentSvg,
  resetPhotoLayerEdits,
} from "@zakka/editor-core";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  SyntheticEvent,
} from "react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PhotoAdjustmentSlider, photoAdjustments } from "./PhotoControls";
import {
  analyzePhotoTones,
  getAutoEnhanceAdjustments,
  type PhotoAdjustmentValues,
} from "./photoAutoEnhance";
import {
  flipPhotoTransform,
  getPhotoImagePlacement,
  getPhotoMinimumScale,
  normalizePhotoRotation,
  PHOTO_EDITOR_SCALE_MAX,
  type PhotoTransform,
  panPhotoTransform,
  rotatePhotoTransform,
  zoomPhotoTransform,
} from "./photoEditorGeometry";

export type PhotoEditorUpdate = Pick<PhotoLayer, "filter" | "photoTransform">;

type PhotoFilterPreset = PhotoLayer["filter"]["preset"];

const photoFilterOptions: Array<{ preset: PhotoFilterPreset; label: string }> = [
  { preset: "none", label: "Original" },
  { preset: "warm", label: "Warm" },
  { preset: "cool", label: "Cool" },
  { preset: "mono", label: "Mono" },
  { preset: "fade", label: "Fade" },
  { preset: "sepia", label: "Sepia" },
];

/** Used when the photo's pixels can't be read (for example a cross-origin image). */
const fallbackAutoEnhance: PhotoAdjustmentValues = {
  exposure: 0,
  brightness: 1.05,
  contrast: 1.1,
  saturation: 1.1,
  shadows: 0.1,
  highlights: -0.05,
};

const ZOOM_BUTTON_STEP = 0.1;
const THUMBNAIL_SIZE = 320;
const MIN_RENDER_CANVAS = 320;
const MAX_RENDER_CANVAS = 10000;

const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

const pickAdjustments = (filter: PhotoLayer["filter"]): PhotoAdjustmentValues => ({
  exposure: filter.exposure,
  brightness: filter.brightness,
  contrast: filter.contrast,
  saturation: filter.saturation,
  shadows: filter.shadows,
  highlights: filter.highlights,
});

const isSameEdit = (a: PhotoEditorUpdate, b: PhotoEditorUpdate) =>
  JSON.stringify([a.photoTransform, a.filter]) === JSON.stringify([b.photoTransform, b.filter]);

function PhotoFilterThumbnail({
  filter,
  href,
  idPrefix,
}: {
  filter: PhotoLayer["filter"];
  href: string;
  idPrefix: string;
}) {
  const svg = useMemo(
    () =>
      renderPageDocumentSvg(
        createPageDocument({
          canvas: { width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE },
          layers: [
            createPhotoLayer({
              assetId: "thumbnail",
              filter,
              height: THUMBNAIL_SIZE,
              id: "thumbnail",
              width: THUMBNAIL_SIZE,
              x: 0,
              y: 0,
            }),
          ],
        }),
        { idPrefix, includeBackground: false, resolvePhotoHref: () => href },
      ),
    [filter, href, idPrefix],
  );

  return (
    <span
      aria-hidden="true"
      className="photo-editor-filter-preview"
      /* biome-ignore lint/security/noDangerouslySetInnerHtml: Generated from validated page schema and escaped by editor-core. */
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * Full-screen editor for a placed photo: drag to reposition inside the frame, zoom, rotate, flip,
 * and pick filters or tone adjustments. Edits stay in a draft until Done, which
 * reports a single update so the change is one undo step.
 */
export function PhotoEditorModal({
  href,
  layer,
  onApply,
  onCancel,
}: {
  href: string;
  layer: PhotoLayer;
  onApply: (update: PhotoEditorUpdate) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const svgIdPrefix = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    start: PhotoTransform;
    x: number;
    y: number;
  } | null>(null);
  const [photoTransform, setPhotoTransform] = useState(layer.photoTransform);
  const [filter, setFilter] = useState(layer.filter);
  const [autoEnhanceBaseline, setAutoEnhanceBaseline] = useState<PhotoAdjustmentValues | null>(
    null,
  );
  const [isAnalyzing, setAnalyzing] = useState(false);
  const [isDragging, setDragging] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const draftLayer = useMemo<PhotoLayer>(
    () => ({ ...layer, filter, photoTransform }),
    [filter, layer, photoTransform],
  );
  const stageLayer = useMemo<PhotoLayer>(
    () => ({
      ...draftLayer,
      opacity: 1,
      rotation: 0,
      shadow: { ...draftLayer.shadow, enabled: false },
      x: 0,
      y: 0,
    }),
    [draftLayer],
  );
  const renderCanvas = {
    width: Math.min(MAX_RENDER_CANVAS, Math.max(MIN_RENDER_CANVAS, Math.ceil(layer.width))),
    height: Math.min(MAX_RENDER_CANVAS, Math.max(MIN_RENDER_CANVAS, Math.ceil(layer.height))),
  };
  const stageSvg = useMemo(
    () =>
      renderPageDocumentSvg(
        createPageDocument({
          canvas: { width: renderCanvas.width, height: renderCanvas.height },
          layers: [stageLayer],
        }),
        { idPrefix: `${svgIdPrefix}stage`, includeBackground: false, resolvePhotoHref: () => href },
      ),
    [href, renderCanvas.height, renderCanvas.width, stageLayer, svgIdPrefix],
  );
  const placement = getPhotoImagePlacement(stageLayer);
  const minimumScale = getPhotoMinimumScale(draftLayer);
  const filterPreviews = useMemo(
    () =>
      photoFilterOptions.map((option) => ({
        ...option,
        filter: { ...filter, preset: option.preset },
      })),
    [filter],
  );

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const measure = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    dialogRef.current?.focus();

    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  const padding = Math.min(96, Math.max(32, Math.min(stageSize.width, stageSize.height) * 0.1));
  const pixelsPerUnit = Math.max(
    0,
    Math.min(
      (stageSize.width - padding * 2) / layer.width,
      (stageSize.height - padding * 2) / layer.height,
    ),
  );
  const frameWidth = layer.width * pixelsPerUnit;
  const frameHeight = layer.height * pixelsPerUnit;

  const updateAdjustments = (update: Partial<PhotoAdjustmentValues>) => {
    // Hand-tuning takes over from auto enhance and keeps the values the user sees.
    setAutoEnhanceBaseline(null);
    setFilter((current) => ({ ...current, ...update }));
  };
  const zoomTo = (scale: number) =>
    setPhotoTransform((current) => zoomPhotoTransform(draftLayer, current, scale));

  const toggleAutoEnhance = async (enabled: boolean) => {
    if (!enabled) {
      if (autoEnhanceBaseline) {
        const baseline = autoEnhanceBaseline;
        setFilter((current) => ({ ...current, ...baseline }));
      }
      setAutoEnhanceBaseline(null);
      return;
    }

    setAnalyzing(true);
    const stats = await analyzePhotoTones(href);
    setAnalyzing(false);
    setAutoEnhanceBaseline(pickAdjustments(filter));
    setFilter((current) => ({
      ...current,
      ...(stats ? getAutoEnhanceAdjustments(stats) : fallbackAutoEnhance),
    }));
  };

  const reset = () => {
    const defaults = resetPhotoLayerEdits(layer);
    setAutoEnhanceBaseline(null);
    setPhotoTransform(defaults.photoTransform);
    setFilter(defaults.filter);
  };
  const rotateQuarterTurn = () =>
    setPhotoTransform((current) =>
      rotatePhotoTransform(draftLayer, current, normalizePhotoRotation(current.rotation + 90)),
    );

  const done = () => {
    const update = { filter, photoTransform };
    if (isSameEdit(update, layer)) {
      onCancel();
      return;
    }
    onApply(update);
  };

  const handleStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || pixelsPerUnit <= 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      start: photoTransform,
      x: event.clientX,
      y: event.clientY,
    };
    setDragging(true);
  };
  const handleStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPhotoTransform(
      panPhotoTransform(
        draftLayer,
        drag.start,
        (event.clientX - drag.x) / pixelsPerUnit,
        (event.clientY - drag.y) / pixelsPerUnit,
      ),
    );
  };
  const endStageDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const handleStageWheel = (event: ReactWheelEvent<HTMLDivElement>) =>
    zoomTo(photoTransform.scale * Math.exp(-event.deltaY * 0.0015));
  const handleStageKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = (event.shiftKey ? 0.1 : 0.02) * Math.min(layer.width, layer.height);
    const moves: Record<string, [number, number]> = {
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
    };
    const move = moves[event.key];

    if (move) {
      event.preventDefault();
      setPhotoTransform((current) => panPhotoTransform(draftLayer, current, move[0], move[1]));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomTo(photoTransform.scale + ZOOM_BUTTON_STEP);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomTo(photoTransform.scale - ZOOM_BUTTON_STEP);
    }
  };

  return (
    <Portal>
      {/* Stop events here so the canvas and editor shortcuts behind the dialog never see them. */}
      <div
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className="photo-editor-modal"
        role="dialog"
        tabIndex={-1}
        onClick={stopPropagation}
        onContextMenu={stopPropagation}
        onDoubleClick={stopPropagation}
        onDragOver={stopPropagation}
        onDrop={stopPropagation}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onPointerDown={stopPropagation}
        onPointerMove={stopPropagation}
        onPointerUp={stopPropagation}
      >
        <div className="photo-editor-workspace">
          <div
            ref={stageRef}
            aria-label="Photo position. Drag or use the arrow keys to move the photo in its frame."
            className="photo-editor-stage"
            data-dragging={isDragging}
            role="application"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the stage is a keyboard-operable pan surface.
            tabIndex={0}
            onKeyDown={handleStageKeyDown}
            onLostPointerCapture={endStageDrag}
            onPointerCancel={endStageDrag}
            onPointerDown={handleStagePointerDown}
            onPointerMove={handleStagePointerMove}
            onPointerUp={endStageDrag}
            onWheel={handleStageWheel}
          >
            {pixelsPerUnit > 0 ? (
              <div
                className="photo-editor-frame"
                style={{
                  height: frameHeight,
                  left: (stageSize.width - frameWidth) / 2,
                  top: (stageSize.height - frameHeight) / 2,
                  width: frameWidth,
                }}
              >
                <svg
                  aria-hidden="true"
                  className="photo-editor-outside"
                  preserveAspectRatio="none"
                  viewBox={`0 0 ${layer.width} ${layer.height}`}
                >
                  <image
                    height={placement.height}
                    href={href}
                    preserveAspectRatio={placement.preserveAspectRatio}
                    transform={placement.transform}
                    width={placement.width}
                    x={placement.x}
                    y={placement.y}
                  />
                </svg>
                <div
                  className="photo-editor-render"
                  style={{
                    height: renderCanvas.height * pixelsPerUnit,
                    width: renderCanvas.width * pixelsPerUnit,
                  }}
                  /* biome-ignore lint/security/noDangerouslySetInnerHtml: Generated from validated page schema and escaped by editor-core. */
                  dangerouslySetInnerHTML={{ __html: stageSvg }}
                />
                <svg
                  aria-hidden="true"
                  className="photo-editor-guide"
                  preserveAspectRatio="none"
                  viewBox={`0 0 ${layer.width} ${layer.height}`}
                >
                  <rect
                    height={placement.aperture.height}
                    width={placement.aperture.width}
                    x={placement.aperture.x}
                    y={placement.aperture.y}
                  />
                </svg>
              </div>
            ) : null}
          </div>
          <div className="photo-editor-toolbar" role="toolbar" aria-label="Photo tools">
            <div className="photo-editor-zoom">
              <span className="photo-editor-tool-label">Zoom</span>
              <button
                type="button"
                className="photo-editor-icon-button"
                aria-label="Zoom out"
                title="Zoom out"
                disabled={photoTransform.scale <= minimumScale}
                onClick={() => zoomTo(photoTransform.scale - ZOOM_BUTTON_STEP)}
              >
                <SubtractRegular />
              </button>
              <input
                aria-label="Zoom"
                aria-valuetext={`${Math.round(photoTransform.scale * 100)}%`}
                max={PHOTO_EDITOR_SCALE_MAX}
                min={minimumScale}
                step={0.01}
                type="range"
                value={photoTransform.scale}
                onChange={(event) => zoomTo(Number(event.currentTarget.value))}
              />
              <button
                type="button"
                className="photo-editor-icon-button"
                aria-label="Zoom in"
                title="Zoom in"
                disabled={photoTransform.scale >= PHOTO_EDITOR_SCALE_MAX}
                onClick={() => zoomTo(photoTransform.scale + ZOOM_BUTTON_STEP)}
              >
                <AddRegular />
              </button>
              <output className="photo-editor-zoom-value">
                {Math.round(photoTransform.scale * 100)}%
              </output>
            </div>
            <div className="photo-editor-tool-group">
              <Button
                appearance="subtle"
                icon={<ArrowRotateClockwiseRegular />}
                onClick={rotateQuarterTurn}
              >
                Rotate photo
              </Button>
              <Button
                appearance="subtle"
                aria-pressed={photoTransform.flipX}
                icon={<FlipHorizontalRegular />}
                onClick={() =>
                  setPhotoTransform((current) => flipPhotoTransform(draftLayer, current, "x"))
                }
              >
                Flip horizontal
              </Button>
              <Button
                appearance="subtle"
                aria-pressed={photoTransform.flipY}
                icon={<FlipVerticalRegular />}
                onClick={() =>
                  setPhotoTransform((current) => flipPhotoTransform(draftLayer, current, "y"))
                }
              >
                Flip vertical
              </Button>
            </div>
            <Switch
              checked={autoEnhanceBaseline !== null}
              className="photo-editor-auto-enhance"
              disabled={isAnalyzing}
              label="Auto enhance"
              labelPosition="before"
              onChange={(_, data) => void toggleAutoEnhance(data.checked)}
            />
          </div>
        </div>
        <aside className="photo-editor-sidebar">
          <header className="photo-editor-header">
            <h3 id={titleId}>Photo editor</h3>
            <button
              type="button"
              className="app-modal-close"
              aria-label="Close photo editor"
              title="Close"
              onClick={onCancel}
            >
              <DismissRegular />
            </button>
          </header>
          <div className="photo-editor-panels">
            <section className="photo-editor-section" aria-labelledby={`${titleId}-filters`}>
              <h4 id={`${titleId}-filters`}>Photo filters</h4>
              <div className="photo-editor-filter-grid">
                {filterPreviews.map((option) => (
                  <button
                    type="button"
                    key={option.preset}
                    aria-pressed={filter.preset === option.preset}
                    className="photo-editor-filter"
                    onClick={() => setFilter((current) => ({ ...current, preset: option.preset }))}
                  >
                    <PhotoFilterThumbnail
                      filter={option.filter}
                      href={href}
                      idPrefix={`${svgIdPrefix}${option.preset}`}
                    />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="photo-editor-section" aria-labelledby={`${titleId}-adjust`}>
              <h4 id={`${titleId}-adjust`}>Adjust</h4>
              {photoAdjustments.map((adjustment) => (
                <PhotoAdjustmentSlider
                  key={adjustment.key}
                  adjustment={adjustment}
                  value={filter[adjustment.key]}
                  onChange={(value) => updateAdjustments({ [adjustment.key]: value })}
                />
              ))}
            </section>
          </div>
          <footer className="photo-editor-footer">
            <Button appearance="subtle" icon={<ArrowResetRegular />} onClick={reset}>
              Reset
            </Button>
            <span className="photo-editor-footer-actions">
              <Button onClick={onCancel}>Cancel</Button>
              <Button appearance="primary" onClick={done}>
                Done
              </Button>
            </span>
          </footer>
        </aside>
      </div>
    </Portal>
  );
}
