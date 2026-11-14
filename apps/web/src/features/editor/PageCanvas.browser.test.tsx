import {
  createMapLayer,
  createPhotoLayer,
  createStickerLayer,
  createTextLayer,
  type PageLayer,
  resolveMapLayerView,
} from "@zakka/editor-core";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";

import { renderCanvas } from "../../test/canvasHarness";
import {
  canvasLocator,
  dragOnCanvas,
  layerElement,
  layerHandle,
  layerHitbox,
} from "../../test/gestures";

// The harness canvas is 2000x2000 page units, so a drag of 0.1 canvas widths is 200 units.
const textLayer = (overrides: Partial<Parameters<typeof createTextLayer>[0]> = {}) =>
  createTextLayer({
    id: "text",
    text: "Hello",
    x: 400,
    y: 400,
    width: 600,
    height: 200,
    ...overrides,
  });
const photoLayer = (overrides: Partial<Parameters<typeof createPhotoLayer>[0]> = {}) =>
  createPhotoLayer({
    assetId: "asset_test",
    id: "photo",
    x: 900,
    y: 1000,
    width: 800,
    height: 600,
    ...overrides,
  });
const stickerLayer = () =>
  createStickerLayer({ id: "sticker", x: 1400, y: 300, width: 300, height: 300 });

const renderedPhotoImage = () =>
  document.querySelector<SVGImageElement>(
    ".editor-render-surface image:not([data-photo-pan-preview])",
  );
const toolbar = (kind: string) => page.getByRole("toolbar", { name: `${kind} layer actions` });
const isSelected = (layerId: string) => layerElement(layerId).dataset.selected === "true";
/** A ~2.8 screen-pixel diagonal move, just under the canvas's 4px drag threshold. */
const subThresholdJitter = () => {
  const bounds = canvasLocator().element().getBoundingClientRect();
  return { x: 2 / bounds.width, y: 2 / bounds.height };
};

describe("selecting layers", () => {
  test("clicking a layer selects it and shows its action toolbar", async () => {
    const { probe } = await renderCanvas({ layers: [textLayer(), photoLayer()] });

    await layerHitbox("photo").click();

    expect(probe.selectedLayerIds).toEqual(["photo"]);
    expect(isSelected("photo")).toBe(true);
    await expect.element(toolbar("Photo")).toBeVisible();
  });

  test("shift-click adds and removes layers from a group selection", async () => {
    const { probe } = await renderCanvas({ layers: [textLayer(), photoLayer()] });

    await layerHitbox("text").click();
    await layerHitbox("photo").click({ modifiers: ["Shift"] });

    expect(probe.selectedLayerIds).toEqual(["text", "photo"]);
    await expect.element(page.getByRole("button", { name: "Rotate selection" })).toBeVisible();
    // The single-layer toolbar is only for a single selection.
    await expect.element(toolbar("Photo")).not.toBeInTheDocument();

    await layerHitbox("photo").click({ modifiers: ["Shift"] });

    expect(probe.selectedLayerIds).toEqual(["text"]);
  });

  test("pressing empty canvas clears the selection", async () => {
    const { probe } = await renderCanvas({ layers: [textLayer()], selectedLayerIds: ["text"] });

    await canvasLocator().click({ position: { x: 20, y: 20 } });

    expect(probe.selectedLayerIds).toEqual([]);
  });

  test("a locked layer can be selected but shows no transform handles and does not move", async () => {
    const { layer, probe } = await renderCanvas({ layers: [textLayer({ locked: true })] });

    await dragOnCanvas(layerHitbox("text"), { x: 0.1, y: 0.1 });

    expect(probe.selectedLayerIds).toEqual(["text"]);
    expect(layer("text")).toMatchObject({ x: 400, y: 400 });
    expect(layerElement("text").querySelectorAll(".transform-resize-handle")).toHaveLength(0);
    expect(layerElement("text").querySelector(".transform-rotate-handle")).toBeNull();
  });
});

