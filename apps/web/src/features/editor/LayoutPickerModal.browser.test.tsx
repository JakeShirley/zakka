import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import {
  createPageDocument,
  createPhotoLayer,
  createStickerLayer,
  createTextLayer,
  maxPageLayerCount,
  type PageDocument,
} from "@zakka/editor-core";
import type { PageLayout } from "@zakka/editor-core/page-layouts";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { createTestAsset } from "../../test/canvasHarness";
import { applyPageLayoutWithAssets, LayoutPickerModal } from "./LayoutPickerModal";

const canvas = { width: 1000, height: 1000 };

const pageWithPhotos = (count: number) =>
  createPageDocument({
    canvas,
    layers: [
      ...Array.from({ length: count }, (_, index) =>
        createPhotoLayer({
          id: `photo-${index}`,
          assetId: `asset-${index}`,
          x: 40 + index * 300,
          y: 40,
          width: 260,
          height: 200,
        }),
      ),
      createTextLayer({ id: "caption", text: "Beach day", x: 100, y: 800, width: 600 }),
    ],
  });

const renderModal = async (document: PageDocument, confirmPhotoRemoval = false) => {
  const applied: PageDocument[] = [];
  const onApply = vi.fn((layout: PageLayout) => {
    applied.push(applyPageLayoutWithAssets(document, layout, []).document);
  });
  await render(
    <FluentProvider theme={webLightTheme}>
      <LayoutPickerModal
        confirmPhotoRemoval={confirmPhotoRemoval}
        document={document}
        onApply={onApply}
        onClose={vi.fn()}
      />
    </FluentProvider>,
  );
  return { applied, onApply };
};

