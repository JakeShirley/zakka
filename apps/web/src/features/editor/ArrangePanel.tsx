import { Button, Switch, Tab, TabList } from "@fluentui/react-components";
import { type ReactNode, useCallback, useState } from "react";

import { NumericInput } from "../../components/NumericInput";
import {
  type AlignReference,
  type ArrangeSettings,
  type ArrangeTab,
  alignReferenceLabels,
  type CellAlign,
  canAlignAsGroup,
  getGridColumns,
  type HorizontalAlign,
  type SpreadMode,
  spreadUsesGapSetting,
  type VerticalAlign,
} from "./arrange";
import {
  AlignTabIcon,
  GridTabIcon,
  horizontalAlignIcons,
  SpreadTabIcon,
  spreadModeIcons,
  verticalAlignIcons,
} from "./ArrangeIcons";

type ChoiceOption<T extends string> = { icon?: ReactNode; label: string; value: T };

const previewStorageKey = "scrapbook:arrange-preview";

/** Whether arrange previews are drawn on the canvas; remembered across sessions. */
export function useArrangePreviewPreference(): [boolean, (enabled: boolean) => void] {
  const [isEnabled, setIsEnabled] = useState(() => {
    try {
      return globalThis.localStorage?.getItem(previewStorageKey) !== "false";
    } catch {
      return true;
    }
  });
  const setPreference = useCallback((enabled: boolean) => {
    setIsEnabled(enabled);
    try {
      globalThis.localStorage?.setItem(previewStorageKey, String(enabled));
    } catch {
      // Keep the in-memory toggle usable if localStorage is unavailable.
    }
  }, []);
  return [isEnabled, setPreference];
}

export type InspectorTab = "properties" | ArrangeTab;

/**
 * Tracks which sidebar inspector tab is open. Several selected layers have no
 * shared properties, so they always show an arrange tab; one layer can only be
 * aligned, and a locked layer can't be arranged at all.
 */
export function useInspectorTab({
  canArrange,
  layerCount,
  selectionKey,
  settings,
  onSettingsChange,
}: {
  canArrange: boolean;
  layerCount: number;
  /** Identifies the current selection; a new selection reopens on its default tab. */
  selectionKey: string;
  settings: ArrangeSettings;
  onSettingsChange: (settings: ArrangeSettings) => void;
}) {
  const [viewState, setViewState] = useState<{ key: string; view: "properties" | "arrange" }>({
    key: selectionKey,
    view: "properties",
  });
  const view = viewState.key === selectionKey ? viewState.view : "properties";
  const isMultiple = layerCount > 1;
  const activeTab: InspectorTab =
    !canArrange || (!isMultiple && view === "properties")
      ? "properties"
      : isMultiple
        ? settings.tab
        : "align";
  const selectTab = (tab: InspectorTab) => {
    if (tab === "properties") {
      setViewState({ key: selectionKey, view: "properties" });
      return;
    }
    setViewState({ key: selectionKey, view: "arrange" });
    onSettingsChange({ ...settings, tab });
  };
  return { activeTab, selectTab };
}

export function InspectorTabs({
  activeTab,
  canArrange,
  layerCount,
  onSelect,
}: {
  activeTab: InspectorTab;
  canArrange: boolean;
  layerCount: number;
  onSelect: (tab: InspectorTab) => void;
}) {
  const isMultiple = layerCount > 1;
  return (
    <TabList
      aria-label="Inspector"
      className="inspector-tabs"
      selectedValue={activeTab}
      size="small"
      onTabSelect={(_, data) => onSelect(data.value as InspectorTab)}
    >
      <Tab disabled={isMultiple} value="properties">
        Properties
      </Tab>
      <Tab disabled={!canArrange} value="align">
        Align
      </Tab>
      <Tab disabled={!canArrange || !isMultiple} value="spread">
        Spread
      </Tab>
      <Tab disabled={!canArrange || !isMultiple} value="grid">
        Grid
      </Tab>
    </TabList>
  );
}

