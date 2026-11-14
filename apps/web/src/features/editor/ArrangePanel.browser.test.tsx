import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createPhotoLayer, type PageLayer } from "@zakka/editor-core";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  type ArrangeSettings,
  defaultArrangeSettings,
  getSingleLayerArrangeSettings,
  planArrange,
} from "./arrange";
import { ArrangePanel, InspectorTabs, useInspectorTab } from "./ArrangePanel";

const canvas = { backgroundColor: "#ffffff", height: 1000, width: 1000 } as const;

const box = (id: string, x: number, y: number, width = 100, height = 100) =>
  createPhotoLayer({ assetId: "asset", id, x, y, width, height }) as PageLayer;

/** Mirrors the editor wiring: inspector tabs, plan from the current layers, apply on click. */
function ArrangeHarness({
  initialLayers,
  onLayersChange,
  onPreviewChange = () => {},
}: {
  initialLayers: PageLayer[];
  onLayersChange: (layers: PageLayer[]) => void;
  onPreviewChange?: (enabled: boolean) => void;
}) {
  const [layers, setLayers] = useState(initialLayers);
  const [settings, setSettings] = useState<ArrangeSettings>(defaultArrangeSettings);
  const isSingle = layers.length === 1;
  const { activeTab, selectTab } = useInspectorTab({
    canArrange: true,
    layerCount: layers.length,
    settings,
    onSettingsChange: setSettings,
  });
  const plan = planArrange(
    layers,
    canvas,
    isSingle ? getSingleLayerArrangeSettings(settings) : settings,
  );

  return (
    <>
      <InspectorTabs
        activeTab={activeTab}
        canArrange
        layerCount={layers.length}
        onSelect={selectTab}
      />
      {activeTab === "properties" ? (
        <p>Layer properties</p>
      ) : (
        <ArrangePanel
          canApply={Boolean(plan && plan.updates.length > 0)}
          isPreviewEnabled
          movableLayerCount={layers.length}
          settings={settings}
          singleLayer={isSingle}
          onApply={() => {
            const updates = new Map(plan?.updates.map(({ layerId, update }) => [layerId, update]));
            const next = layers.map(
              (layer) => ({ ...layer, ...updates.get(layer.id) }) as PageLayer,
            );
            setLayers(next);
            onLayersChange(next);
          }}
          onPreviewChange={onPreviewChange}
          onSettingsChange={setSettings}
        />
      )}
    </>
  );
}

async function renderPanel(initialLayers: PageLayer[], onPreviewChange?: (on: boolean) => void) {
  const onLayersChange = vi.fn<(layers: PageLayer[]) => void>();
  await render(
    <FluentProvider theme={webLightTheme}>
      <ArrangeHarness
        initialLayers={initialLayers}
        onLayersChange={onLayersChange}
        {...(onPreviewChange ? { onPreviewChange } : {})}
      />
    </FluentProvider>,
  );
  const lastLayers = () => onLayersChange.mock.lastCall?.[0] ?? [];
  const positionOf = (id: string) => {
    const layer = lastLayers().find((candidate) => candidate.id === id);
    return layer ? { x: layer.x, y: layer.y } : null;
  };
  return { onLayersChange, positionOf };
}

const choice = (group: string, name: string) =>
  page.getByRole("group", { name: group }).getByRole("button", { name, exact: true });
const tab = (name: string) => page.getByRole("tab", { name });

describe("ArrangePanel", () => {
  test("aligns the selection's left edges to the last selected layer", async () => {
    const { onLayersChange, positionOf } = await renderPanel([
      box("a", 100, 100),
      box("b", 300, 250),
      box("c", 600, 400),
    ]);
    const alignButton = page.getByRole("button", { name: "Align", exact: true });

    await expect.element(tab("Properties")).toBeDisabled();
    await expect.element(tab("Align")).toHaveAttribute("aria-selected", "true");
    await expect.element(alignButton).toBeDisabled();
    await choice("Horizontal", "Left").click();
    await expect.element(choice("Horizontal", "Left")).toHaveAttribute("aria-pressed", "true");
    await alignButton.click();

    expect(onLayersChange).toHaveBeenCalledTimes(1);
    expect(positionOf("a")).toEqual({ x: 600, y: 100 });
    expect(positionOf("b")).toEqual({ x: 600, y: 250 });
    expect(positionOf("c")).toEqual({ x: 600, y: 400 });
    await expect.element(alignButton).toBeDisabled();
  });

  test("spreads layers vertically with equal gaps", async () => {
    const { positionOf } = await renderPanel([
      box("a", 100, 100),
      box("b", 100, 250),
      box("c", 100, 700),
    ]);

    await tab("Spread").click();
    await expect.element(page.getByLabelText("Gap size")).toBeDisabled();
    await choice("Equal gaps", "Vertical").click();
    await page.getByRole("button", { name: "Spread", exact: true }).click();

    expect(positionOf("a")).toEqual({ x: 100, y: 100 });
    expect(positionOf("b")).toEqual({ x: 100, y: 400 });
    expect(positionOf("c")).toEqual({ x: 100, y: 700 });
  });

  test("arranges layers into a grid from the selection's top-left corner", async () => {
    const { positionOf } = await renderPanel([
      box("a", 100, 100),
      box("b", 500, 120),
      box("c", 250, 400),
    ]);

    await tab("Grid").click();
    await page.getByRole("button", { name: "Top left" }).click();
    await page.getByRole("button", { name: "Arrange", exact: true }).click();

    expect(positionOf("a")).toEqual({ x: 100, y: 100 });
    expect(positionOf("b")).toEqual({ x: 240, y: 100 });
    expect(positionOf("c")).toEqual({ x: 100, y: 240 });
  });

  test("opens a single layer on Properties and aligns it to the page from the Align tab", async () => {
    const onPreviewChange = vi.fn();
    const { positionOf } = await renderPanel([box("a", 300, 250)], onPreviewChange);

    await expect.element(tab("Properties")).toHaveAttribute("aria-selected", "true");
    await expect.element(page.getByText("Layer properties")).toBeVisible();
    await expect.element(tab("Spread")).toBeDisabled();
    await expect.element(tab("Grid")).toBeDisabled();

    await tab("Align").click();
    await expect.element(page.getByLabelText("Relative to")).toBeDisabled();
    await choice("Horizontal", "Right").click();
    await choice("Vertical", "Bottom").click();
    await page.getByRole("button", { name: "Align", exact: true }).click();

    expect(positionOf("a")).toEqual({ x: 900, y: 900 });

    await page.getByRole("switch", { name: "Preview" }).click();
    expect(onPreviewChange).toHaveBeenCalledWith(false);

    await tab("Properties").click();
    await expect.element(page.getByText("Layer properties")).toBeVisible();
  });
});
