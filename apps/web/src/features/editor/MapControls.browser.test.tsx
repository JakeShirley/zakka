import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createMapLayer, type MapLayer, maxMapMarkers, maxMapRoutes } from "@zakka/editor-core";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { MapControls } from "./MapControls";

function MapControlsHarness({
  initialLayer,
  onLayerChange,
}: {
  initialLayer: MapLayer;
  onLayerChange: (layer: MapLayer) => void;
}) {
  const [layer, setLayer] = useState(initialLayer);

  return (
    <MapControls
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
  initialLayer = createMapLayer({ id: "map", width: 1200, height: 800 }),
) {
  const onLayerChange = vi.fn<(layer: MapLayer) => void>();
  await render(
    <FluentProvider theme={webLightTheme}>
      <MapControlsHarness initialLayer={initialLayer} onLayerChange={onLayerChange} />
    </FluentProvider>,
  );
  const lastLayer = () => {
    const layer = onLayerChange.mock.lastCall?.[0];
    if (!layer) throw new Error("Map layer was never updated");
    return layer;
  };
  return { lastLayer };
}

const searchBox = () => page.getByRole("searchbox", { name: "Add a place" });

describe("MapControls", () => {
  test("adds searched places, connects them with routes and drops routes with removed places", async () => {
    const { lastLayer } = await renderControls();

    await searchBox().fill("Kyoto");
    await expect
      .element(page.getByRole("list", { name: "Place results" }).getByRole("button").first())
      .toHaveTextContent(/Kyoto/);
    await userEvent.keyboard("{Enter}");
    await searchBox().fill("Tokyo");
    await page.getByRole("list", { name: "Place results" }).getByRole("button").first().click();
    await searchBox().fill("Seoul");
    await userEvent.keyboard("{Enter}");

    expect(lastLayer().markers.map((marker) => marker.label)).toEqual(["Kyoto", "Tokyo", "Seoul"]);
    expect(lastLayer().markers[0]).toMatchObject({ latitude: expect.closeTo(35.01, 1) });

    await page.getByRole("button", { name: "Connect places in order" }).click();

    const [kyoto, tokyo, seoul] = lastLayer().markers.map((marker) => marker.id);
    expect(lastLayer().routes).toEqual([
      expect.objectContaining({ fromMarkerId: kyoto, toMarkerId: tokyo }),
      expect.objectContaining({ fromMarkerId: tokyo, toMarkerId: seoul }),
    ]);

    await page.getByRole("button", { name: "Remove Kyoto" }).click();

    expect(lastLayer().markers.map((marker) => marker.label)).toEqual(["Tokyo", "Seoul"]);
    expect(lastLayer().routes).toEqual([
      expect.objectContaining({ fromMarkerId: tokyo, toMarkerId: seoul }),
    ]);
  });

  test("switches styles and highlights the countries that contain places", async () => {
    const { lastLayer } = await renderControls(
      createMapLayer({
        id: "map",
        width: 1200,
        height: 800,
        markers: [
          { id: "par", label: "Paris", latitude: 48.86, longitude: 2.35 },
          { id: "rom", label: "Rome", latitude: 41.9, longitude: 12.5 },
        ],
      }),
    );

    await page.getByText("Vintage", { exact: true }).click();
    expect(lastLayer().style).toBe("vintage");
    await expect.element(page.getByRole("radio", { name: "Vintage" })).toBeChecked();

    await page.getByRole("button", { name: "Highlight countries with places" }).click();
    expect(lastLayer().highlightedCountries).toEqual(["FRA", "ITA"]);
    await expect
      .element(page.getByRole("list", { name: "Highlighted countries" }))
      .toHaveTextContent(/France.*Italy/);

    await page.getByText("Street map", { exact: true }).click();
    expect(lastLayer().style).toBe("osm");
    await expect.element(page.getByRole("combobox", { name: "Tile detail" })).toBeVisible();
    await expect
      .element(page.getByRole("list", { name: "Highlighted countries" }))
      .not.toBeInTheDocument();
  });

  test("stops adding places and routes at the map limits", async () => {
    const markers = Array.from({ length: maxMapMarkers }, (_, index) => ({
      id: `m${index}`,
      label: `Place ${index}`,
      latitude: (index % 80) - 40,
      longitude: index * 3 - 150,
    }));
    await renderControls(
      createMapLayer({
        id: "map",
        width: 1200,
        height: 800,
        markers,
        routes: Array.from({ length: maxMapRoutes }, (_, index) => ({
          id: `r${index}`,
          fromMarkerId: "m0",
          toMarkerId: "m1",
        })),
      }),
    );

    await expect.element(searchBox()).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Add route" })).toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Connect places in order" }))
      .toBeEnabled();
  });
});
