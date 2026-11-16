import { Button, Tab, TabList } from "@fluentui/react-components";
import { PanelBottomRegular, PanelLeftRegular } from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";

export type DockLocation = "side" | "bottom";
export type DockPaneId = "pages" | "photos" | "edit";
export type DockLayout = Record<DockPaneId, DockLocation>;

export const defaultDockLayout: DockLayout = { pages: "bottom", photos: "side", edit: "side" };

const dockPaneIds: DockPaneId[] = ["pages", "photos", "edit"];
const dockLocations: DockLocation[] = ["side", "bottom"];
const dockStorageKey = "scrapbook:editor-dock";

type DockState = {
  layout: DockLayout;
  activePanes: Partial<Record<DockLocation, DockPaneId>>;
};

const isDockLocation = (value: unknown): value is DockLocation =>
  dockLocations.includes(value as DockLocation);

const isDockPaneId = (value: unknown): value is DockPaneId =>
  dockPaneIds.includes(value as DockPaneId);

const readDockState = (): DockState => {
  const state: DockState = { layout: { ...defaultDockLayout }, activePanes: {} };
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(dockStorageKey) ?? "null") as {
      layout?: Record<string, unknown>;
      activePanes?: Record<string, unknown>;
    } | null;
    for (const paneId of dockPaneIds) {
      const location = stored?.layout?.[paneId];
      if (isDockLocation(location)) state.layout[paneId] = location;
    }
    for (const location of dockLocations) {
      const paneId = stored?.activePanes?.[location];
      if (isDockPaneId(paneId)) state.activePanes[location] = paneId;
    }
  } catch {
    // Fall back to the default layout when stored state is missing or malformed.
  }
  return state;
};

const writeDockState = (state: DockState) => {
  try {
    globalThis.localStorage?.setItem(dockStorageKey, JSON.stringify(state));
  } catch {
    // Keep the in-memory layout usable if localStorage is unavailable.
  }
};

/** Which dock (side or bottom) each editor pane lives in; remembered across sessions. */
export function useDockLayout() {
  const [state, setState] = useState(readDockState);
  const updateState = useCallback((update: (current: DockState) => DockState) => {
    setState((current) => {
      const next = update(current);
      writeDockState(next);
      return next;
    });
  }, []);
  const movePane = useCallback(
    (paneId: DockPaneId, location: DockLocation) =>
      updateState((current) => ({
        layout: { ...current.layout, [paneId]: location },
        activePanes: { ...current.activePanes, [location]: paneId },
      })),
    [updateState],
  );
  const selectPane = useCallback(
    (location: DockLocation, paneId: DockPaneId) =>
      updateState((current) => ({
        ...current,
        activePanes: { ...current.activePanes, [location]: paneId },
      })),
    [updateState],
  );
  return { activePanes: state.activePanes, layout: state.layout, movePane, selectPane };
}

export type EditorDockPane = {
  id: DockPaneId;
  /** Short name used for tabs and the move button, e.g. "Photos". */
  label: string;
  /** Header title; defaults to the label. */
  title?: string;
  /** Muted text after the title, such as a count. */
  badge?: ReactNode;
  actions?: ReactNode;
  /** Optional tab strip shown between the header and the content. */
  tabs?: ReactNode;
  content: ReactNode;
  /**
   * Contextual panes (the selection inspector) take over their dock while
   * present and are never listed as a tab.
   */
  isContextual?: boolean;
  /** Bottom dock sizes to this pane's content instead of a fixed tray height. */
  fitsContent?: boolean;
  role?: "dialog";
};

type EditorDockProps = {
  activePaneId?: DockPaneId | undefined;
  location: DockLocation;
  /** Panes docked here; unavailable panes should be left out. */
  panes: EditorDockPane[];
  onMovePane: (paneId: DockPaneId, location: DockLocation) => void;
  onSelectPane: (location: DockLocation, paneId: DockPaneId) => void;
};

export function EditorDock({
  activePaneId,
  location,
  panes,
  onMovePane,
  onSelectPane,
}: EditorDockProps) {
  const tabPanes = panes.filter((pane) => !pane.isContextual);
  const pane =
    panes.find((candidate) => candidate.isContextual) ??
    tabPanes.find((candidate) => candidate.id === activePaneId) ??
    tabPanes[0];

  if (!pane) {
    return null;
  }

  const title = pane.title ?? pane.label;
  const showTabs = !pane.isContextual && tabPanes.length > 1;
  const targetLocation: DockLocation = location === "side" ? "bottom" : "side";
  const moveLabel = `Move ${pane.label.toLowerCase()} to ${targetLocation === "side" ? "side panel" : "bottom"}`;

  return (
    <section
      aria-label={title}
      className="editor-dock"
      data-fits-content={location === "bottom" && panes.every((candidate) => candidate.fitsContent)}
      data-has-tabs={pane.tabs ? true : undefined}
      data-location={location}
      data-pane={pane.id}
      role={pane.role}
    >
      <header className="editor-edit-pane-header editor-dock-header">
        {showTabs ? (
          <TabList
            aria-label={location === "side" ? "Side panel" : "Bottom panel"}
            className="editor-dock-tabs"
            selectedValue={pane.id}
            size="small"
            onTabSelect={(_, data) => onSelectPane(location, data.value as DockPaneId)}
          >
            {tabPanes.map((tabPane) => (
              <Tab key={tabPane.id} value={tabPane.id}>
                {tabPane.label}
              </Tab>
            ))}
          </TabList>
        ) : (
          <h3>{title}</h3>
        )}
        {pane.badge !== undefined ? <span className="editor-dock-badge">{pane.badge}</span> : null}
        <div className="editor-edit-pane-actions editor-dock-actions">
          {pane.actions ?? null}
          <Button
            appearance="subtle"
            size="small"
            icon={targetLocation === "side" ? <PanelLeftRegular /> : <PanelBottomRegular />}
            aria-label={moveLabel}
            title={moveLabel}
            onClick={() => onMovePane(pane.id, targetLocation)}
          />
        </div>
      </header>
      {pane.tabs ?? null}
      <div className="editor-edit-pane-body editor-dock-body">{pane.content}</div>
    </section>
  );
}
