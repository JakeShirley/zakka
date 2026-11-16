import type { PageLayer } from "@zakka/editor-core";

import type { Asset, PageDetail } from "../../types";
import type { CanvasPoint } from "../editor/editorTypes";
import {
  type ArrangeCanvasPreview,
  type CanvasPreviewLayer,
  PageCanvas,
  type PhotoDropTarget,
  type ReorderLayerCommand,
  type SelectionPanel,
  type SelectLayerOptions,
  type SpreadReorderCapabilities,
} from "../editor/PageCanvas";
import type { LayerTransformUpdate } from "../editor/transforms";
import type { EditHistoryMode } from "./bookEditorHistory";
import type { ViewMode } from "./bookEditorTypes";

/** The photo frame (placeholder or photo to replace) under a drop, with the page that owns it. */
export type PhotoTarget = { layerId: string; pageId: string };

const resolvePhotoTarget = (
  pageId: string,
  target: PhotoDropTarget | undefined,
): PhotoTarget | undefined =>
  target ? { layerId: target.layerId, pageId: target.pageId ?? pageId } : undefined;

type BookCanvasDeckProps = {
  activePageId: string;
  activeSelectionPanel?: SelectionPanel | null;
  /** Arrange preview drawn on the active page only. */
  arrangePreview?: ArrangeCanvasPreview | null;
  assetById: Map<string, Asset>;
  orderedPageIds: string[];
  pageDetails: Map<string, PageDetail>;
  selectedLayerIds: string[];
  spreadReorderCapabilities?: SpreadReorderCapabilities;
  viewMode: ViewMode;
  visiblePageIds: string[];
  getSpreadPreviewLayers: (pageId: string) => CanvasPreviewLayer[];
  onActiveSelectionPanelChange?: (panel: SelectionPanel | null) => void;
  onChoosePhoto?: (pageId: string, layerId: string) => void;
  onDeleteLayer: (pageId: string, layerId: string) => void;
  onDropAsset?: (
    pageId: string,
    assetId: string,
    canvasPoint: CanvasPoint,
    photoTarget?: PhotoTarget,
  ) => void;
  onDropFiles?: (
    pageId: string,
    files: File[],
    canvasPoint: CanvasPoint,
    photoTarget?: PhotoTarget,
  ) => void;
  onReorderLayer: (pageId: string, layerId: string, command: ReorderLayerCommand) => void;
  onSelectLayer: (pageId: string, layerId: string | null, options?: SelectLayerOptions) => void;
  onTransformEnd: (pageId: string, layerId: string, update: Partial<PageLayer> | null) => void;
  onTransformLayers: (pageId: string, updates: LayerTransformUpdate[]) => void;
  onTransformLayersEnd: (pageId: string, updates: LayerTransformUpdate[] | null) => void;
  onUpdateLayerTransform: (
    pageId: string,
    layerId: string,
    update: Partial<PageLayer>,
    historyMode?: EditHistoryMode,
  ) => void;
};

export function BookCanvasDeck({
  activePageId,
  activeSelectionPanel,
  arrangePreview,
  assetById,
  orderedPageIds,
  pageDetails,
  selectedLayerIds,
  spreadReorderCapabilities,
  viewMode,
  visiblePageIds,
  getSpreadPreviewLayers,
  onActiveSelectionPanelChange,
  onChoosePhoto,
  onDeleteLayer,
  onDropAsset,
  onDropFiles,
  onReorderLayer,
  onSelectLayer,
  onTransformEnd,
  onTransformLayers,
  onTransformLayersEnd,
  onUpdateLayerTransform,
}: BookCanvasDeckProps) {
  return (
    <div
      className="book-canvas-deck"
      data-mode={viewMode}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest(".editor-canvas")) return;
        onSelectLayer(activePageId, null);
      }}
    >
      {visiblePageIds.map((pageId) => {
        const page = pageDetails.get(pageId);
        const pageIndex = orderedPageIds.indexOf(pageId);

        if (!page) {
          return null;
        }

        const isActivePage = pageId === activePageId;

        return (
          <section
            className="book-page-frame"
            data-active={isActivePage}
            key={pageId}
            aria-label={`Page ${pageIndex + 1}`}
          >
            <PageCanvas
              activeSelectionPanel={isActivePage ? (activeSelectionPanel ?? null) : null}
              arrangePreview={isActivePage ? (arrangePreview ?? null) : null}
              assetById={assetById}
              confineLayerHitAreasToPage={visiblePageIds.length > 1}
              document={page.document}
              previewLayers={getSpreadPreviewLayers(pageId)}
              selectedLayerIds={isActivePage ? selectedLayerIds : []}
              {...(spreadReorderCapabilities ? { spreadReorderCapabilities } : {})}
              onActiveSelectionPanelChange={isActivePage ? onActiveSelectionPanelChange : undefined}
              onChangeLayer={(layerId, update) => onUpdateLayerTransform(pageId, layerId, update)}
              onChoosePhoto={
                onChoosePhoto ? (layerId) => onChoosePhoto(pageId, layerId) : undefined
              }
              onDeleteLayer={(layerId) => onDeleteLayer(pageId, layerId)}
              {...(onDropAsset
                ? {
                    onDropAsset: (assetId, point, photoTarget) =>
                      onDropAsset(pageId, assetId, point, resolvePhotoTarget(pageId, photoTarget)),
                  }
                : {})}
              {...(onDropFiles
                ? {
                    onDropFiles: (files, point, photoTarget) =>
                      onDropFiles(pageId, files, point, resolvePhotoTarget(pageId, photoTarget)),
                  }
                : {})}
              onReorderLayer={(layerId, command) => onReorderLayer(pageId, layerId, command)}
              onSelectPreviewLayer={onSelectLayer}
              onSelectLayer={(layerId, options) => onSelectLayer(pageId, layerId, options)}
              onTransformEnd={(layerId, update) => onTransformEnd(pageId, layerId, update)}
              onTransformLayer={(layerId, update) =>
                onUpdateLayerTransform(pageId, layerId, update, "group")
              }
              onTransformLayers={(updates) => onTransformLayers(pageId, updates)}
              onTransformLayersEnd={(updates) => onTransformLayersEnd(pageId, updates)}
            />
          </section>
        );
      })}
    </div>
  );
}
