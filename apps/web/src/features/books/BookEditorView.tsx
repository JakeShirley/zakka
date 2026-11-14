import { Button } from "@fluentui/react-components";
import {
  AddRegular,
  ArrowRedoRegular,
  ArrowUndoRegular,
  DeleteRegular,
  DismissRegular,
  SaveRegular,
} from "@fluentui/react-icons";
import {
  addLayer,
  createPageDocument,
  createPhotoLayer,
  createStickerLayer,
  createTextLayer,
  createWashiTapeLayer,
  deleteLayer,
  type PageDocument,
  type PageLayer,
  type PageResizeAnchor,
  type PageResizeMode,
  reorderLayer,
  resizePageDocument,
  type StickerDefinition,
  updateCanvas,
  updateLayer,
  type WashiTapeDesign,
  type WashiTapeLayer,
} from "@zakka/editor-core";
import type { DragEvent, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { apiClient } from "../../apiClient";
import { AppModal, ProcessingBanner, WorkspaceHeader } from "../../components/layout";
import { getErrorMessage } from "../../lib/errors";
import type { Asset, BookDetail, ExportJob, PageDetail } from "../../types";
import {
  type ArrangeSettings,
  alignReferenceLabels,
  defaultArrangeSettings,
  getSelectedLayersInOrder,
  getSingleLayerArrangeSettings,
  planArrange,
} from "../editor/arrange";
import {
  ArrangePanel,
  InspectorTabs,
  useArrangePreviewPreference,
  useInspectorTab,
} from "../editor/ArrangePanel";
import { AssetRail } from "../editor/AssetRail";
import type { EditorSaveStatus } from "../editor/editorTypes";
import { LayerInspector } from "../editor/LayerInspector";
import {
  type ArrangeCanvasPreview,
  type CanvasPreviewLayer,
  formatLayerKindLabel,
  type ReorderLayerCommand,
  type SelectionPanel,
} from "../editor/PageCanvas";
import { PhotoPickerModal } from "../editor/PhotoPickerModal";
import { type PngExportSettings, PngExportSettingsModal } from "../editor/PngExportSettingsModal";
import { StickerPickerModal } from "../editor/StickerPickerModal";
import { WashiTapeGalleryModal } from "../washi-tape/WashiTapeGalleryModal";
import { BookCanvasDeck, type PlaceholderTarget } from "./BookCanvasDeck";
import { BookEditorHeader } from "./BookEditorHeader";
import { BookFilmstrip } from "./BookFilmstrip";
import { BookLibraryPickerModal } from "./BookLibraryPickerModal";
import { BookModeBar } from "./BookModeBar";
import { BookSettingsModal } from "./BookSettingsModal";
import { fetchBookWithPages } from "./bookEditorData";
import {
  type BookEditorHistoryEntry,
  coalesceEdits,
  type EditHistoryMode,
  getChangedPageIds,
  useBookEditorHistory,
} from "./bookEditorHistory";
import type {
  LoadedBook,
  PageDropPosition,
  PageDropTarget,
  PageSelectionMode,
  PngExportTarget,
  ViewMode,
} from "./bookEditorTypes";
import { getPageIdRange, movePageIds, orderPageIds, togglePageId } from "./bookPageOrdering";
import { PageSettingsPanel } from "./PageSettingsPanel";
import {
  customBookPageSizeKey,
  defaultBookPageSize,
  getBookPageSizeByKey,
  getBookPageSizeKey,
} from "./pageSizes";
import {
  fillPhotoPlaceholderAcrossSpread,
  getSpreadPageContexts,
  layerOverlapsPageCanvas,
  replacePageDocument,
  type SpreadLayerSyncResult,
  syncLayerAcrossSpread,
} from "./spreadLayers";

type PhotoPickerMode = {
  kind: "photoPlaceholder" | "washiTapePattern";
  layerId: string;
  pageId: string;
};

/**
 * Layer properties that are driven by continuous controls (typing, sliders, colour pickers). Runs of
 * these edits collapse into a single undo step instead of one step per keystroke or pointer tick.
 */
const continuousLayerUpdateKeys = new Set([
  "background",
  "bubble",
  "color",
  "fontSize",
  "glow",
  "height",
  "opacity",
  "pattern",
  "photoTransform",
  "rotation",
  "shadow",
  "stroke",
  "text",
  "width",
  "x",
  "y",
]);

const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;

  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable
  );
};

/**
 * Ctrl/Cmd+Z should defer to a field's own undo stack rather than rolling the whole book back, but
 * only when that stack actually exists. RichTextEditor repaints its contenteditable DOM on every
 * keystroke, which wipes the browser's native undo stack, so it falls through to editor history.
 */
const hasNativeUndoStack = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;

  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  return target.isContentEditable && !target.closest("[data-rich-text-editor]");
};

const getLayerEditHistoryMode = (
  pageId: string,
  layerId: string,
  update: Partial<PageLayer>,
  historyMode: EditHistoryMode,
): EditHistoryMode => {
  if (historyMode !== "record") {
    return historyMode;
  }

  const updateKeys = Object.keys(update);

  if (
    updateKeys.length === 0 ||
    !updateKeys.every((updateKey) => continuousLayerUpdateKeys.has(updateKey))
  ) {
    return historyMode;
  }

  return coalesceEdits(`layer:${pageId}:${layerId}:${[...updateKeys].sort().join(",")}`);
};