function ChoiceTiles<T extends string>({
  columns,
  label,
  options,
  value,
  onChange,
}: {
  columns: number;
  label: string;
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="arrange-choice-group">
      <legend className="arrange-label">{label}</legend>
      <div
        className="arrange-choices"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            className="arrange-choice"
            data-none={option.value === "none" || undefined}
            onClick={() => onChange(option.value)}
          >
            {option.icon ?? <span className="arrange-choice-none">—</span>}
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const horizontalOptions: ChoiceOption<HorizontalAlign>[] = [
  { label: "None", value: "none" },
  { icon: horizontalAlignIcons.left, label: "Left", value: "left" },
  { icon: horizontalAlignIcons.center, label: "Center", value: "center" },
  { icon: horizontalAlignIcons.right, label: "Right", value: "right" },
];

const verticalOptions: ChoiceOption<VerticalAlign>[] = [
  { label: "None", value: "none" },
  { icon: verticalAlignIcons.top, label: "Top", value: "top" },
  { icon: verticalAlignIcons.middle, label: "Middle", value: "middle" },
  { icon: verticalAlignIcons.bottom, label: "Bottom", value: "bottom" },
];

const spreadGapOptions: ChoiceOption<SpreadMode>[] = [
  { icon: spreadModeIcons.gapsHorizontal, label: "Horizontal", value: "gapsHorizontal" },
  { icon: spreadModeIcons.gapsVertical, label: "Vertical", value: "gapsVertical" },
];

const spreadEdgeOptions: ChoiceOption<SpreadMode>[] = [
  { icon: spreadModeIcons.left, label: "Left edges", value: "left" },
  { icon: spreadModeIcons.centerX, label: "Centers", value: "centerX" },
  { icon: spreadModeIcons.right, label: "Right edges", value: "right" },
  { icon: spreadModeIcons.top, label: "Top edges", value: "top" },
  { icon: spreadModeIcons.centerY, label: "Middles", value: "centerY" },
  { icon: spreadModeIcons.bottom, label: "Bottoms", value: "bottom" },
];

const cellAlignValues: CellAlign[] = ["start", "center", "end"];
const cellAlignRowLabels: Record<CellAlign, string> = {
  start: "Top",
  center: "Middle",
  end: "Bottom",
};
const cellAlignColumnLabels: Record<CellAlign, string> = {
  start: "left",
  center: "center",
  end: "right",
};

const alignReferences: AlignReference[] = [
  "lastSelected",
  "firstSelected",
  "largest",
  "smallest",
  "page",
  "selection",
];

export function ArrangePanel({
  canApply,
  isPreviewEnabled,
  movableLayerCount,
  settings,
  singleLayer = false,
  onApply,
  onPreviewChange,
  onSettingsChange,
}: {
  /** Whether the current tab's settings can change the selection. */
  canApply: boolean;
  isPreviewEnabled: boolean;
  /** Selected layers that aren't locked; only these are moved. */
  movableLayerCount: number;
  settings: ArrangeSettings;
  /** A single selected layer can only be aligned to the page. */
  singleLayer?: boolean;
  onApply: () => void;
  onPreviewChange: (enabled: boolean) => void;
  onSettingsChange: (settings: ArrangeSettings) => void;
}) {
  const tab: ArrangeTab = singleLayer ? "align" : settings.tab;
  const updateAlign = (update: Partial<ArrangeSettings["align"]>) =>
    onSettingsChange({ ...settings, align: { ...settings.align, ...update } });
  const updateSpread = (update: Partial<ArrangeSettings["spread"]>) =>
    onSettingsChange({ ...settings, spread: { ...settings.spread, ...update } });
  const updateGrid = (update: Partial<ArrangeSettings["grid"]>) =>
    onSettingsChange({ ...settings, grid: { ...settings.grid, ...update } });
  const relativeTo = singleLayer ? "page" : settings.align.relativeTo;
  const gridColumns = getGridColumns(settings.grid, movableLayerCount);
  const gridRows = Math.max(1, Math.ceil(movableLayerCount / gridColumns));
  const usesGap = spreadUsesGapSetting(settings.spread.mode);

  return (
    <div className="inspector-form arrange-panel">
      <div className="arrange-panel-header">
        <Switch
          checked={isPreviewEnabled}
          className="arrange-preview-switch"
          label="Preview"
          labelPosition="before"
          title="Show a dashed preview of the result on the canvas"
          onChange={(_, data) => onPreviewChange(data.checked)}
        />
      </div>

      {tab === "align" ? (
        <>
          <div className="arrange-settings">
            <label>
              <span>Relative to</span>
              <select
                disabled={singleLayer}
                value={relativeTo}
                onChange={(event) =>
                  updateAlign({ relativeTo: event.currentTarget.value as AlignReference })
                }
              >
                {alignReferences.map((reference) => (
                  <option key={reference} value={reference}>
                    {alignReferenceLabels[reference]}
                  </option>
                ))}
              </select>
            </label>
            {singleLayer ? null : (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={canAlignAsGroup(relativeTo) && settings.align.asGroup}
                  disabled={!canAlignAsGroup(relativeTo)}
                  onChange={(event) => updateAlign({ asGroup: event.currentTarget.checked })}
                />
                <span>Move selection as a group</span>
              </label>
            )}
          </div>
          <div className="arrange-actions">
            <ChoiceTiles
              columns={4}
              label="Horizontal"
              options={horizontalOptions}
              value={settings.align.horizontal}
              onChange={(horizontal) => updateAlign({ horizontal })}
            />
            <ChoiceTiles
              columns={4}
              label="Vertical"
              options={verticalOptions}
              value={settings.align.vertical}
              onChange={(vertical) => updateAlign({ vertical })}
            />
            <Button
              appearance="primary"
              className="arrange-apply"
              disabled={!canApply}
              icon={<AlignTabIcon />}
              onClick={onApply}
            >
              Align
            </Button>
          </div>
        </>
      ) : null}

      {tab === "spread" ? (
        <>
          <div className="arrange-settings">
            <label>
              <span>Spread within</span>
              <select
                value={settings.spread.within}
                onChange={(event) =>
                  updateSpread({
                    within: event.currentTarget.value as ArrangeSettings["spread"]["within"],
                  })
                }
              >
                <option value="selection">Selection (outer layers stay put)</option>
                <option value="page">Page</option>
              </select>
            </label>
            <div className="arrange-inline-fields">
              <label>
                <span>Gap</span>
                <select
                  disabled={!usesGap}
                  value={settings.spread.gapMode}
                  onChange={(event) =>
                    updateSpread({
                      gapMode: event.currentTarget.value as ArrangeSettings["spread"]["gapMode"],
                    })
                  }
                >
                  <option value="even">Even (auto)</option>
                  <option value="fixed">Fixed</option>
                </select>
              </label>
              <label>
                <span>Gap size</span>
                <NumericInput
                  disabled={!usesGap || settings.spread.gapMode !== "fixed"}
                  min={0}
                  value={settings.spread.gap}
                  onChange={(gap) => updateSpread({ gap })}
                />
              </label>
            </div>
          </div>
          <div className="arrange-actions">
            <ChoiceTiles
              columns={2}
              label="Equal gaps"
              options={spreadGapOptions}
              value={settings.spread.mode}
              onChange={(mode) => updateSpread({ mode })}
            />
            <ChoiceTiles
              columns={3}
              label="Even spacing by"
              options={spreadEdgeOptions}
              value={settings.spread.mode}
              onChange={(mode) => updateSpread({ mode })}
            />
            <Button
              appearance="primary"
              className="arrange-apply"
              disabled={!canApply}
              icon={<SpreadTabIcon />}
              onClick={onApply}
            >
              Spread
            </Button>
          </div>
        </>
      ) : null}

      {tab === "grid" ? (
        <>
          <div className="arrange-settings">
            <div className="arrange-inline-fields">
              <label>
                <span>Columns</span>
                <NumericInput
                  max={Math.max(movableLayerCount, 1)}
                  min={1}
                  step={1}
                  value={gridColumns}
                  onChange={(columns) => updateGrid({ columns: Math.round(columns) })}
                />
              </label>
              <span className="arrange-rows">
                × {gridRows} {gridRows === 1 ? "row" : "rows"}
              </span>
            </div>
            <div className="arrange-inline-fields">
              <label>
                <span>Gap H</span>
                <NumericInput
                  min={0}
                  value={settings.grid.gapX}
                  onChange={(gapX) => updateGrid({ gapX })}
                />
              </label>
              <label>
                <span>Gap V</span>
                <NumericInput
                  min={0}
                  value={settings.grid.gapY}
                  onChange={(gapY) => updateGrid({ gapY })}
                />
              </label>
            </div>
            <label>
              <span>Area</span>
              <select
                value={settings.grid.area}
                onChange={(event) =>
                  updateGrid({ area: event.currentTarget.value as ArrangeSettings["grid"]["area"] })
                }
              >
                <option value="selection">Selection bounds</option>
                <option value="page">Whole page</option>
              </select>
            </label>
            <label>
              <span>Cell size</span>
              <select
                value={settings.grid.cellSize}
                onChange={(event) =>
                  updateGrid({
                    cellSize: event.currentTarget.value as ArrangeSettings["grid"]["cellSize"],
                  })
                }
              >
                <option value="largest">Largest layer</option>
                <option value="fit">Fit area (resizes layers)</option>
              </select>
            </label>
            <label>
              <span>Order</span>
              <select
                value={settings.grid.order}
                onChange={(event) =>
                  updateGrid({
                    order: event.currentTarget.value as ArrangeSettings["grid"]["order"],
                  })
                }
              >
                <option value="reading">Reading order (L→R, T→B)</option>
                <option value="selection">Selection order</option>
              </select>
            </label>
          </div>
          <div className="arrange-actions">
            <fieldset className="arrange-choice-group">
              <legend className="arrange-label">Align in cell</legend>
              <div className="arrange-cell-picker">
                {cellAlignValues.map((alignY) =>
                  cellAlignValues.map((alignX) => {
                    const label =
                      alignX === "center" && alignY === "center"
                        ? "Center"
                        : `${cellAlignRowLabels[alignY]} ${cellAlignColumnLabels[alignX]}`;
                    return (
                      <button
                        key={`${alignY}-${alignX}`}
                        type="button"
                        aria-label={label}
                        aria-pressed={
                          settings.grid.cellAlignX === alignX && settings.grid.cellAlignY === alignY
                        }
                        className="arrange-cell"
                        title={label}
                        onClick={() => updateGrid({ cellAlignX: alignX, cellAlignY: alignY })}
                      />
                    );
                  }),
                )}
              </div>
            </fieldset>
            <Button
              appearance="primary"
              className="arrange-apply"
              disabled={!canApply}
              icon={<GridTabIcon />}
              onClick={onApply}
            >
              Arrange
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