describe("moving layers", () => {
  test("dragging a layer moves it by the pointer distance without resizing", async () => {
    const { layer } = await renderCanvas({ layers: [photoLayer()] });

    await dragOnCanvas(layerHitbox("photo"), { x: 0.1, y: -0.05 });

    expect(layer("photo").x).toBeCloseTo(1100, -1);
    expect(layer("photo").y).toBeCloseTo(900, -1);
    expect(layer("photo")).toMatchObject({ width: 800, height: 600 });
  });

  test("dragging an unselected layer selects it as part of the same gesture", async () => {
    const { probe } = await renderCanvas({ layers: [textLayer(), photoLayer()] });

    await dragOnCanvas(layerHitbox("text"), { x: 0.05, y: 0 });

    expect(probe.selectedLayerIds).toEqual(["text"]);
  });

  test("dragging one layer of a group moves every selected layer together and keeps the group", async () => {
    const { layer, probe } = await renderCanvas({
      layers: [textLayer(), photoLayer(), stickerLayer()],
      selectedLayerIds: ["text", "photo"],
    });

    await dragOnCanvas(layerHitbox("text"), { x: 0.05, y: 0.05 });

    expect(layer("text").x).toBeCloseTo(500, -1);
    expect(layer("text").y).toBeCloseTo(500, -1);
    expect(layer("photo").x).toBeCloseTo(1000, -1);
    expect(layer("photo").y).toBeCloseTo(1100, -1);
    expect(layer("sticker")).toMatchObject({ x: 1400, y: 300 });
    // The click that ends the drag must not collapse the group back to one layer.
    expect(probe.selectedLayerIds).toEqual(["text", "photo"]);
  });

  test("pointer jitter below the drag threshold selects a layer without moving it", async () => {
    const { layer, probe } = await renderCanvas({ layers: [textLayer(), photoLayer()] });

    await dragOnCanvas(layerHitbox("photo"), subThresholdJitter());

    expect(probe.selectedLayerIds).toEqual(["photo"]);
    expect(layer("photo")).toMatchObject({ x: 900, y: 1000 });
  });

  test("pointer jitter below the drag threshold does not move a group", async () => {
    const { layer, probe } = await renderCanvas({
      layers: [textLayer(), photoLayer()],
      selectedLayerIds: ["text", "photo"],
    });

    await dragOnCanvas(layerHitbox("text"), subThresholdJitter());

    expect(layer("text")).toMatchObject({ x: 400, y: 400 });
    expect(layer("photo")).toMatchObject({ x: 900, y: 1000 });
    expect(probe.selectedLayerIds).toEqual(["text", "photo"]);
  });
});

describe("resizing and rotating", () => {
  test("the right handle widens a text box and keeps its left edge fixed", async () => {
    const { layer } = await renderCanvas({ layers: [textLayer()], selectedLayerIds: ["text"] });

    await dragOnCanvas(layerHandle("text", "Resize from right"), { x: 0.1, y: 0 });

    expect(layer("text").width).toBeCloseTo(800, -1);
    expect(layer("text")).toMatchObject({ x: 400, height: 200 });
  });

  test("the left handle resizes from the left and keeps the right edge fixed", async () => {
    const { layer } = await renderCanvas({ layers: [textLayer()], selectedLayerIds: ["text"] });

    await dragOnCanvas(layerHandle("text", "Resize from left"), { x: 0.1, y: 0 });

    expect(layer("text").x).toBeCloseTo(600, -1);
    expect(layer("text").x + layer("text").width).toBeCloseTo(1000, -1);
  });

  test("a layer can never be resized below the 32-unit minimum", async () => {
    const { layer } = await renderCanvas({ layers: [textLayer()], selectedLayerIds: ["text"] });

    await dragOnCanvas(layerHandle("text", "Resize from right"), { x: -0.5, y: 0 });

    expect(layer("text").width).toBe(32);
    expect(layer("text").x).toBe(400);
  });

  test("dragging the rotate handle upward rotates clockwise around the center", async () => {
    const { layer } = await renderCanvas({ layers: [textLayer()], selectedLayerIds: ["text"] });

    await dragOnCanvas(layerHandle("text", "Rotate layer"), { x: 0, y: -0.1 });

    expect(layer("text").rotation).toBeGreaterThan(10);
    expect(layer("text")).toMatchObject({ x: 400, y: 400, width: 600, height: 200 });
  });
});

