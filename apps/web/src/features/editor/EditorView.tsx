import { Button } from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  ArrowLeftRegular,
  CopyRegular,
  DeleteRegular,
  DocumentPdfRegular,
  SaveRegular,
} from "@fluentui/react-icons";
import {
  addLayer,
  createMapLayer,
  createPhotoLayer,
  createStickerLayer,
  createTextLayer,
  createWashiTapeLayer,
  deleteLayer,
  type PageDocument,
  type PageLayer,
  reorderLayer,
  type StickerDefinition,
  updateCanvas,
  updateLayer,
  type WashiTapeDesign,
  type WashiTapeLayer,
} from "@zakka/editor-core";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { apiClient } from "../../apiClient";
import { ProcessingBanner, WorkspaceHeader } from "../../components/layout";
import { getErrorMessage } from "../../lib/errors";
import type { Asset, ExportJob, PageDetail } from "../../types";
import { AssetRail } from "./AssetRail";
import { EditorToolbar } from "./EditorToolbar";
import type { EditorSaveStatus } from "./editorTypes";
import { LayerInspector } from "./LayerInspector";
import {
  PageCanvas,
  formatLayerKindLabel,
  getNewMapLayerFrame,
  type ReorderLayerCommand,
  type SelectionPanel,
} from "./PageCanvas";
import { PhotoPickerModal } from "./PhotoPickerModal";
import { type PngExportSettings, PngExportSettingsModal } from "./PngExportSettingsModal";
import { WashiTapeGalleryModal } from "../washi-tape/WashiTapeGalleryModal";
import { StickerPickerModal } from "./StickerPickerModal";

type PhotoPickerMode = { kind: "photo" } | { kind: "washiTapePattern"; layerId: string };

