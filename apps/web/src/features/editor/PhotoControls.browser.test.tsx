import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createPhotoLayer, type PhotoLayer } from "@zakka/editor-core";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { PhotoControls } from "./PhotoControls";

function PhotoControlsHarness({
  initialLayer,
  onLayerChange,
}: {
  initialLayer: PhotoLayer;
  onLayerChange: (layer: PhotoLayer) => void;
}) {
  const [layer, setLayer] = useState(initialLayer);

  return (
    <PhotoControls
      layer={layer}
      onChange={(update) => {
        const next = { ...layer, ...update };
        setLayer(next);
        onLayerChange(next);
      }}
    />
  );
}

async function renderControls(
  initialLayer = createPhotoLayer({ assetId: "asset_1", id: "photo" }),
) {
  const onLayerChange = vi.fn<(layer: PhotoLayer) => void>();
  await render(
    <FluentProvider theme={webLightTheme}>
      <PhotoControlsHarness initialLayer={initialLayer} onLayerChange={onLayerChange} />
    </FluentProvider>,
  );
  const lastFilter = () => {
    const layer = onLayerChange.mock.lastCall?.[0];
    if (!layer) throw new Error("Photo layer was never updated");
    return layer.filter;
  };
  return { lastFilter };
}

const slider = (name: string) => page.getByRole("slider", { name, exact: true });

async function pressOnSlider(name: string, keys: string) {
  (slider(name).element() as HTMLInputElement).focus();
  await userEvent.keyboard(keys);
}

describe("PhotoControls", () => {
  test("adjusts brightness, contrast, shadows and highlights and resets one at a time", async () => {
    const { lastFilter } = await renderControls();

    await pressOnSlider("Shadows", "{End}");
    await pressOnSlider("Highlights", "{Home}");
    await pressOnSlider("Brightness", "{ArrowRight}{ArrowRight}");
    await pressOnSlider("Contrast", "{ArrowLeft}");

    expect(lastFilter()).toMatchObject({
      preset: "none",
      shadows: 1,
      highlights: -1,
      brightness: expect.closeTo(1.02, 5),
      contrast: expect.closeTo(0.99, 5),
      saturation: 1,
    });
    await expect.element(page.getByText("+100")).toBeVisible();
    await expect.element(page.getByText("-100")).toBeVisible();

    await page.getByRole("button", { name: "Reset shadows" }).click();

    expect(lastFilter()).toMatchObject({ shadows: 0, highlights: -1 });
    await expect.element(page.getByRole("button", { name: "Reset shadows" })).toBeDisabled();
  });

  test("shows saved values at the schema maximum without clamping", async () => {
    const layer = createPhotoLayer({ assetId: "asset_1", id: "photo" });
    const { lastFilter } = await renderControls({
      ...layer,
      filter: { ...layer.filter, brightness: 2, saturation: 3 },
    });

    await expect.element(slider("Brightness")).toHaveValue("2");
    await expect.element(slider("Saturation")).toHaveValue("3");

    await pressOnSlider("Saturation", "{ArrowLeft}");

    expect(lastFilter()).toMatchObject({ brightness: 2, saturation: expect.closeTo(2.99, 5) });
  });
});