describe("photo handles", () => {
  test("edge handles crop and corner handles scale", async () => {
    await renderCanvas({ layers: [photoLayer()], selectedLayerIds: ["photo"] });

    for (const name of ["Crop from top", "Crop from right", "Crop from bottom", "Crop from left"]) {
      await expect.element(layerHandle("photo", name)).toBeInTheDocument();
    }
    for (const name of [
      "Scale from top left",
      "Scale from top right",
      "Scale from bottom right",
      "Scale from bottom left",
    ]) {
      await expect.element(layerHandle("photo", name)).toBeInTheDocument();
    }
  });

  test("cropping from an edge keeps the image anchored on the page (#57)", async () => {
    const { layer } = await renderCanvas({ layers: [photoLayer()], selectedLayerIds: ["photo"] });
    const before = renderedPhotoImage()?.getBoundingClientRect();

    await dragOnCanvas(layerHandle("photo", "Crop from right"), { x: -0.08, y: 0 });

    const after = renderedPhotoImage()?.getBoundingClientRect();
    expect(layer("photo").width).toBeCloseTo(640, -1);
    expect(layer("photo").x).toBe(900);
    expect(after?.left).toBeCloseTo(before?.left ?? Number.NaN, 0);
    expect(after?.top).toBeCloseTo(before?.top ?? Number.NaN, 0);
    expect(after?.width).toBeCloseTo(before?.width ?? Number.NaN, 0);
  });

  test("a corner handle scales the photo uniformly from the opposite corner", async () => {
    const { layer } = await renderCanvas({ layers: [photoLayer()], selectedLayerIds: ["photo"] });

    await dragOnCanvas(layerHandle("photo", "Scale from bottom right"), { x: 0.1, y: 0.1 });

    const scaled = layer("photo");
    expect(scaled.width).toBeGreaterThan(800);
    expect(scaled.width / scaled.height).toBeCloseTo(800 / 600, 2);
    expect(scaled).toMatchObject({ x: 900, y: 1000 });
  });

  test("hovering the pan handle previews the full photo, and dragging it pans a zoomed photo", async () => {
    const { layer } = await renderCanvas({
      layers: [
        photoLayer({
          photoTransform: {
            flipX: false,
            flipY: false,
            offsetX: 0,
            offsetY: 0,
            rotation: 0,
            scale: 2,
          },
        }),
      ],
      selectedLayerIds: ["photo"],
    });
    const panHandle = layerHandle("photo", "Click and drag to adjust photo");

    await userEvent.hover(panHandle);
    expect(document.querySelector("[data-photo-pan-preview]")).not.toBeNull();

    await dragOnCanvas(panHandle, { x: 0.05, y: 0 });

    expect(layer("photo", "photo").photoTransform.offsetX).toBeGreaterThan(0);
    expect(layer("photo")).toMatchObject({ x: 900, y: 1000, width: 800, height: 600 });
  });

  test("zoom buttons step by 10% and zoom out is disabled at 100%", async () => {
    const { layer } = await renderCanvas({ layers: [photoLayer()], selectedLayerIds: ["photo"] });

    await expect.element(page.getByRole("button", { name: "Zoom photo out" })).toBeDisabled();
    await page.getByRole("button", { name: "Zoom photo in" }).click();

    expect(layer("photo", "photo").photoTransform.scale).toBe(1.1);
    await expect.element(page.getByRole("button", { name: "Zoom photo out" })).toBeEnabled();
  });

  test("the zoom slider sits inside large photos and moves outside small ones, away from the toolbar", async () => {
    const { layer, probe } = await renderCanvas({
      layers: [
        photoLayer(),
        photoLayer({ id: "low", x: 200, y: 1500, width: 240, height: 180 }),
        photoLayer({ id: "high", x: 1400, y: 100, width: 240, height: 180 }),
        photoLayer({ id: "flipped", x: 1700, y: 1650, width: 240, height: 180, rotation: 180 }),
        // Stacked above "low" and just under it, so it overlaps the outside slider but not the photo.
        createStickerLayer({ id: "neighbor", x: 0, y: 1700, width: 880, height: 250 }),
      ],
      selectedLayerIds: ["photo"],
    });
    const zoomSlider = () => document.querySelector<HTMLElement>(".transform-scale-slider");
    const rects = (layerId: string) => {
      const slider = zoomSlider();
      const frame = layerElement(layerId).querySelector(".canvas-selection-frame");
      const tools = document.querySelector(".selected-layer-tools");
      if (!slider || !frame || !tools)
        throw new Error(`Expected ${layerId} slider, frame, and tools`);
      return {
        frame: frame.getBoundingClientRect(),
        slider: slider.getBoundingClientRect(),
        tools: tools.getBoundingClientRect(),
      };
    };
    await expect.poll(() => zoomSlider()?.dataset.placement).toBe("inside");

    await layerHitbox("low").click();
    await expect.poll(() => zoomSlider()?.dataset.placement).toBe("below");
    const low = rects("low");
    expect(low.slider.top).toBeGreaterThan(low.frame.bottom);
    expect(low.tools.bottom).toBeLessThan(low.frame.top);
    await page.getByRole("button", { name: "Zoom photo in" }).click();
    expect(probe.selectedLayerIds).toEqual(["low"]);
    expect(layer("low", "photo").photoTransform.scale).toBe(1.1);

    await layerHitbox("high").click();
    await expect.poll(() => zoomSlider()?.dataset.placement).toBe("above");
    const high = rects("high");
    expect(high.slider.bottom).toBeLessThan(high.frame.top);
    expect(high.tools.top).toBeGreaterThan(high.frame.bottom);

    // Upside down, the layer's local "above" is physically below, away from the toolbar.
    await layerHitbox("flipped").click();
    await expect.poll(() => zoomSlider()?.dataset.placement).toBe("above");
    const flipped = rects("flipped");
    expect(flipped.slider.top).toBeGreaterThan(flipped.frame.bottom);
    expect(flipped.tools.bottom).toBeLessThan(flipped.frame.top);
  });

  test("the layer menu stays above a bottom-stacked photo's zoom slider in a many-layer page", async () => {
    const fillers = Array.from({ length: 30 }, (_, index) =>
      createStickerLayer({ id: `filler-${index}`, x: 1700, y: 1700, width: 100, height: 100 }),
    );
    const { probe } = await renderCanvas({
      layers: [photoLayer({ id: "small", x: 200, y: 1500, width: 240, height: 180 }), ...fillers],
      selectedLayerIds: ["small"],
    });
    const slider = document.querySelector<HTMLElement>(".transform-scale-slider");
    await expect.poll(() => slider?.dataset.placement).toBe("below");

    // Open the menu just above the slider so its first item lands over it.
    await layerHitbox("small").click({ button: "right", position: { x: 12, y: 56 } });
    const edit = page
      .getByRole("menu", { name: "Photo layer actions" })
      .getByRole("menuitem", { name: "Edit" });
    const sliderRect = slider?.getBoundingClientRect();
    const itemRect = edit.element().getBoundingClientRect();
    if (!sliderRect) throw new Error("Expected the zoom slider");
    const itemCenterY = (itemRect.top + itemRect.bottom) / 2;
    expect(itemCenterY).toBeGreaterThan(sliderRect.top);
    expect(itemCenterY).toBeLessThan(sliderRect.bottom);
    await edit.click();

    expect(probe.activeSelectionPanel).toBe("edit");
  });

  test("Width fills the page width, centered, preserving the photo aspect ratio", async () => {
    const { layer } = await renderCanvas({ layers: [photoLayer()], selectedLayerIds: ["photo"] });

    await toolbar("Photo").getByRole("button", { name: "Scale photo to full page width" }).click();

    expect(layer("photo")).toMatchObject({ x: 0, width: 2000, height: 1500, y: 250 });
  });

  test("the Frame button toggles the frame popover and presets apply to the photo", async () => {
    const { layer, probe } = await renderCanvas({
      layers: [photoLayer()],
      selectedLayerIds: ["photo"],
    });
    const frameButton = toolbar("Photo").getByRole("button", { name: "Frame photo" });

    await frameButton.click();
    await expect.element(frameButton).toHaveAttribute("aria-pressed", "true");
    const popover = page.getByRole("dialog", { name: "Frame photo" });
    await popover.getByRole("button", { name: "Polaroid" }).click();

    expect(layer("photo", "photo").border.framePreset).toBe("polaroid");
    await expect
      .element(popover.getByRole("button", { name: "Polaroid" }))
      .toHaveAttribute("aria-pressed", "true");

    await frameButton.click();
    expect(probe.activeSelectionPanel).toBeNull();
    await expect.element(popover).not.toBeInTheDocument();
  });

  test("double-clicking a photo opens its edit panel instead of inline editing", async () => {
    const { probe } = await renderCanvas({ layers: [photoLayer()] });

    // Off-center: once selected, the pan handle covers the photo's center.
    await layerHitbox("photo").dblClick({ position: { x: 24, y: 24 } });

    expect(probe.selectedLayerIds).toEqual(["photo"]);
    expect(probe.activeSelectionPanel).toBe("edit");
  });
});