export function EditorView() {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState<PageDetail | null>(null);
  const [document, setDocument] = useState<PageDocument | null>(null);
  const [title, setTitle] = useState("Untitled page");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [pendingExportFormat, setPendingExportFormat] = useState<"pdf" | "png" | null>(null);
  const [photoPickerMode, setPhotoPickerMode] = useState<PhotoPickerMode | null>(null);
  const [isPngExportSettingsOpen, setIsPngExportSettingsOpen] = useState(false);
  const [isStickerPickerOpen, setIsStickerPickerOpen] = useState(false);
  const [isWashiTapeGalleryOpen, setIsWashiTapeGalleryOpen] = useState(false);
  const [activeSelectionPanel, setActiveSelectionPanel] = useState<SelectionPanel | null>(null);
  const [status, setStatus] = useState<EditorSaveStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    if (!pageId) {
      navigate("/pages", { replace: true });
      return () => {
        isMounted = false;
      };
    }

    Promise.all([apiClient.getPage(pageId), apiClient.listAssets()])
      .then(([loadedPage, assetResponse]) => {
        if (isMounted) {
          setPage(loadedPage);
          setDocument(loadedPage.document);
          setTitle(loadedPage.title);
          setAssets(assetResponse.assets);
          setSelectedLayerIds([]);
          setStatus("saved");
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          setError(getErrorMessage(loadError));
          setStatus("error");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [navigate, pageId]);

  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const primarySelectedLayerId = selectedLayerIds.length === 1 ? selectedLayerIds[0] : null;
  const selectedLayer = useMemo(
    () => document?.layers.find((layer) => layer.id === primarySelectedLayerId) ?? null,
    [document, primarySelectedLayerId],
  );
  useEffect(() => {
    if (!primarySelectedLayerId) setActiveSelectionPanel(null);
  }, [primarySelectedLayerId]);
  useEffect(() => {
    if (!activeSelectionPanel) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveSelectionPanel(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeSelectionPanel]);
  const selectLayer = (layerId: string | null, options?: { additive?: boolean }) => {
    if (layerId === null) {
      setSelectedLayerIds([]);
      return;
    }
    if (options?.additive) {
      setSelectedLayerIds((currentIds) =>
        currentIds.includes(layerId)
          ? currentIds.filter((id) => id !== layerId)
          : [...currentIds, layerId],
      );
      return;
    }
    setSelectedLayerIds([layerId]);
  };
  const editDocument = (nextDocument: PageDocument) => {
    setDocument(nextDocument);
    setStatus("unsaved");
  };
  const updateLayerTransform = (layerId: string, update: Partial<PageLayer>) => {
    if (document) editDocument(updateLayer(document, layerId, update));
  };
  const updateLayerTransforms = (
    updates: Array<{ layerId: string; update: Partial<PageLayer> }>,
  ) => {
    if (!document || updates.length === 0) return;
    let nextDocument = document;
    for (const { layerId, update } of updates) {
      nextDocument = updateLayer(nextDocument, layerId, update);
    }
    editDocument(nextDocument);
  };
  const reorderCanvasLayer = (layerId: string, command: ReorderLayerCommand) => {
    if (!document) return;
    const currentIndex = document.layers.findIndex((layer) => layer.id === layerId);
    if (currentIndex < 0) return;
    const lastIndex = document.layers.length - 1;
    const toIndex =
      command === "top"
        ? lastIndex
        : command === "bottom"
          ? 0
          : command === "up"
            ? Math.min(lastIndex, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
    if (toIndex === currentIndex) return;
    editDocument(reorderLayer(document, layerId, toIndex));
    setSelectedLayerIds([layerId]);
  };
  const deleteCanvasLayer = (layerId: string) => {
    if (!document) return;
    editDocument(deleteLayer(document, layerId));
    setSelectedLayerIds((currentIds) => currentIds.filter((id) => id !== layerId));
  };
  const addText = () => {
    if (!document) return;
    const layer = createTextLayer({ text: "New text" });
    editDocument(addLayer(document, layer));
    setSelectedLayerIds([layer.id]);
  };
  const addMap = () => {
    if (!document) return;
    const layer = createMapLayer(getNewMapLayerFrame(document));
    editDocument(addLayer(document, layer));
    setSelectedLayerIds([layer.id]);
  };
  const addPhoto = (asset: Asset) => {
    if (!document) return;
    const layer = createPhotoLayer({
      assetId: asset.id,
      width: Math.min(document.canvas.width * 0.5, 1000),
      height: Math.min(document.canvas.height * 0.34, 760),
    });
    editDocument(addLayer(document, layer));
    setSelectedLayerIds([layer.id]);
  };
  const addWashiTape = (design: WashiTapeDesign) => {
    if (!document) return;
    const layer = createWashiTapeLayer({
      ...design,
      width: Math.min(document.canvas.width * 0.56, 1120),
      height: Math.min(document.canvas.height * 0.08, 220),
      x: document.canvas.width * 0.16,
      y: document.canvas.height * 0.16,
    });
    editDocument(addLayer(document, layer));
    setSelectedLayerIds([layer.id]);
  };
  const setWashiTapePhotoPattern = (asset: Asset) => {
    if (!document || photoPickerMode?.kind !== "washiTapePattern") return;
    const layer = document.layers.find(
      (candidateLayer) => candidateLayer.id === photoPickerMode.layerId,
    );

    if (layer?.kind !== "washiTape") return;

    editDocument(
      updateLayer(document, layer.id, {
        pattern: {
          ...layer.pattern,
          assetId: asset.id,
          kind: "customPhoto",
        },
      } as Partial<WashiTapeLayer> as Partial<PageLayer>),
    );
    setSelectedLayerIds([layer.id]);
  };
  const addSticker = (sticker: StickerDefinition) => {
    if (!document) return;
    const size = Math.min(document.canvas.width * 0.18, document.canvas.height * 0.18, 420);
    const layer = createStickerLayer({
      stickerId: sticker.id,
      width: size,
      height: size,
      x: document.canvas.width * 0.12,
      y: document.canvas.height * 0.12,
    });
    editDocument(addLayer(document, layer));
    setSelectedLayerIds([layer.id]);
  };
  const savePage = async () => {
    if (!page || !document) return;
    setStatus("saving");
    setError(null);
    try {
      const savedPage = await apiClient.updatePage(page.id, { title, document });
      setPage(savedPage);
      setDocument(savedPage.document);
      setTitle(savedPage.title);
      setStatus("saved");
    } catch (saveError: unknown) {
      setError(getErrorMessage(saveError));
      setStatus("error");
    }
  };
  const duplicatePage = async () => {
    if (!page) return;
    setError(null);
    try {
      const duplicated = await apiClient.duplicatePage(page.id, { title: `${title} copy` });
      navigate(`/pages/${duplicated.id}`);
    } catch (duplicateError: unknown) {
      setError(getErrorMessage(duplicateError));
    }
  };
  const deletePage = async () => {
    if (!page) return;
    setError(null);
    try {
      await apiClient.deletePage(page.id);
      navigate("/pages", { replace: true });
    } catch (deleteError: unknown) {
      setError(getErrorMessage(deleteError));
    }
  };
  const exportPage = async (format: "pdf" | "png", settings: Partial<PngExportSettings> = {}) => {
    if (!page) return;
    setError(null);
    setExportJob(null);
    setPendingExportFormat(format);
    try {
      setExportJob(
        await apiClient.createExport({
          ...(settings.dpi === undefined ? {} : { dpi: settings.dpi }),
          format,
          includeBackground: settings.includeBackground ?? true,
          pageId: page.id,
          preset: "print",
        }),
      );
    } catch (exportError: unknown) {
      setError(getErrorMessage(exportError));
    } finally {
      setPendingExportFormat(null);
    }
  };

  const submitPngExport = (settings: PngExportSettings) => {
    setIsPngExportSettingsOpen(false);
    void exportPage("png", settings);
  };

  if (status === "loading" || !document || !page) {
    return (
      <>
        <WorkspaceHeader title="Editor" />
        {error ? (
          <p className="panel-alert" role="alert">
            {error}
          </p>
        ) : (
          <p className="empty-state">Loading page</p>
        )}
      </>
    );
  }

  return (
    <>
      <WorkspaceHeader title="Editor">
        <Button
          type="button"
          className="secondary-button"
          icon={<ArrowLeftRegular />}
          onClick={() => navigate("/pages")}
        >
          Back
        </Button>
        <Button
          type="button"
          className="secondary-button"
          icon={<CopyRegular />}
          onClick={duplicatePage}
        >
          Duplicate
        </Button>
        <Button
          type="button"
          className="secondary-button"
          icon={<DeleteRegular />}
          onClick={deletePage}
        >
          Delete
        </Button>
        <Button
          type="button"
          className="secondary-button"
          disabled={pendingExportFormat !== null}
          icon={<ArrowDownloadRegular />}
          onClick={() => setIsPngExportSettingsOpen(true)}
        >
          Export PNG
        </Button>
        <Button
          type="button"
          className="secondary-button"
          disabled={pendingExportFormat !== null}
          icon={<DocumentPdfRegular />}
          onClick={() => exportPage("pdf")}
        >
          Export PDF
        </Button>
        <Button
          appearance="primary"
          type="button"
          className="primary-button"
          disabled={status === "saving"}
          icon={<SaveRegular />}
          onClick={savePage}
        >
          {status === "saving" ? "Saving" : "Save"}
        </Button>
      </WorkspaceHeader>
      {isPngExportSettingsOpen ? (
        <PngExportSettingsModal
          onClose={() => setIsPngExportSettingsOpen(false)}
          onSubmit={submitPngExport}
        />
      ) : null}
      {photoPickerMode ? (
        <PhotoPickerModal
          actionLabel={photoPickerMode.kind === "washiTapePattern" ? "Use as pattern" : "Add"}
          assets={assets}
          title={photoPickerMode.kind === "washiTapePattern" ? "Choose pattern photo" : "Add photo"}
          onAddPhoto={
            photoPickerMode.kind === "washiTapePattern" ? setWashiTapePhotoPattern : addPhoto
          }
          onClose={() => setPhotoPickerMode(null)}
        />
      ) : null}
      {isStickerPickerOpen ? (
        <StickerPickerModal
          onAddSticker={addSticker}
          onClose={() => setIsStickerPickerOpen(false)}
        />
      ) : null}
      {isWashiTapeGalleryOpen ? (
        <WashiTapeGalleryModal
          onAddWashiTape={addWashiTape}
          onClose={() => setIsWashiTapeGalleryOpen(false)}
        />
      ) : null}
      {error ? (
        <p className="panel-alert" role="alert">
          {error}
        </p>
      ) : null}
      {pendingExportFormat ? (
        <ProcessingBanner>Preparing {pendingExportFormat.toUpperCase()} export</ProcessingBanner>
      ) : null}
      {exportJob?.outputContentUrl ? (
        <p className="download-banner">
          <a href={exportJob.outputContentUrl} target="_blank" rel="noreferrer">
            Download {exportJob.preset} {exportJob.format.toUpperCase()}
          </a>
        </p>
      ) : null}
      <div className="editor-shell">
        <AssetRail
          assetCount={assets.length}
          inspector={
            selectedLayer
              ? {
                  title: `Edit ${formatLayerKindLabel(selectedLayer.kind)}`,
                  content: (
                    <LayerInspector
                      layer={selectedLayer}
                      onChange={(update) => updateLayerTransform(selectedLayer.id, update)}
                      onChooseWashiTapePhoto={(layerId) =>
                        setPhotoPickerMode({ kind: "washiTapePattern", layerId })
                      }
                    />
                  ),
                }
              : null
          }
          onAddMap={addMap}
          onAddText={addText}
          onOpenPhotoPicker={() => setPhotoPickerMode({ kind: "photo" })}
          onOpenStickerPicker={() => setIsStickerPickerOpen(true)}
          onOpenWashiTapePicker={() => setIsWashiTapeGalleryOpen(true)}
        />
        <section
          className="editor-stage"
          aria-label="Page canvas"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const target = event.target as HTMLElement;
            if (target.closest(".editor-canvas")) return;
            if (target.closest(".editor-toolbar")) return;
            selectLayer(null);
          }}
        >
          <EditorToolbar
            document={document}
            status={status}
            title={title}
            onChangeBackground={(backgroundColor) =>
              editDocument(updateCanvas(document, { backgroundColor }))
            }
            onChangeTitle={(nextTitle) => {
              setTitle(nextTitle);
              setStatus("unsaved");
            }}
          />
          <PageCanvas
            activeSelectionPanel={activeSelectionPanel}
            assetById={assetById}
            document={document}
            selectedLayerIds={selectedLayerIds}
            onActiveSelectionPanelChange={setActiveSelectionPanel}
            onChangeLayer={updateLayerTransform}
            onDeleteLayer={deleteCanvasLayer}
            onReorderLayer={reorderCanvasLayer}
            onSelectLayer={selectLayer}
            onTransformLayer={updateLayerTransform}
            onTransformLayers={updateLayerTransforms}
          />
        </section>
      </div>
    </>
  );
}
