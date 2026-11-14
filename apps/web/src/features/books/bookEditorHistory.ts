import { useCallback, useRef, useState } from "react";

import type { PageDetail } from "../../types";

export type BookEditorHistoryEntry = {
  activePageId: string | null;
  editingPageId: string | null;
  pageDetails: Map<string, PageDetail>;
  selectedLayerIds: string[];
};

export type EditHistoryCoalesce = { coalesceToken: string };

export type EditHistoryMode = "group" | "record" | EditHistoryCoalesce;

type BookEditorHistoryState<Entry> = {
  redoStack: Entry[];
  undoStack: Entry[];
};

type BookEditorHistoryChange<Entry> = {
  applyEntry: (entry: Entry) => void;
  createEntry: () => Entry;
};

const bookEditorHistoryLimit = 100;

/**
 * Consecutive edits that share a coalesce token and land within this window collapse into a single
 * undo step, so typing a word or dragging a slider is not replayed one keystroke/tick at a time.
 */
const editHistoryCoalesceWindowMs = 700;

export const coalesceEdits = (coalesceToken: string): EditHistoryCoalesce => ({ coalesceToken });

/**
 * Identifies a continuous edit to a single map marker field (e.g. typing a label), so runs of it can
 * coalesce. Returns null for discrete changes (adding, removing, or reordering places) and for edits
 * touching several markers or fields, which must stay separate undo steps.
 */
export const getMapMarkerEditKey = <Marker extends { id: string }>(
  previousMarkers: readonly Marker[],
  nextMarkers: readonly Marker[],
): string | null => {
  if (previousMarkers.length !== nextMarkers.length) {
    return null;
  }

  let editKey: string | null = null;

  for (const [index, previousMarker] of previousMarkers.entries()) {
    const nextMarker = nextMarkers[index];

    if (!nextMarker || nextMarker.id !== previousMarker.id) {
      return null;
    }

    const previousFields = previousMarker as Record<string, unknown>;
    const nextFields = nextMarker as Record<string, unknown>;
    const changedFields = [
      ...new Set([...Object.keys(previousFields), ...Object.keys(nextFields)]),
    ].filter((field) => previousFields[field] !== nextFields[field]);

    if (changedFields.length === 0) {
      continue;
    }

    if (editKey !== null || changedFields.length !== 1) {
      return null;
    }

    editKey = `${previousMarker.id}.${changedFields[0]}`;
  }

  return editKey;
};

const createEmptyHistory = <Entry>(): BookEditorHistoryState<Entry> => ({
  redoStack: [],
  undoStack: [],
});

export const getChangedPageIds = (
  previousDetails: Map<string, PageDetail>,
  nextDetails: Map<string, PageDetail>,
): string[] => {
  const pageIds = new Set([...previousDetails.keys(), ...nextDetails.keys()]);

  return [...pageIds].filter((pageId) => previousDetails.get(pageId) !== nextDetails.get(pageId));
};

export function useBookEditorHistory<Entry>() {
  const [history, setHistory] = useState<BookEditorHistoryState<Entry>>(() => createEmptyHistory());
  const pendingHistoryEntryRef = useRef<Entry | null>(null);
  const coalesceRef = useRef<{ coalesceToken: string; timestamp: number } | null>(null);

  const resetHistory = useCallback(() => {
    pendingHistoryEntryRef.current = null;
    coalesceRef.current = null;
    setHistory(createEmptyHistory());
  }, []);

  const pushHistoryEntry = useCallback((entry: Entry) => {
    setHistory((currentHistory) => ({
      redoStack: [],
      undoStack: [...currentHistory.undoStack, entry].slice(-bookEditorHistoryLimit),
    }));
  }, []);

  const captureHistoryEntry = useCallback(
    (createEntry: () => Entry, isGroupStart: boolean) => {
      if (pendingHistoryEntryRef.current) {
        return;
      }

      const entry = createEntry();

      if (isGroupStart) {
        pendingHistoryEntryRef.current = entry;
      }

      pushHistoryEntry(entry);
    },
    [pushHistoryEntry],
  );

  const recordHistory = useCallback(
    (createEntry: () => Entry, historyMode: EditHistoryMode = "record") => {
      if (typeof historyMode === "object") {
        const timestamp = Date.now();
        const previousCoalesce = coalesceRef.current;

        coalesceRef.current = { coalesceToken: historyMode.coalesceToken, timestamp };

        if (
          previousCoalesce &&
          previousCoalesce.coalesceToken === historyMode.coalesceToken &&
          timestamp - previousCoalesce.timestamp <= editHistoryCoalesceWindowMs
        ) {
          return;
        }

        captureHistoryEntry(createEntry, false);
        return;
      }

      coalesceRef.current = null;
      captureHistoryEntry(createEntry, historyMode === "group");
    },
    [captureHistoryEntry],
  );

  const endHistoryGroup = useCallback(() => {
    pendingHistoryEntryRef.current = null;
    coalesceRef.current = null;
  }, []);

  const undoHistory = useCallback(
    ({ applyEntry, createEntry }: BookEditorHistoryChange<Entry>) => {
      const undoEntry = history.undoStack.at(-1);

      if (!undoEntry) {
        return;
      }

      const redoEntry = createEntry();
      pendingHistoryEntryRef.current = null;
      coalesceRef.current = null;

      setHistory((currentHistory) => ({
        redoStack: [...currentHistory.redoStack, redoEntry].slice(-bookEditorHistoryLimit),
        undoStack: currentHistory.undoStack.slice(0, -1),
      }));
      applyEntry(undoEntry);
    },
    [history.undoStack],
  );

  const redoHistory = useCallback(
    ({ applyEntry, createEntry }: BookEditorHistoryChange<Entry>) => {
      const redoEntry = history.redoStack.at(-1);

      if (!redoEntry) {
        return;
      }

      const undoEntry = createEntry();
      pendingHistoryEntryRef.current = null;
      coalesceRef.current = null;

      setHistory((currentHistory) => ({
        redoStack: currentHistory.redoStack.slice(0, -1),
        undoStack: [...currentHistory.undoStack, undoEntry].slice(-bookEditorHistoryLimit),
      }));
      applyEntry(redoEntry);
    },
    [history.redoStack],
  );

  return {
    canRedo: history.redoStack.length > 0,
    canUndo: history.undoStack.length > 0,
    endHistoryGroup,
    recordHistory,
    redoHistory,
    resetHistory,
    undoHistory,
  };
}