describe("map handles", () => {
  const mapLayer = (overrides: Partial<Parameters<typeof createMapLayer>[0]> = {}) =>
    createMapLayer({
      id: "map",
      markers: [
        { id: "par", label: "Paris", latitude: 48.9, longitude: 2.4 },
        { id: "rom", label: "Rome", latitude: 41.9, longitude: 12.5 },
      ],
      style: "atlas",
      x: 400,
      y: 400,
      width: 1200,
      height: 900,
      ...overrides,
    });

  test("dragging the pan handle moves the map content and keeps the frame in place", async () => {
    const { layer } = await renderCanvas({ layers: [mapLayer()], selectedLayerIds: ["map"] });
    const fitted = resolveMapLayerView(mapLayer());

    await dragOnCanvas(layerHandle("map", "Click and drag to move the map"), { x: 0.05, y: 0.05 });

    const { view } = layer("map", "map");
    expect(view.mode).toBe("custom");
    if (view.mode !== "custom") return;
    // Dragging right and down reveals content to the west and north.
    expect(view.centerLongitude).toBeLessThan(fitted.centerLongitude);
    expect(view.centerLatitude).toBeGreaterThan(fitted.centerLatitude);
    expect(view.zoom).toBe(fitted.zoom);
    expect(layer("map")).toMatchObject({ x: 400, y: 400, width: 1200, height: 900 });
  });

  test("the zoom pill zooms a fitted map around its center and stops at the style limit", async () => {
    const { layer } = await renderCanvas({ layers: [mapLayer()], selectedLayerIds: ["map"] });
    const fitted = resolveMapLayerView(mapLayer());

    await page.getByRole("button", { name: "Zoom map in" }).click();

    expect(layer("map", "map").view).toEqual({
      mode: "custom",
      centerLatitude: expect.closeTo(fitted.centerLatitude, 3),
      centerLongitude: expect.closeTo(fitted.centerLongitude, 3),
      zoom: expect.closeTo(fitted.zoom + 0.25, 1),
    });

    await page.getByRole("slider", { name: "Map zoom" }).fill("12");

    expect(layer("map", "map").view).toMatchObject({ zoom: 12 });
    await expect.element(page.getByRole("button", { name: "Zoom map in" })).toBeDisabled();
  });
});