describe("LayoutPickerModal", () => {
  test("applies a fitting layout, moving photos and adding placeholders for empty slots", async () => {
    const { applied } = await renderModal(pageWithPhotos(3));
    await page.getByRole("tab", { name: "Collage" }).click();

    const fitting = page.getByRole("region", { name: "Layouts that fit this page" });
    await fitting.getByRole("button", { name: /^Apply Scattered snapshots layout/ }).click();

    const [result] = applied;
    expect(result).toBeDefined();
    const photos = result?.layers.filter((layer) => layer.kind === "photo") ?? [];
    expect(photos).toHaveLength(5);
    expect(
      photos
        .filter((layer) => layer.assetId)
        .map((layer) => layer.id)
        .sort(),
    ).toEqual(["photo-0", "photo-1", "photo-2"]);
    expect(photos.filter((layer) => !layer.assetId)).toHaveLength(2);
    expect(photos.every((layer) => layer.border.framePreset === "polaroid")).toBe(true);
    expect(result?.layers.find((layer) => layer.id === "caption")).toMatchObject({
      kind: "text",
      text: "Beach day",
    });
  });

  test("ranks Zakka layouts first and text-only layouts last on an empty page", async () => {
    await renderModal(createPageDocument({ canvas }));
    const fitting = page.getByRole("region", { name: "Layouts that fit this page" });
    await expect
      .element(fitting.getByRole("button", { name: /\(Shutterfly\)/ }).first())
      .toBeVisible();

    const labels = fitting
      .getByRole("button", { name: /^Apply / })
      .elements()
      .map((button) => button.getAttribute("aria-label") ?? "");
    expect(labels[0]).toMatch(/\(Zakka original\)$/);
    const firstShutterfly = labels.findIndex((label) => label.endsWith("(Shutterfly)"));
    expect(labels.slice(firstShutterfly).every((label) => !label.includes("(Zakka"))).toBe(true);
    expect(labels[firstShutterfly]).toMatch(/^Apply 1 photo/);
  });

  test("fills an empty page with photo and text placeholders", async () => {
    const { applied } = await renderModal(createPageDocument({ canvas }));

    await expect.element(page.getByText(/This page is empty/)).toBeInTheDocument();
    await page.getByRole("tab", { name: "Titled" }).click();
    await page.getByRole("button", { name: /^Apply Hero with title layout/ }).click();

    const kinds = applied[0]?.layers.map((layer) =>
      layer.kind === "text"
        ? `text:${layer.text}`
        : layer.kind === "photo"
          ? `photo:${layer.assetId ?? ""}`
          : layer.kind,
    );
    expect(kinds).toEqual(["photo:", "text:", "text:"]);
  });

  test("asks before applying a layout that removes photos when confirmation is on", async () => {
    const { applied, onApply } = await renderModal(pageWithPhotos(3), true);
    await page.getByRole("tab", { name: "Titled" }).click();

    const other = page.getByRole("region", { name: "Other layouts" });
    await other
      .getByRole("button", { name: /^Apply Hero with title layout.*removes 2 photos$/ })
      .click();
    expect(onApply).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Apply and remove photos" }).click();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(applied[0]?.layers.filter((layer) => layer.kind === "photo")).toHaveLength(1);
  });

  test("keeps the picker open when a layout would exceed the page layer limit", async () => {
    const stickers = Array.from({ length: maxPageLayerCount - 2 }, (_, index) =>
      createStickerLayer({ id: `sticker-${index}` }),
    );
    const { onApply } = await renderModal(createPageDocument({ canvas, layers: stickers }));
    await page.getByRole("tab", { name: "Titled" }).click();

    await page.getByRole("button", { name: /^Apply Hero with title layout/ }).click();

    expect(onApply).not.toHaveBeenCalled();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent(/Hero with title needs 1 more layer than a page can hold/);
    await expect
      .element(page.getByRole("button", { name: /^Apply Hero with title layout/ }))
      .toBeVisible();
  });

  test("filters imported and Zakka layouts by category", async () => {
    await renderModal(pageWithPhotos(1));
    const fitting = page.getByRole("region", { name: "Layouts that fit this page" });
    await expect
      .element(fitting.getByRole("button", { name: /^Apply Hero with title layout/ }))
      .toBeVisible();

    const photosOnly = page.getByRole("tab", { name: "Photos only" });
    await photosOnly.click();
    await expect.element(photosOnly).toHaveAttribute("aria-selected", "true");
    await expect
      .element(fitting.getByRole("button", { name: /\(Shutterfly\)$/ }).first())
      .toBeVisible();
    await expect
      .element(fitting.getByRole("button", { name: /^Apply Hero with title layout/ }))
      .not.toBeInTheDocument();
  });

  test("treats EXIF-rotated photos by their displayed shape when picking slots", () => {
    // Both photos are stored 400x300; the EXIF quarter turn makes "rotated" display as portrait.
    const rotated = { ...createTestAsset("rotated"), orientation: 6 };
    const upright = { ...createTestAsset("upright"), orientation: 1 };
    const wideAndTall: PageLayout = {
      id: "wide-and-tall",
      name: "Wide and tall",
      source: "zakka",
      orientation: "any",
      slots: [
        { kind: "photo", x: 0.1, y: 0.1, width: 0.8, height: 0.3, rotation: 0 },
        { kind: "photo", x: 0.35, y: 0.45, width: 0.3, height: 0.5, rotation: 0 },
      ],
      photoSlotCount: 2,
      textSlotCount: 0,
    };
    const document = createPageDocument({
      canvas,
      layers: [
        createPhotoLayer({ id: "rotated", assetId: "rotated", width: 300, height: 300 }),
        createPhotoLayer({ id: "upright", assetId: "upright", width: 300, height: 300 }),
      ],
    });

    const { document: result } = applyPageLayoutWithAssets(document, wideAndTall, [
      rotated,
      upright,
    ]);

    const byId = new Map(result.layers.map((layer) => [layer.id, layer]));
    expect(byId.get("upright")).toMatchObject({ width: 800, height: 300 });
    expect(byId.get("rotated")).toMatchObject({ width: 300, height: 500 });
  });
});