export function BookEditorView() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState<BookDetail | null>(null);
  const [bookTitleDraft, setBookTitleDraft] = useState("");
  const [bookPageSizeDraft, setBookPageSizeDraft] = useState<string>(defaultBookPageSize.key);
  const [coverSpreadEnabledDraft, setCoverSpreadEnabledDraft] = useState(true);
  const [pageResizeMode, setPageResizeMode] = useState<PageResizeMode>("fit");
  const [pageResizeAnchor, setPageResizeAnchor] = useState<PageResizeAnchor>("center");
  const [pageDetails, setPageDetails] = useState<Map<string, PageDetail>>(new Map());
  const [pageStatuses, setPageStatuses] = useState<Record<string, EditorSaveStatus>>({});
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [activeSelectionPanel, setActiveSelectionPanel] = useState<SelectionPanel | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("spread");
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [pendingExportFormat, setPendingExportFormat] = useState<"pdf" | "png" | null>(null);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [isBookSettingsOpen, setIsBookSettingsOpen] = useState(false);
  const [isDeleteBookConfirmationOpen, setIsDeleteBookConfirmationOpen] = useState(false);
  const [photoPickerMode, setPhotoPickerMode] = useState<PhotoPickerMode | null>(null);
  const [isLibraryPickerOpen, setIsLibraryPickerOpen] = useState(false);
  const [isStickerPickerOpen, setIsStickerPickerOpen] = useState(false);
  const [isWashiTapeGalleryOpen, setIsWashiTapeGalleryOpen] = useState(false);
  const [pngExportTarget, setPngExportTarget] = useState<PngExportTarget | null>(null);
  const [draggedPageIds, setDraggedPageIds] = useState<string[]>([]);
  const [markedPageIds, setMarkedPageIds] = useState<string[]>([]);
  const [pageSelectionAnchorId, setPageSelectionAnchorId] = useState<string | null>(null);
  const [pageDropTarget, setPageDropTarget] = useState<PageDropTarget | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    canRedo,
    canUndo,
    endHistoryGroup,
    recordHistory,
    redoHistory,
    resetHistory,
    undoHistory,
  } = useBookEditorHistory<BookEditorHistoryEntry>();

  const applyLoadedBook = useCallback(
    (loadedBook: LoadedBook, preferredPageId: string | null) => {
      const detailsById = new Map(loadedBook.pages.map((page) => [page.id, page]));
      const orderedPageIds = loadedBook.book.pages.map((bookPage) => bookPage.pageId);
      const nextActivePageId =
        preferredPageId && orderedPageIds.includes(preferredPageId)
          ? preferredPageId
          : (orderedPageIds[0] ?? null);

      setBook(loadedBook.book);
      setBookTitleDraft(loadedBook.book.title);
      setBookPageSizeDraft(getBookPageSizeKey(loadedBook.book));
      setCoverSpreadEnabledDraft(loadedBook.book.coverSpreadEnabled);
      setPageDetails(detailsById);
      resetHistory();
      setPageStatuses(Object.fromEntries(loadedBook.pages.map((page) => [page.id, "saved"])));
      setActivePageId(nextActivePageId);
      setMarkedPageIds((currentPageIds) => {
        const remainingPageIds = currentPageIds.filter((pageId) => orderedPageIds.includes(pageId));

        return remainingPageIds.length > 1 ? remainingPageIds : [];
      });
      setPageSelectionAnchorId((currentPageId) =>
        currentPageId && orderedPageIds.includes(currentPageId) ? currentPageId : null,
      );
      setSelectedLayerIds([]);
    },
    [resetHistory],
  );

  useEffect(() => {
    let isMounted = true;

    if (!bookId) {
      navigate("/books", { replace: true });
      return () => {
        isMounted = false;
      };
    }

    const loadEditor = async () => {
      setIsLoading(true);
      const [loadedBook, assetResponse] = await Promise.all([
        fetchBookWithPages(bookId),
        apiClient.listBookAssets(bookId),
      ]);

      if (!isMounted) {
        return;
      }

      applyLoadedBook(loadedBook, loadedBook.book.pages[0]?.pageId ?? null);
      setAssets(assetResponse.assets);
      setError(null);
      setIsLoading(false);
    };

    loadEditor().catch((loadError: unknown) => {
      if (isMounted) {
        setError(getErrorMessage(loadError));
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [applyLoadedBook, bookId, navigate]);

  const reloadBook = async (preferredPageId: string | null = activePageId) => {
    if (!bookId) {
      return;
    }

    applyLoadedBook(await fetchBookWithPages(bookId), preferredPageId);
  };

  const orderedPageIds = useMemo(
    () => book?.pages.map((bookPage) => bookPage.pageId) ?? [],
    [book],
  );
  const activePageIndex = activePageId ? orderedPageIds.indexOf(activePageId) : -1;
  const activePage = activePageId ? (pageDetails.get(activePageId) ?? null) : null;
  const activeSpreadIndex =
    book?.spreads.findIndex((spread) => activePageId && spread.pageIds.includes(activePageId)) ??
    -1;
  const activeSpread =
    activeSpreadIndex >= 0
      ? (book?.spreads[activeSpreadIndex] ?? null)
      : (book?.spreads[0] ?? null);
  const visiblePageIds =
    viewMode === "spread" ? (activeSpread?.pageIds ?? []) : activePageId ? [activePageId] : [];
  const visibleSpreadPages = useMemo(
    () => (viewMode === "spread" ? getSpreadPageContexts(pageDetails, visiblePageIds) : []),
    [pageDetails, viewMode, visiblePageIds],
  );
  const spreadReorderCapabilities = useMemo<
    ReadonlyMap<string, { canMoveDown: boolean; canMoveUp: boolean }> | undefined
  >(() => {
    if (viewMode !== "spread" || visibleSpreadPages.length < 2) {
      return undefined;
    }
    const capabilities = new Map<string, { canMoveDown: boolean; canMoveUp: boolean }>();
    for (const spreadPage of visibleSpreadPages) {
      const layers = spreadPage.page.document.layers;
      const lastIndex = layers.length - 1;
      for (const [index, layer] of layers.entries()) {
        const current = capabilities.get(layer.id) ?? { canMoveDown: false, canMoveUp: false };
        if (index > 0) current.canMoveDown = true;
        if (index < lastIndex) current.canMoveUp = true;
        capabilities.set(layer.id, current);
      }
    }
    return capabilities;
  }, [viewMode, visibleSpreadPages]);
  const canNavigatePrevious = viewMode === "spread" ? activeSpreadIndex > 0 : activePageIndex > 0;
  const canNavigateNext =
    viewMode === "spread"
      ? activeSpreadIndex >= 0 && activeSpreadIndex < (book?.spreads.length ?? 0) - 1
      : activePageIndex >= 0 && activePageIndex < orderedPageIds.length - 1;
  const navigationLabel =
    viewMode === "spread"
      ? `Spread ${Math.max(activeSpreadIndex + 1, 1)} of ${book?.spreads.length ?? 0}`
      : activePageIndex >= 0
        ? `Page ${activePageIndex + 1} of ${orderedPageIds.length}`
        : "No pages";
  const visiblePageNames = visiblePageIds
    .map((pageId) => pageDetails.get(pageId)?.title)
    .filter((title): title is string => Boolean(title));
  const leftPageName = visiblePageNames[0] ?? navigationLabel;
  const rightPageName = visiblePageNames[visiblePageNames.length - 1] ?? leftPageName;
  const editingPage = editingPageId ? (pageDetails.get(editingPageId) ?? null) : null;
  const editingPageIndex = editingPageId ? orderedPageIds.indexOf(editingPageId) : -1;
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const primarySelectedLayerId = selectedLayerIds.length === 1 ? selectedLayerIds[0] : null;
  const selectedLayer = useMemo(
    () =>
      primarySelectedLayerId && activePage
        ? (activePage.document.layers.find((layer) => layer.id === primarySelectedLayerId) ?? null)
        : null,
    [activePage, primarySelectedLayerId],
  );
  const [arrangeSettings, setArrangeSettings] = useState<ArrangeSettings>(defaultArrangeSettings);
  const [isArrangePreviewEnabled, setIsArrangePreviewEnabled] = useArrangePreviewPreference();
  const arrangeLayers = useMemo(
    () => (activePage ? getSelectedLayersInOrder(activePage.document, selectedLayerIds) : []),
    [activePage, selectedLayerIds],
  );
  const isSingleLayerArrange = arrangeLayers.length === 1;
  const canArrangeSelection = arrangeLayers.length > 1 || selectedLayer?.locked === false;
  const { activeTab: inspectorTab, selectTab: selectInspectorTab } = useInspectorTab({
    canArrange: canArrangeSelection,
    layerCount: arrangeLayers.length,
    selectionKey: selectedLayerIds.join("|"),
    settings: arrangeSettings,
    onSettingsChange: setArrangeSettings,
  });
  const isArrangeTabOpen = inspectorTab !== "properties";
  const effectiveArrangeSettings = useMemo(
    () => (isSingleLayerArrange ? getSingleLayerArrangeSettings(arrangeSettings) : arrangeSettings),
    [arrangeSettings, isSingleLayerArrange],
  );
  const arrangePlan = useMemo(
    () =>
      activePage && isArrangeTabOpen && arrangeLayers.length > 0
        ? planArrange(arrangeLayers, activePage.document.canvas, effectiveArrangeSettings)
        : null,
    [activePage, arrangeLayers, effectiveArrangeSettings, isArrangeTabOpen],
  );
  const canApplyArrange = Boolean(arrangePlan && arrangePlan.updates.length > 0);
  const arrangePreview = useMemo<ArrangeCanvasPreview | null>(() => {
    if (!arrangePlan) return null;
    const layerById = new Map(arrangeLayers.map((layer) => [layer.id, layer]));
    const ghosts = isArrangePreviewEnabled
      ? arrangePlan.updates.flatMap(({ layerId, update }) => {
          const layer = layerById.get(layerId);
          return layer ? [{ ...layer, ...update } as PageLayer] : [];
        })
      : [];
    const anchorLayer = arrangePlan.anchorLayerId
      ? (layerById.get(arrangePlan.anchorLayerId) ?? null)
      : null;
    if (ghosts.length === 0 && !anchorLayer) return null;
    return {
      anchorLabel: anchorLayer
        ? alignReferenceLabels[effectiveArrangeSettings.align.relativeTo]
        : null,
      anchorLayer,
      ghosts,
    };
  }, [arrangeLayers, arrangePlan, effectiveArrangeSettings, isArrangePreviewEnabled]);
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
  const closePageSettingsForOtherPage = (pageId: string) => {
    setEditingPageId((currentPageId) => (currentPageId === pageId ? currentPageId : null));
  };

  const selectPage = (pageId: string, layerId: string | null = null) => {
    setActivePageId(pageId);
    closePageSettingsForOtherPage(pageId);
    setSelectedLayerIds(layerId ? [layerId] : []);
  };

  const selectFilmstripPage = (pageId: string, mode: PageSelectionMode) => {
    if (mode === "toggle") {
      const basePageIds =
        markedPageIds.length > 0 ? markedPageIds : activePageId ? [activePageId] : [];
      const nextPageIds = togglePageId(orderedPageIds, basePageIds, pageId);

      setMarkedPageIds(nextPageIds.length > 1 ? nextPageIds : []);
      setPageSelectionAnchorId(pageId);

      return;
    }

    if (mode === "range") {
      const anchorPageId = pageSelectionAnchorId ?? activePageId;
      const nextPageIds = anchorPageId
        ? getPageIdRange(orderedPageIds, anchorPageId, pageId)
        : [pageId];

      setMarkedPageIds(nextPageIds.length > 1 ? nextPageIds : []);
      if (nextPageIds.length <= 1) {
        selectPage(pageId);
      }
      return;
    }

    setMarkedPageIds([]);
    setPageSelectionAnchorId(pageId);
    selectPage(pageId);
  };

  const clearPageSelection = () => {
    setMarkedPageIds([]);
    setPageSelectionAnchorId(activePageId);
  };

  const selectLayer = (
    pageId: string,
    layerId: string | null,
    options?: { additive?: boolean },
  ) => {
    setActivePageId(pageId);
    closePageSettingsForOtherPage(pageId);
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

  const setPageStatus = (pageId: string, status: EditorSaveStatus) => {
    setPageStatuses((currentStatuses) => ({ ...currentStatuses, [pageId]: status }));
  };

  const setPagesStatus = useCallback((pageIds: string[], status: EditorSaveStatus) => {
    if (pageIds.length === 0) {
      return;
    }

    setPageStatuses((currentStatuses) => ({
      ...currentStatuses,
      ...Object.fromEntries(pageIds.map((pageId) => [pageId, status])),
    }));
  }, []);

  const createHistoryEntry = useCallback(
    (): BookEditorHistoryEntry => ({
      activePageId,
      editingPageId,
      pageDetails: new Map(pageDetails),
      selectedLayerIds,
    }),
    [activePageId, editingPageId, pageDetails, selectedLayerIds],
  );

  const applyHistoryEntry = useCallback(
    (entry: BookEditorHistoryEntry) => {
      const changedPageIds = getChangedPageIds(pageDetails, entry.pageDetails);
      const nextActivePageId =
        entry.activePageId && entry.pageDetails.has(entry.activePageId)
          ? entry.activePageId
          : (orderedPageIds.find((pageId) => entry.pageDetails.has(pageId)) ?? null);
      const nextEditingPageId =
        entry.editingPageId && entry.pageDetails.has(entry.editingPageId)
          ? entry.editingPageId
          : null;

      setPageDetails(new Map(entry.pageDetails));
      setActivePageId(nextActivePageId);
      setSelectedLayerIds(entry.selectedLayerIds);
      setEditingPageId(nextEditingPageId);
      setPagesStatus(changedPageIds, "unsaved");
    },
    [orderedPageIds, pageDetails, setPagesStatus],
  );

  const recordEditorHistory = useCallback(
    (historyMode: EditHistoryMode = "record") => {
      recordHistory(createHistoryEntry, historyMode);
    },
    [createHistoryEntry, recordHistory],
  );

  const undoBookEdit = useCallback(() => {
    undoHistory({ applyEntry: applyHistoryEntry, createEntry: createHistoryEntry });
  }, [applyHistoryEntry, createHistoryEntry, undoHistory]);

  const redoBookEdit = useCallback(() => {
    redoHistory({ applyEntry: applyHistoryEntry, createEntry: createHistoryEntry });
  }, [applyHistoryEntry, createHistoryEntry, redoHistory]);

  const updatePageDetail = (
    pageId: string,
    update: (page: PageDetail) => PageDetail,
    historyMode: EditHistoryMode = "record",
  ) => {
    const page = pageDetails.get(pageId);

    if (!page) {
      return;
    }

    recordEditorHistory(historyMode);
    setPageDetails((currentDetails) => {
      const currentPage = currentDetails.get(pageId);

      if (!currentPage) {
        return currentDetails;
      }

      const nextDetails = new Map(currentDetails);
      nextDetails.set(pageId, update(currentPage));

      return nextDetails;
    });
  };

  const editPageDocument = (
    pageId: string,
    nextDocument: PageDocument,
    historyMode: EditHistoryMode = "record",
  ) => {
    updatePageDetail(pageId, (page) => replacePageDocument(page, nextDocument), historyMode);
    setPageStatus(pageId, "unsaved");
  };

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "z" ||
        isBookSettingsOpen ||
        photoPickerMode !== null ||
        isLibraryPickerOpen ||
        isStickerPickerOpen ||
        isWashiTapeGalleryOpen ||
        pngExportTarget
      ) {
        return;
      }

      // Fields that own a working undo stack keep Ctrl/Cmd+Z for themselves instead of rolling the
      // whole book back to the previous history entry.
      if (hasNativeUndoStack(event.target)) {
        return;
      }

      event.preventDefault();

      if (event.shiftKey) {
        redoBookEdit();
        return;
      }

      undoBookEdit();
    };

    document.addEventListener("keydown", handleHistoryShortcut);

    return () => document.removeEventListener("keydown", handleHistoryShortcut);
  }, [
    isBookSettingsOpen,
    photoPickerMode,
    isLibraryPickerOpen,
    isStickerPickerOpen,
    isWashiTapeGalleryOpen,
    pngExportTarget,
    redoBookEdit,
    undoBookEdit,
  ]);

  useEffect(() => {
    const handleDeleteShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.key !== "Delete" && event.key !== "Backspace") ||
        isBookSettingsOpen ||
        photoPickerMode !== null ||
        isLibraryPickerOpen ||
        isStickerPickerOpen ||
        isWashiTapeGalleryOpen ||
        pngExportTarget ||
        editingPageId
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (isTextEntryTarget(target)) {
        return;
      }

      if (!activePageId || selectedLayerIds.length === 0) {
        return;
      }

      event.preventDefault();

      for (const layerId of selectedLayerIds) {
        deletePageLayerRef.current(activePageId, layerId);
      }
    };

    document.addEventListener("keydown", handleDeleteShortcut);

    return () => document.removeEventListener("keydown", handleDeleteShortcut);
  }, [
    activePageId,
    editingPageId,
    isBookSettingsOpen,
    isLibraryPickerOpen,
    isStickerPickerOpen,
    isWashiTapeGalleryOpen,
    photoPickerMode,
    pngExportTarget,
    selectedLayerIds,
  ]);

  const changePageTitle = (pageId: string, title: string) => {
    updatePageDetail(pageId, (page) => ({ ...page, title }));
    setPageStatus(pageId, "unsaved");
  };

  const changePageBackground = (pageId: string, backgroundColor: string) => {
    const page = pageDetails.get(pageId);

    if (!page) {
      return;
    }

    editPageDocument(pageId, updateCanvas(page.document, { backgroundColor }));
  };

  const unsavedPageIds = useMemo(
    () =>
      Object.entries(pageStatuses)
        .filter(([pageId, status]) => status === "unsaved" && pageDetails.has(pageId))
        .map(([pageId]) => pageId),
    [pageDetails, pageStatuses],
  );

  const isSavingPages = useMemo(
    () => Object.values(pageStatuses).some((status) => status === "saving"),
    [pageStatuses],
  );

  const savePages = useCallback(
    (pageIds: string[]) => {
      const pagesToSave = pageIds
        .map((pageId) => pageDetails.get(pageId))
        .filter((page): page is PageDetail => Boolean(page));

      if (pagesToSave.length === 0) {
        return;
      }

      setPageStatuses((currentStatuses) => ({
        ...currentStatuses,
        ...Object.fromEntries(pagesToSave.map((page) => [page.id, "saving"])),
      }));

      void Promise.allSettled(
        pagesToSave.map((page) =>
          apiClient.updatePage(page.id, {
            document: page.document,
            title: page.title,
          }),
        ),
      ).then((saveResults) => {
        const savedPageIds: string[] = [];
        const failedPageIds: string[] = [];
        const firstFailure = saveResults.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );

        for (const [index, saveResult] of saveResults.entries()) {
          const page = pagesToSave[index];

          if (!page) {
            continue;
          }

          if (saveResult.status === "fulfilled") {
            savedPageIds.push(page.id);
          } else {
            failedPageIds.push(page.id);
          }
        }

        if (savedPageIds.length > 0) {
          setPageStatuses((currentStatuses) => ({
            ...currentStatuses,
            ...Object.fromEntries(
              savedPageIds
                .filter((pageId) => currentStatuses[pageId] === "saving")
                .map((pageId) => [pageId, "saved"]),
            ),
          }));
        }

        if (failedPageIds.length > 0) {
          setPageStatuses((currentStatuses) => ({
            ...currentStatuses,
            ...Object.fromEntries(
              failedPageIds
                .filter((pageId) => currentStatuses[pageId] === "saving")
                .map((pageId) => [pageId, "error"]),
            ),
          }));
          setError(getErrorMessage(firstFailure?.reason ?? "Failed to save page"));
        }
      });
    },
    [pageDetails],
  );

  const saveUnsavedPages = useCallback(() => {
    savePages(unsavedPageIds);
  }, [savePages, unsavedPageIds]);

  useEffect(() => {
    if (unsavedPageIds.length === 0) {
      return;
    }

    const autosaveTimer = window.setTimeout(saveUnsavedPages, 700);

    return () => window.clearTimeout(autosaveTimer);
  }, [saveUnsavedPages, unsavedPageIds]);

  const applySpreadLayerSync = (
    result: SpreadLayerSyncResult,
    options: {
      historyMode?: EditHistoryMode;
      selectContainingPage?: boolean;
      selectedLayerIds?: string[];
    } = {},
  ) => {
    if (result.changedPageIds.length > 0) {
      recordEditorHistory(options.historyMode);
    }

    setPageDetails(result.details);
    setPagesStatus(result.changedPageIds, "unsaved");

    if (options.selectContainingPage && result.containingPageId) {
      setActivePageId(result.containingPageId);
    }

    if (options.selectedLayerIds !== undefined) {
      setSelectedLayerIds(options.selectedLayerIds);
    }
  };

  const updateSharedSpreadLayer = ({
    removeNonOverlappingSource,
    selectContainingPage,
    sourceLayer,
    sourcePageId,
    historyMode,
  }: {
    historyMode?: EditHistoryMode;
    removeNonOverlappingSource: boolean;
    selectContainingPage: boolean;
    sourceLayer: PageLayer;
    sourcePageId: string;
  }) => {
    const syncOptions: {
      historyMode?: EditHistoryMode;
      selectContainingPage: boolean;
      selectedLayerIds: string[];
    } = { selectContainingPage, selectedLayerIds: [sourceLayer.id] };

    if (historyMode !== undefined) {
      syncOptions.historyMode = historyMode;
    }

    applySpreadLayerSync(
      syncLayerAcrossSpread({
        details: pageDetails,
        removeNonOverlappingSource,
        sourceLayer,
        sourcePageId,
        spreadPageIds: visiblePageIds,
      }),
      syncOptions,
    );
  };

  const updateLayerTransform = (
    pageId: string,
    layerId: string,
    update: Partial<PageLayer>,
    historyMode: EditHistoryMode = "record",
  ) => {
    const page = pageDetails.get(pageId);

    if (!page) {
      return;
    }

    const editHistoryMode = getLayerEditHistoryMode(pageId, layerId, update, historyMode);
    const nextDocument = updateLayer(page.document, layerId, update);
    const nextLayer = nextDocument.layers.find((layer) => layer.id === layerId);

    if (viewMode === "spread" && nextLayer && visiblePageIds.length > 1) {
      updateSharedSpreadLayer({
        historyMode: editHistoryMode,
        removeNonOverlappingSource: false,
        selectContainingPage: false,
        sourceLayer: nextLayer,
        sourcePageId: pageId,
      });
      return;
    }

    editPageDocument(pageId, nextDocument, editHistoryMode);
  };

  const finishLayerTransform = (
    pageId: string,
    layerId: string,
    update: Partial<PageLayer> | null,
  ) => {
    const page = pageDetails.get(pageId);

    if (!page || !update) {
      endHistoryGroup();
      return;
    }

    const nextDocument = updateLayer(page.document, layerId, update);
    const nextLayer = nextDocument.layers.find((layer) => layer.id === layerId);

    if (viewMode === "spread" && nextLayer && visiblePageIds.length > 1) {
      updateSharedSpreadLayer({
        historyMode: "group",
        removeNonOverlappingSource: true,
        selectContainingPage: true,
        sourceLayer: nextLayer,
        sourcePageId: pageId,
      });
      endHistoryGroup();
      return;
    }

    editPageDocument(pageId, nextDocument, "group");
    endHistoryGroup();
  };

  const updateLayerTransforms = (
    pageId: string,
    updates: { layerId: string; update: Partial<PageLayer> }[],
  ) => {
    if (updates.length === 0) return;
    const page = pageDetails.get(pageId);
    if (!page) return;
    let nextDocument = page.document;
    for (const { layerId, update } of updates) {
      nextDocument = updateLayer(nextDocument, layerId, update);
    }
    editPageDocument(pageId, nextDocument, "group");
  };

  const finishLayerTransforms = (
    pageId: string,
    updates: { layerId: string; update: Partial<PageLayer> }[] | null,
  ) => {
    if (updates && updates.length > 0) {
      updateLayerTransforms(pageId, updates);
    }
    endHistoryGroup();
  };

  /** Applies the arrange panel's plan as a single undo step. */
  const applyArrange = () => {
    if (!activePage || !arrangePlan || arrangePlan.updates.length === 0) return;
    const pageId = activePage.id;
    let nextDocument = activePage.document;
    for (const { layerId, update } of arrangePlan.updates) {
      nextDocument = updateLayer(nextDocument, layerId, update);
    }

    if (viewMode === "spread" && visiblePageIds.length > 1) {
      let details = pageDetails;
      const changedPageIds = new Set<string>();
      for (const { layerId } of arrangePlan.updates) {
        const sourceLayer = nextDocument.layers.find((layer) => layer.id === layerId);
        if (!sourceLayer) continue;
        const result = syncLayerAcrossSpread({
          details,
          removeNonOverlappingSource: true,
          sourceLayer,
          sourcePageId: pageId,
          spreadPageIds: visiblePageIds,
        });
        details = result.details;
        for (const changedPageId of result.changedPageIds) changedPageIds.add(changedPageId);
      }
      // Layers moved wholly onto the facing page leave the active page, so drop them from the
      // selection.
      const remainingLayerIds = new Set(
        details.get(pageId)?.document.layers.map((layer) => layer.id) ?? [],
      );
      applySpreadLayerSync(
        { changedPageIds: [...changedPageIds], containingPageId: pageId, details },
        { selectedLayerIds: selectedLayerIds.filter((layerId) => remainingLayerIds.has(layerId)) },
      );
      return;
    }

    editPageDocument(pageId, nextDocument);
  };

  const reorderPageLayer = (pageId: string, layerId: string, command: ReorderLayerCommand) => {
    if (viewMode === "spread" && visibleSpreadPages.length > 1) {
      const nextDetails = new Map(pageDetails);
      const changedPageIds: string[] = [];

      for (const spreadPage of visibleSpreadPages) {
        const currentLayers = spreadPage.page.document.layers;
        const currentIndex = currentLayers.findIndex((layer) => layer.id === layerId);

        if (currentIndex < 0) {
          continue;
        }

        const lastIndex = currentLayers.length - 1;
        const toIndex =
          command === "top"
            ? lastIndex
            : command === "bottom"
              ? 0
              : command === "up"
                ? Math.min(lastIndex, currentIndex + 1)
                : Math.max(0, currentIndex - 1);

        if (toIndex === currentIndex) {
          continue;
        }

        nextDetails.set(
          spreadPage.pageId,
          replacePageDocument(
            spreadPage.page,
            reorderLayer(spreadPage.page.document, layerId, toIndex),
          ),
        );
        changedPageIds.push(spreadPage.pageId);
      }

      if (changedPageIds.length > 0) {
        recordEditorHistory();
        setPageDetails(nextDetails);
        setPagesStatus(changedPageIds, "unsaved");
      }

      setActivePageId(pageId);
      setSelectedLayerIds([layerId]);
      return;
    }

    const page = pageDetails.get(pageId);

    if (!page) {
      return;
    }

    const currentIndex = page.document.layers.findIndex((layer) => layer.id === layerId);

    if (currentIndex < 0) {
      return;
    }

    const lastIndex = page.document.layers.length - 1;
    const toIndex =
      command === "top"
        ? lastIndex
        : command === "bottom"
          ? 0
          : command === "up"
            ? Math.min(lastIndex, currentIndex + 1)
            : Math.max(0, currentIndex - 1);

    if (toIndex === currentIndex) {
      setActivePageId(pageId);
      setSelectedLayerIds([layerId]);
      return;
    }

    editPageDocument(pageId, reorderLayer(page.document, layerId, toIndex));
    setActivePageId(pageId);
    setSelectedLayerIds([layerId]);
  };

  const deletePageLayer = (pageId: string, layerId: string) => {
    const page = pageDetails.get(pageId);

    if (!page) {
      return;
    }

    const layer = page.document.layers.find((candidateLayer) => candidateLayer.id === layerId);

    if (viewMode === "spread" && layer && visiblePageIds.length > 1) {
      const nextDetails = new Map(pageDetails);
      const changedPageIds: string[] = [];

      for (const spreadPage of visibleSpreadPages) {
        const currentPage = nextDetails.get(spreadPage.pageId);

        if (!currentPage?.document.layers.some((candidateLayer) => candidateLayer.id === layerId)) {
          continue;
        }

        nextDetails.set(
          spreadPage.pageId,
          replacePageDocument(currentPage, deleteLayer(currentPage.document, layerId)),
        );
        changedPageIds.push(spreadPage.pageId);
      }

      applySpreadLayerSync({ changedPageIds, containingPageId: pageId, details: nextDetails });
      setActivePageId(pageId);
      setSelectedLayerIds((currentIds) => currentIds.filter((id) => id !== layerId));
      return;
    }

    editPageDocument(pageId, deleteLayer(page.document, layerId));
    setActivePageId(pageId);
    setSelectedLayerIds((currentIds) => currentIds.filter((id) => id !== layerId));
  };

  const deletePageLayerRef = useRef(deletePageLayer);
  deletePageLayerRef.current = deletePageLayer;

  const addText = () => {
    if (!activePage) {
      return;
    }

    const layer = createTextLayer({ text: "New text" });
    editPageDocument(activePage.id, addLayer(activePage.document, layer));
    setSelectedLayerIds([layer.id]);
  };

  const addPhotoFromDrop = (pageId: string, asset: Asset, point: { x: number; y: number }) => {
    const page = pageDetails.get(pageId);
    if (!page) return;

    const width = Math.min(page.document.canvas.width * 0.5, 1000);
    const height = Math.min(page.document.canvas.height * 0.34, 760);
    const layer = createPhotoLayer({
      assetId: asset.id,
      width,
      height,
      x: Math.round(Math.max(0, Math.min(page.document.canvas.width - width, point.x - width / 2))),
      y: Math.round(
        Math.max(0, Math.min(page.document.canvas.height - height, point.y - height / 2)),
      ),
    });

    editPageDocument(pageId, addLayer(page.document, layer));
    setActivePageId(pageId);
    setSelectedLayerIds([layer.id]);
  };

  const fillPhotoPlaceholder = (pageId: string, layerId: string, asset: Asset): boolean => {
    // Imported spread-spanning frames are mirrored on both facing pages, so fill every copy in the
    // page's spread even when the editor is in Page view or has navigated away.
    const spreadPageIds = book?.spreads.find((spread) => spread.pageIds.includes(pageId))
      ?.pageIds ?? [pageId];
    const result = fillPhotoPlaceholderAcrossSpread({
      assetId: asset.id,
      details: pageDetails,
      layerId,
      sourcePageId: pageId,
      spreadPageIds,
    });
    if (!result.containingPageId) return false;

    applySpreadLayerSync(result, { selectedLayerIds: [layerId] });
    setActivePageId(pageId);
    return true;
  };

  const placeDroppedPhoto = (
    pageId: string,
    asset: Asset,
    point: { x: number; y: number },
    placeholder?: PlaceholderTarget,
  ) => {
    if (placeholder && fillPhotoPlaceholder(placeholder.pageId, placeholder.layerId, asset)) return;
    addPhotoFromDrop(pageId, asset, point);
  };

  // Uploads finish after later renders, so file drops must place photos against the latest pages.
  const placeDroppedPhotoRef = useRef(placeDroppedPhoto);
  placeDroppedPhotoRef.current = placeDroppedPhoto;

  const addPhotosFromFileDrop = async (
    pageId: string,
    files: File[],
    point: { x: number; y: number },
    placeholder?: PlaceholderTarget,
  ) => {
    if (!book || files.length === 0) {
      return;
    }

    setError(null);

    const failures: string[] = [];
    let dropOffset = 0;

    for (const file of files) {
      try {
        const uploadedAsset = await apiClient.uploadAsset(file);
        const bookAssetsResponse = await apiClient.addBookAssets(book.id, {
          assetIds: [uploadedAsset.id],
        });
        setAssets(bookAssetsResponse.assets);
        placeDroppedPhotoRef.current(
          pageId,
          uploadedAsset,
          { x: point.x + dropOffset, y: point.y + dropOffset },
          // Only the first photo fills the placeholder; the rest land on the page as usual.
          dropOffset === 0 ? placeholder : undefined,
        );
        dropOffset += 24;
      } catch (uploadError: unknown) {
        failures.push(`${file.name}: ${getErrorMessage(uploadError)}`);
      }
    }

    if (failures.length > 0) {
      setError(failures.join(" "));
    }
  };

  const addWashiTape = async (design: WashiTapeDesign) => {
    if (!activePage) {
      return;
    }

    const pageId = activePage.id;
    const patternAssetId = design.pattern.kind === "customPhoto" ? design.pattern.assetId : null;

    // Saved tapes can use any library photo; the book must reference it before the canvas can
    // render it, so only place the tape once that reference is saved.
    if (book && patternAssetId && !assets.some((asset) => asset.id === patternAssetId)) {
      try {
        const response = await apiClient.addBookAssets(book.id, { assetIds: [patternAssetId] });
        setAssets((current) => {
          const currentIds = new Set(current.map((asset) => asset.id));
          return [...current, ...response.assets.filter((asset) => !currentIds.has(asset.id))];
        });
      } catch (referenceError: unknown) {
        setError(getErrorMessage(referenceError));
        return;
      }
    }

    const canvas = activePage.document.canvas;
    const layer = createWashiTapeLayer({
      ...design,
      width: Math.min(canvas.width * 0.56, 1120),
      height: Math.min(canvas.height * 0.08, 220),
      x: canvas.width * 0.16,
      y: canvas.height * 0.16,
    });

    updatePageDetail(pageId, (page) => replacePageDocument(page, addLayer(page.document, layer)));
    setPageStatus(pageId, "unsaved");
    setSelectedLayerIds([layer.id]);
  };

  const setWashiTapePhotoPattern = (asset: Asset) => {
    if (photoPickerMode?.kind !== "washiTapePattern") {
      return;
    }

    const page = pageDetails.get(photoPickerMode.pageId);
    const layer = page?.document.layers.find(
      (candidateLayer) => candidateLayer.id === photoPickerMode.layerId,
    );

    if (!page || layer?.kind !== "washiTape") {
      return;
    }

    editPageDocument(
      page.id,
      updateLayer(page.document, layer.id, {
        pattern: {
          ...layer.pattern,
          assetId: asset.id,
          kind: "customPhoto",
        },
      } as Partial<WashiTapeLayer> as Partial<PageLayer>),
    );
    setActivePageId(page.id);
    setSelectedLayerIds([layer.id]);
  };

  const addSticker = (sticker: StickerDefinition) => {
    if (!activePage) {
      return;
    }

    const size = Math.min(
      activePage.document.canvas.width * 0.18,
      activePage.document.canvas.height * 0.18,
      420,
    );
    const layer = createStickerLayer({
      stickerId: sticker.id,
      width: size,
      height: size,
      x: activePage.document.canvas.width * 0.12,
      y: activePage.document.canvas.height * 0.12,
    });

    editPageDocument(activePage.id, addLayer(activePage.document, layer));
    setSelectedLayerIds([layer.id]);
  };

  const renameBook = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!book) {
      return;
    }

    setIsWorking(true);
    setError(null);

    try {
      const pageSize = getBookPageSizeByKey(bookPageSizeDraft);
      const nextPageSize =
        bookPageSizeDraft === customBookPageSizeKey
          ? null
          : { width: pageSize.width, height: pageSize.height };
      const pageSizeChanged = Boolean(
        nextPageSize &&
          (book.pageWidth !== nextPageSize.width || book.pageHeight !== nextPageSize.height),
      );
      const updatedBook = await apiClient.updateBook(book.id, {
        title: bookTitleDraft,
        coverSpreadEnabled: coverSpreadEnabledDraft,
        ...(bookPageSizeDraft === customBookPageSizeKey
          ? {}
          : { pageWidth: pageSize.width, pageHeight: pageSize.height }),
      });

      if (pageSizeChanged && nextPageSize) {
        const resizedPages = orderedPageIds
          .map((pageId) => pageDetails.get(pageId))
          .filter((page): page is PageDetail => Boolean(page))
          .map((page) =>
            replacePageDocument(
              page,
              resizePageDocument(
                page.document,
                { width: nextPageSize.width, height: nextPageSize.height },
                { anchor: pageResizeAnchor, mode: pageResizeMode },
              ),
            ),
          );

        setPageDetails((currentDetails) => {
          const nextDetails = new Map(currentDetails);

          for (const page of resizedPages) {
            nextDetails.set(page.id, page);
          }

          return nextDetails;
        });
        setPagesStatus(
          resizedPages.map((page) => page.id),
          "saving",
        );

        await Promise.all(
          resizedPages.map((page) =>
            apiClient.updatePage(page.id, {
              document: page.document,
              title: page.title,
            }),
          ),
        );
        setPagesStatus(
          resizedPages.map((page) => page.id),
          "saved",
        );
      }

      setBook(updatedBook);
      setBookTitleDraft(updatedBook.title);
      setBookPageSizeDraft(getBookPageSizeKey(updatedBook));
      setCoverSpreadEnabledDraft(updatedBook.coverSpreadEnabled);
      setIsBookSettingsOpen(false);
    } catch (renameError: unknown) {
      setError(getErrorMessage(renameError));
    } finally {
      setIsWorking(false);
    }
  };

  const requestDeleteBook = () => {
    setIsBookSettingsOpen(false);
    setIsDeleteBookConfirmationOpen(true);
  };

  const deleteBook = async () => {
    if (!book) {
      return;
    }

    setIsWorking(true);
    setError(null);

    try {
      await apiClient.deleteBook(book.id);
      setIsDeleteBookConfirmationOpen(false);
      navigate("/books", { replace: true });
    } catch (deleteError: unknown) {
      setError(getErrorMessage(deleteError));
    } finally {
      setIsWorking(false);
    }
  };

  const addPage = async () => {
    if (!book) {
      return;
    }

    setIsWorking(true);
    setError(null);

    try {
      const page = await apiClient.createPage({
        document: createPageDocument({
          canvas: { width: book.pageWidth, height: book.pageHeight },
        }),
        title: `Page ${book.pages.length + 1}`,
      });
      const nextPageIds = [...orderedPageIds];
      const insertionIndex = Math.max(0, nextPageIds.length - 1);

      nextPageIds.splice(insertionIndex, 0, page.id);
      await apiClient.setBookPages(book.id, {
        pageIds: nextPageIds,
      });
      await reloadBook(page.id);
    } catch (addError: unknown) {
      setError(getErrorMessage(addError));
    } finally {
      setIsWorking(false);
    }
  };

  const duplicateBookPage = async (pageId: string) => {
    if (!book) {
      return;
    }

    const page = pageDetails.get(pageId);
    const pageIndex = orderedPageIds.indexOf(pageId);

    if (!page || pageIndex < 0) {
      return;
    }

    setIsWorking(true);
    setError(null);

    try {
      const duplicated = await apiClient.duplicatePage(page.id, {
        title: `${page.title} copy`,
      });
      const nextPageIds = [...orderedPageIds];
      nextPageIds.splice(pageIndex + 1, 0, duplicated.id);
      await apiClient.setBookPages(book.id, { pageIds: nextPageIds });
      setEditingPageId(duplicated.id);
      await reloadBook(duplicated.id);
    } catch (duplicateError: unknown) {
      setError(getErrorMessage(duplicateError));
    } finally {
      setIsWorking(false);
    }
  };

  const deleteBookPage = async (pageId: string) => {
    if (!book) {
      return;
    }

    const page = pageDetails.get(pageId);
    const pageIndex = orderedPageIds.indexOf(pageId);

    if (!page || pageIndex < 0) {
      return;
    }

    const nextPageIds = orderedPageIds.filter((orderedPageId) => orderedPageId !== pageId);
    const nextActivePageId =
      activePageId === pageId
        ? (nextPageIds[pageIndex] ?? nextPageIds[pageIndex - 1] ?? null)
        : activePageId;

    setIsWorking(true);
    setError(null);

    try {
      await apiClient.setBookPages(book.id, { pageIds: nextPageIds });
      await apiClient.deletePage(page.id);
      setEditingPageId((currentPageId) => (currentPageId === page.id ? null : currentPageId));
      await reloadBook(nextActivePageId);
    } catch (deleteError: unknown) {
      setError(getErrorMessage(deleteError));
    } finally {
      setIsWorking(false);
    }
  };

  const reorderBookPages = async (
    sourcePageIds: string[],
    targetPageId: string,
    position: PageDropPosition,
  ) => {
    if (!book) {
      return;
    }

    const nextPageIds = movePageIds(orderedPageIds, sourcePageIds, targetPageId, position);

    if (!nextPageIds) {
      return;
    }

    setIsWorking(true);
    setError(null);

    try {
      await apiClient.setBookPages(book.id, { pageIds: nextPageIds });
      await reloadBook(activePageId);
    } catch (reorderError: unknown) {
      setError(getErrorMessage(reorderError));
    } finally {
      setIsWorking(false);
    }
  };

  const getPageDropPosition = (event: DragEvent<HTMLElement>): PageDropPosition => {
    const targetBounds = event.currentTarget.getBoundingClientRect();

    return event.clientX > targetBounds.left + targetBounds.width / 2 ? "after" : "before";
  };

  const getDraggedPageIds = (pageId: string) =>
    markedPageIds.includes(pageId) ? orderPageIds(orderedPageIds, markedPageIds) : [pageId];

  const readDraggedPageIds = (event: DragEvent<HTMLLIElement>) => {
    if (draggedPageIds.length > 0) {
      return draggedPageIds;
    }

    const transferred = event.dataTransfer.getData("text/plain");

    return transferred ? transferred.split(",").filter(Boolean) : [];
  };

  const setMultiPageDragImage = (event: DragEvent<HTMLLIElement>, pageCount: number) => {
    const ghost = document.createElement("div");

    ghost.className = "book-filmstrip-drag-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.textContent = `Moving ${pageCount} pages`;
    document.body.append(ghost);
    event.dataTransfer.setDragImage(ghost, 12, 12);
    window.setTimeout(() => ghost.remove(), 0);
  };

  const handlePageDragStart = (event: DragEvent<HTMLLIElement>, pageId: string) => {
    if (isWorking) {
      event.preventDefault();
      return;
    }

    const nextDraggedPageIds = getDraggedPageIds(pageId);

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", nextDraggedPageIds.join(","));

    if (nextDraggedPageIds.length > 1) {
      setMultiPageDragImage(event, nextDraggedPageIds.length);
    }

    setDraggedPageIds(nextDraggedPageIds);
  };

  const handlePageDragOver = (event: DragEvent<HTMLLIElement>, pageId: string) => {
    const sourcePageIds = readDraggedPageIds(event);

    if (sourcePageIds.length === 0 || sourcePageIds.includes(pageId) || isWorking) {
      setPageDropTarget(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setPageDropTarget({ pageId, position: getPageDropPosition(event) });
  };

  const handlePageDrop = async (event: DragEvent<HTMLLIElement>, pageId: string) => {
    event.preventDefault();

    const sourcePageIds = readDraggedPageIds(event);
    const position = getPageDropPosition(event);
    setDraggedPageIds([]);
    setPageDropTarget(null);

    if (sourcePageIds.length === 0 || isWorking) {
      return;
    }

    await reorderBookPages(sourcePageIds, pageId, position);
  };

  const clearPageDragState = () => {
    setDraggedPageIds([]);
    setPageDropTarget(null);
  };

  const navigateBook = (direction: -1 | 1) => {
    if (viewMode === "spread" && book) {
      const nextSpread = book.spreads[activeSpreadIndex + direction];
      const nextSpreadPageId = nextSpread?.pageIds[0];

      if (nextSpreadPageId) {
        selectPage(nextSpreadPageId);
      }

      return;
    }

    const nextPageId = orderedPageIds[activePageIndex + direction];

    if (nextPageId) {
      selectPage(nextPageId);
    }
  };

  const exportBook = async (format: "pdf" | "png", settings: Partial<PngExportSettings> = {}) => {
    if (!book || book.pages.length === 0) {
      return;
    }

    setIsWorking(true);
    setError(null);
    setExportJob(null);
    setPendingExportFormat(format);

    try {
      setExportJob(
        await apiClient.createExport({
          bookId: book.id,
          ...(settings.dpi === undefined ? {} : { dpi: settings.dpi }),
          format,
          includeBackground: settings.includeBackground ?? true,
          preset: "print",
        }),
      );
    } catch (exportError: unknown) {
      setError(getErrorMessage(exportError));
    } finally {
      setPendingExportFormat(null);
      setIsWorking(false);
    }
  };

  const submitPngExport = (settings: PngExportSettings) => {
    const target = pngExportTarget;

    setPngExportTarget(null);

    if (target === "book") {
      void exportBook("png", settings);
    }
  };

  const exportDownloadLabel = exportJob
    ? exportJob.targetKind === "book" && exportJob.format === "png"
      ? "Download book PNG ZIP"
      : `Download ${exportJob.targetKind} ${exportJob.format.toUpperCase()}`
    : "";
  const pendingExportLabel = pendingExportFormat
    ? pendingExportFormat === "png"
      ? "Preparing book PNG ZIP export"
      : "Preparing book PDF export"
    : null;

  const getSpreadPreviewLayers = (pageId: string): CanvasPreviewLayer[] => {
    if (viewMode !== "spread" || visibleSpreadPages.length < 2) {
      return [];
    }

    const targetPage = visibleSpreadPages.find((spreadPage) => spreadPage.pageId === pageId);

    if (!targetPage) {
      return [];
    }

    const existingLayerIds = new Set(targetPage.page.document.layers.map((layer) => layer.id));
    const previewLayers: CanvasPreviewLayer[] = [];

    for (const sourcePage of visibleSpreadPages) {
      if (sourcePage.pageId === pageId) {
        continue;
      }

      for (const [stackIndex, layer] of sourcePage.page.document.layers.entries()) {
        if (existingLayerIds.has(layer.id)) {
          continue;
        }

        const projectedLayer = {
          ...layer,
          x: sourcePage.offsetX + layer.x - targetPage.offsetX,
        };

        if (layerOverlapsPageCanvas(projectedLayer, targetPage.page.document)) {
          previewLayers.push({
            layer: projectedLayer,
            sourcePageId: sourcePage.pageId,
            stackIndex,
          });
        }
      }
    }

    return previewLayers;
  };

  if (isLoading || !book) {
    return (
      <>
        <WorkspaceHeader title="Book editor" />
        {error ? (
          <p className="panel-alert" role="alert">
            {error}
          </p>
        ) : (
          <p className="empty-state">Loading book</p>
        )}
      </>
    );
  }

  return (
    <div className="book-editor-page">
      <BookEditorHeader
        title={book.title}
        hasPages={book.pages.length > 0}
        isWorking={isWorking}
        onEditSettings={() => setIsBookSettingsOpen(true)}
        onExportBookPdf={() => exportBook("pdf")}
        onExportBookPng={() => setPngExportTarget("book")}
      />
      {pngExportTarget ? (
        <PngExportSettingsModal
          closeDisabled={isWorking}
          onClose={() => setPngExportTarget(null)}
          onSubmit={submitPngExport}
        />
      ) : null}
      {photoPickerMode ? (
        photoPickerMode.kind === "photoPlaceholder" ? (
          <PhotoPickerModal
            actionLabel="Add to placeholder"
            assets={assets}
            title="Choose photo"
            onAddPhoto={(asset) => {
              fillPhotoPlaceholder(photoPickerMode.pageId, photoPickerMode.layerId, asset);
              setPhotoPickerMode(null);
            }}
            onClose={() => setPhotoPickerMode(null)}
          />
        ) : (
          <PhotoPickerModal
            actionLabel="Use as pattern"
            assets={assets}
            title="Choose pattern photo"
            onAddPhoto={setWashiTapePhotoPattern}
            onClose={() => setPhotoPickerMode(null)}
          />
        )
      ) : null}
      {isLibraryPickerOpen ? (
        <BookLibraryPickerModal
          bookId={book.id}
          referencedAssetIds={new Set(assets.map((asset) => asset.id))}
          onAdded={(referencedAssets) => setAssets(referencedAssets)}
          onClose={() => setIsLibraryPickerOpen(false)}
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
      {isBookSettingsOpen ? (
        <BookSettingsModal
          book={book}
          closeDisabled={isWorking}
          coverSpreadEnabledDraft={coverSpreadEnabledDraft}
          pageResizeAnchor={pageResizeAnchor}
          pageResizeMode={pageResizeMode}
          pageSizeDraft={bookPageSizeDraft}
          titleDraft={bookTitleDraft}
          onClose={() => setIsBookSettingsOpen(false)}
          onCoverSpreadEnabledDraftChange={setCoverSpreadEnabledDraft}
          onDeleteRequest={requestDeleteBook}
          onPageResizeAnchorChange={setPageResizeAnchor}
          onPageResizeModeChange={setPageResizeMode}
          onPageSizeDraftChange={setBookPageSizeDraft}
          onSubmit={renameBook}
          onTitleDraftChange={setBookTitleDraft}
        />
      ) : null}
      {isDeleteBookConfirmationOpen ? (
        <AppModal
          title="Delete book?"
          size="compact"
          closeDisabled={isWorking}
          onClose={() => setIsDeleteBookConfirmationOpen(false)}
        >
          <div className="delete-book-confirmation">
            <p>This will remove the book from your library. This action cannot be undone.</p>
            <div className="delete-book-confirmation-actions">
              <Button
                type="button"
                className="secondary-button"
                disabled={isWorking}
                icon={<DismissRegular />}
                onClick={() => setIsDeleteBookConfirmationOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="danger-button"
                disabled={isWorking}
                icon={<DeleteRegular />}
                onClick={deleteBook}
              >
                Delete book
              </Button>
            </div>
          </div>
        </AppModal>
      ) : null}
      <div className="book-editor-notices">
        {error ? (
          <p className="panel-alert" role="alert">
            {error}
          </p>
        ) : null}
        {pendingExportLabel ? <ProcessingBanner>{pendingExportLabel}</ProcessingBanner> : null}
        {exportJob?.outputContentUrl ? (
          <p className="download-banner">
            <a href={exportJob.outputContentUrl} target="_blank" rel="noreferrer">
              {exportDownloadLabel}
            </a>
          </p>
        ) : null}
      </div>
      <div className="book-editor-shell">
        <AssetRail
          mode="referenced"
          referencedAssets={assets}
          isPhotoPickerDisabled={!activePage}
          isStickerPickerDisabled={!activePage}
          inspector={
            activePageId && (selectedLayer || arrangeLayers.length > 1)
              ? {
                  actions: (
                    <div className="editor-edit-pane-actions">
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<ArrowUndoRegular />}
                        aria-label="Undo"
                        title="Undo (Ctrl/Cmd+Z)"
                        disabled={!canUndo}
                        onClick={undoBookEdit}
                      />
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<ArrowRedoRegular />}
                        aria-label="Redo"
                        title="Redo (Ctrl/Cmd+Shift+Z)"
                        disabled={!canRedo}
                        onClick={redoBookEdit}
                      />
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<SaveRegular />}
                        aria-label={isSavingPages ? "Saving" : "Save"}
                        title={
                          isSavingPages
                            ? "Saving…"
                            : unsavedPageIds.length > 0
                              ? "Save now"
                              : "All changes saved"
                        }
                        disabled={isSavingPages || unsavedPageIds.length === 0}
                        onClick={saveUnsavedPages}
                      />
                    </div>
                  ),
                  title: selectedLayer
                    ? `Edit ${formatLayerKindLabel(selectedLayer.kind)}`
                    : `${arrangeLayers.length} layers selected`,
                  tabs: (
                    <InspectorTabs
                      activeTab={inspectorTab}
                      canArrange={canArrangeSelection}
                      layerCount={arrangeLayers.length}
                      onSelect={selectInspectorTab}
                    />
                  ),
                  content:
                    selectedLayer && inspectorTab === "properties" ? (
                      <LayerInspector
                        layer={selectedLayer}
                        onChange={(update) =>
                          updateLayerTransform(activePageId, selectedLayer.id, update)
                        }
                        onChooseWashiTapePhoto={(layerId) =>
                          setPhotoPickerMode({
                            kind: "washiTapePattern",
                            pageId: activePageId,
                            layerId,
                          })
                        }
                        onChoosePhoto={(layerId) =>
                          setPhotoPickerMode({
                            kind: "photoPlaceholder",
                            pageId: activePageId,
                            layerId,
                          })
                        }
                      />
                    ) : (
                      <ArrangePanel
                        canApply={canApplyArrange}
                        isPreviewEnabled={isArrangePreviewEnabled}
                        movableLayerCount={arrangeLayers.filter((layer) => !layer.locked).length}
                        settings={arrangeSettings}
                        singleLayer={isSingleLayerArrange}
                        onApply={applyArrange}
                        onPreviewChange={setIsArrangePreviewEnabled}
                        onSettingsChange={setArrangeSettings}
                      />
                    ),
                }
              : null
          }
          onAddText={addText}
          onOpenLibraryPicker={() => setIsLibraryPickerOpen(true)}
          onOpenStickerPicker={() => setIsStickerPickerOpen(true)}
          onOpenWashiTapePicker={() => setIsWashiTapeGalleryOpen(true)}
        />
        <section className="book-editor-stage" aria-label="Book editor">
          <BookModeBar
            canNavigateNext={canNavigateNext}
            canNavigatePrevious={canNavigatePrevious}
            isWorking={isWorking}
            leftPageName={leftPageName}
            navigationLabel={navigationLabel}
            rightPageName={rightPageName}
            viewMode={viewMode}
            onNavigate={navigateBook}
            onViewModeChange={setViewMode}
          />
          {activePage ? (
            <>
              <BookCanvasDeck
                activePageId={activePage.id}
                activeSelectionPanel={activeSelectionPanel}
                arrangePreview={arrangePreview}
                assetById={assetById}
                getSpreadPreviewLayers={getSpreadPreviewLayers}
                orderedPageIds={orderedPageIds}
                pageDetails={pageDetails}
                selectedLayerIds={selectedLayerIds}
                {...(spreadReorderCapabilities ? { spreadReorderCapabilities } : {})}
                viewMode={viewMode}
                visiblePageIds={visiblePageIds}
                onActiveSelectionPanelChange={setActiveSelectionPanel}
                onChoosePhoto={(pageId, layerId) =>
                  setPhotoPickerMode({ kind: "photoPlaceholder", pageId, layerId })
                }
                onDeleteLayer={deletePageLayer}
                onDropAsset={(pageId, assetId, point, placeholder) => {
                  const asset = assetById.get(assetId);
                  if (!asset) return;
                  placeDroppedPhoto(pageId, asset, point, placeholder);
                }}
                onDropFiles={(pageId, files, point, placeholder) => {
                  void addPhotosFromFileDrop(pageId, files, point, placeholder);
                }}
                onReorderLayer={reorderPageLayer}
                onSelectLayer={selectLayer}
                onTransformEnd={finishLayerTransform}
                onTransformLayers={updateLayerTransforms}
                onTransformLayersEnd={finishLayerTransforms}
                onUpdateLayerTransform={updateLayerTransform}
              />
              {editingPage && editingPageId ? (
                <PageSettingsPanel
                  isWorking={isWorking}
                  page={editingPage}
                  pageId={editingPageId}
                  pageIndex={editingPageIndex}
                  onChangeBackground={changePageBackground}
                  onChangeTitle={changePageTitle}
                  onClose={() => setEditingPageId(null)}
                  onDelete={deleteBookPage}
                  onDuplicate={duplicateBookPage}
                />
              ) : null}
              <BookFilmstrip
                draggedPageIds={draggedPageIds}
                editingPageId={editingPageId}
                isWorking={isWorking}
                markedPageIds={markedPageIds}
                orderedPageIds={orderedPageIds}
                pageDetails={pageDetails}
                pageDropTarget={pageDropTarget}
                visiblePageIds={visiblePageIds}
                onAddPage={addPage}
                onClearDragState={clearPageDragState}
                onClearSelection={clearPageSelection}
                onDragOver={handlePageDragOver}
                onDragStart={handlePageDragStart}
                onDrop={(event, pageId) => void handlePageDrop(event, pageId)}
                onSelectPage={selectFilmstripPage}
                onTogglePageSettings={(pageId) => {
                  selectFilmstripPage(pageId, "replace");
                  setEditingPageId((currentPageId) => (currentPageId === pageId ? null : pageId));
                }}
              />
            </>
          ) : (
            <div className="empty-book-editor">
              <p>This book has no pages yet.</p>
              <Button
                appearance="primary"
                type="button"
                className="primary-button"
                disabled={isWorking}
                icon={<AddRegular />}
                onClick={addPage}
              >
                Add first page
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