describe("inline text editing", () => {
  const inlineEditor = () => page.getByRole("textbox", { name: "Edit text" });

  test("double-click starts typing into the text box, focused with the caret at the end", async () => {
    const { layer } = await renderCanvas({ layers: [textLayer()] });

    await layerHitbox("text").dblClick();

    await expect.element(inlineEditor()).toHaveFocus();
    await userEvent.keyboard(" world");
    expect(layer("text", "text").text).toBe("Hello world");
  });

  test("the rotate handle is hidden while typing but resize handles remain", async () => {
    await renderCanvas({ layers: [textLayer()] });

    await layerHitbox("text").dblClick();

    expect(layerElement("text").querySelector(".transform-rotate-handle")).toBeNull();
    await expect.element(layerHandle("text", "Resize from right")).toBeInTheDocument();
  });

  test("Escape stops typing and keeps the text and selection", async () => {
    const { layer, probe } = await renderCanvas({ layers: [textLayer()] });

    await layerHitbox("text").dblClick();
    await userEvent.keyboard("!{Escape}");

    await expect.element(inlineEditor()).not.toBeInTheDocument();
    expect(layer("text", "text").text).toBe("Hello!");
    expect(probe.selectedLayerIds).toEqual(["text"]);
  });

  test("the Type toolbar button toggles inline editing", async () => {
    await renderCanvas({ layers: [textLayer()], selectedLayerIds: ["text"] });
    const typeButton = toolbar("Text").getByRole("button", { name: "Type text" });

    await typeButton.click();
    await expect.element(inlineEditor()).toBeVisible();
    await expect.element(typeButton).toHaveAttribute("aria-pressed", "true");

    await typeButton.click();
    await expect.element(inlineEditor()).not.toBeInTheDocument();
  });

  test("resizing the text box while typing keeps the editor open and focused (#54)", async () => {
    const { layer } = await renderCanvas({ layers: [textLayer()] });

    await layerHitbox("text").dblClick();
    const widthBefore = inlineEditor().element().getBoundingClientRect().width;
    await dragOnCanvas(layerHandle("text", "Resize from right"), { x: 0.1, y: 0 });

    expect(layer("text").width).toBeCloseTo(800, -1);
    await expect.element(inlineEditor()).toHaveFocus();
    expect(inlineEditor().element().getBoundingClientRect().width).toBeGreaterThan(widthBefore);
    await userEvent.keyboard("!");
    expect(layer("text", "text").text).toBe("Hello!");
  });

  test("selecting another layer ends inline editing", async () => {
    await renderCanvas({ layers: [textLayer(), photoLayer()] });

    await layerHitbox("text").dblClick();
    await layerHitbox("photo").click();

    await expect.element(inlineEditor()).not.toBeInTheDocument();
  });
});

describe("layer context menu", () => {
  const menu = (kind: string) => page.getByRole("menu", { name: `${kind} layer actions` });

  test("right-click opens the layer menu with only valid reorder actions enabled", async () => {
    const { probe } = await renderCanvas({ layers: [textLayer(), photoLayer()] });

    await layerHitbox("photo").click({ button: "right" });

    expect(probe.selectedLayerIds).toEqual(["photo"]);
    // The photo is already the top layer.
    await expect
      .element(menu("Photo").getByRole("menuitem", { name: "Move to top" }))
      .toBeDisabled();
    await expect.element(menu("Photo").getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    await expect
      .element(menu("Photo").getByRole("menuitem", { name: "Move to bottom" }))
      .toBeEnabled();
  });

  test("Move to bottom reorders the layer and closes the menu", async () => {
    const { probe } = await renderCanvas({ layers: [textLayer(), photoLayer()] });

    await layerHitbox("photo").click({ button: "right" });
    await menu("Photo").getByRole("menuitem", { name: "Move to bottom" }).click();

    expect(probe.reorders).toEqual([{ command: "bottom", layerId: "photo" }]);
    expect(probe.document.layers.map((layer: PageLayer) => layer.id)).toEqual(["photo", "text"]);
    await expect.element(menu("Photo")).not.toBeInTheDocument();
  });

  test("Escape and clicking elsewhere close the menu", async () => {
    await renderCanvas({ layers: [textLayer(), photoLayer()] });

    await layerHitbox("photo").click({ button: "right" });
    await userEvent.keyboard("{Escape}");
    await expect.element(menu("Photo")).not.toBeInTheDocument();

    // Off-center: the now-selected photo's pan handle covers its center.
    await layerHitbox("photo").click({ button: "right", position: { x: 24, y: 24 } });
    await canvasLocator().click({ position: { x: 20, y: 20 } });
    await expect.element(menu("Photo")).not.toBeInTheDocument();
  });

  test("Edit opens the layer edit panel", async () => {
    const { probe } = await renderCanvas({ layers: [textLayer()] });

    await layerHitbox("text").click({ button: "right" });
    await menu("Text").getByRole("menuitem", { name: "Edit" }).click();

    expect(probe.activeSelectionPanel).toBe("edit");
  });
});

describe("toolbar and drop actions", () => {
  test("Delete removes the selected layer and clears the selection", async () => {
    const { probe } = await renderCanvas({
      layers: [textLayer(), photoLayer()],
      selectedLayerIds: ["text"],
    });

    await toolbar("Text").getByRole("button", { name: "Delete layer" }).click();

    expect(probe.document.layers.map((layer) => layer.id)).toEqual(["photo"]);
    expect(probe.selectedLayerIds).toEqual([]);
  });

  test("dropping a library asset reports the drop point in page coordinates", async () => {
    const { probe } = await renderCanvas({ layers: [] });

    await userEvent.dragAndDrop(
      page.getByRole("img", { name: "Draggable test asset" }),
      canvasLocator(),
    );

    expect(probe.droppedAssets).toHaveLength(1);
    const [drop] = probe.droppedAssets;
    expect(drop?.assetId).toBe("asset_test");
    // Playwright drops on the target's center.
    expect(drop?.point.x).toBeCloseTo(1000, -2);
    expect(drop?.point.y).toBeCloseTo(1000, -2);
    expect(drop?.placeholder).toBeUndefined();
  });

  test("dropping a library asset onto a photo placeholder targets that placeholder", async () => {
    const { probe } = await renderCanvas({
      layers: [photoLayer({ assetId: undefined, x: 600, y: 600, width: 800, height: 800 })],
    });

    await userEvent.dragAndDrop(
      page.getByRole("img", { name: "Draggable test asset" }),
      canvasLocator(),
    );

    expect(probe.droppedAssets).toEqual([
      expect.objectContaining({ assetId: "asset_test", placeholder: { layerId: "photo" } }),
    ]);
  });

  test("dropping onto a facing page's placeholder preview targets the page that owns it", async () => {
    const { probe } = await renderCanvas({
      layers: [],
      previewLayers: [
        {
          layer: photoLayer({ assetId: undefined, x: 600, y: 600, width: 800, height: 800 }),
          sourcePageId: "page_left",
          stackIndex: 0,
        },
      ],
    });

    await userEvent.dragAndDrop(
      page.getByRole("img", { name: "Draggable test asset" }),
      canvasLocator(),
    );

    expect(probe.droppedAssets).toEqual([
      expect.objectContaining({
        assetId: "asset_test",
        placeholder: { layerId: "photo", pageId: "page_left" },
      }),
    ]);
  });
});

describe("photo placeholders", () => {
  test("a selected placeholder offers Add photo instead of pan controls", async () => {
    const { probe } = await renderCanvas({
      layers: [photoLayer({ assetId: undefined })],
      selectedLayerIds: ["photo"],
    });

    expect(document.querySelector('[data-photo-placeholder="true"]')).not.toBeNull();
    await expect
      .element(page.getByRole("button", { name: "Click and drag to adjust photo" }))
      .not.toBeInTheDocument();

    await toolbar("Photo").getByRole("button", { name: "Add photo to placeholder" }).click();

    expect(probe.choosePhotoRequests).toEqual(["photo"]);
  });
});
