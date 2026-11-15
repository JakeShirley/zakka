import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createPageDocument, createPhotoLayer } from "@zakka/editor-core";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { createTestAsset } from "../../test/canvasHarness";
import type { PageDetail } from "../../types";
import { getBookPrintWarnings } from "../editor/photoResolution";
import { BookPrintWarnings } from "./BookPrintWarnings";

// The 400x300 px test asset prints at 150 DPI in an 800x600 unit frame.
const photoPage = (id: string, frames: { id: string; width: number; height: number }[]) =>
  ({
    createdAt: "2026-05-25T12:00:00.000Z",
    document: createPageDocument({
      layers: frames.map((frame) =>
        createPhotoLayer({ assetId: "asset_test", x: 0, y: 0, ...frame }),
      ),
    }),
    height: 3600,
    id,
    layerCount: frames.length,
    title: id,
    updatedAt: "2026-05-25T12:00:00.000Z",
    width: 3600,
  }) satisfies PageDetail;

async function renderWarnings(pages: PageDetail[], spreads: string[][]) {
  const onEdit = vi.fn();
  const groups = getBookPrintWarnings(
    spreads.map((pageIds) => ({ pageIds })),
    pages.map((detail) => detail.id),
    new Map(pages.map((detail) => [detail.id, detail])),
    new Map([["asset_test", createTestAsset()]]),
  );

  await render(
    <FluentProvider className="fluent-root" theme={webLightTheme}>
      <BookPrintWarnings groups={groups} onEdit={onEdit} />
    </FluentProvider>,
  );

  return { onEdit };
}

describe("book print warnings", () => {
  test("lists low-resolution photos by spread and jumps to the first one", async () => {
    const { onEdit } = await renderWarnings(
      [
        photoPage("page_1", [{ id: "sharp", width: 800, height: 600 }]),
        photoPage("page_2", [{ id: "soft", width: 1000, height: 750 }]),
        photoPage("page_3", [
          { id: "fine", width: 400, height: 300 },
          { id: "blurry", width: 2000, height: 1500 },
        ]),
      ],
      [["page_1"], ["page_2", "page_3"]],
    );

    await page.getByRole("button", { name: "2 warnings" }).click();

    const surface = page.getByRole("group", { name: "Print warnings" });
    await expect.element(surface.getByRole("heading", { name: "Pages 2–3" })).toBeVisible();
    // The portal inherits the app's provider class; it must not stretch over the editor.
    const portalNode = surface.element().closest<HTMLElement>("[data-portal-node]");
    expect(portalNode?.getBoundingClientRect().height).toBe(0);
    expect(surface.getByRole("heading", { name: "Page 1" }).query()).toBeNull();
    await expect.element(surface.getByText("1 very low resolution photo")).toBeVisible();
    await expect.element(surface.getByText("1 low resolution photo")).toBeVisible();

    await surface.getByRole("button", { name: "Go to Pages 2–3" }).click();

    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ layerId: "soft", pageId: "page_2", quality: "low", dpi: 120 }),
    );
    await expect.element(surface).not.toBeInTheDocument();
  });

  test("counts a photo spanning both facing pages once", async () => {
    await renderWarnings(
      [
        photoPage("page_1", [{ id: "spanning", width: 2000, height: 1500 }]),
        photoPage("page_2", [
          { id: "spanning", width: 2000, height: 1500 },
          { id: "other_copy", width: 2000, height: 1500 },
        ]),
      ],
      [["page_1", "page_2"]],
    );

    await page.getByRole("button", { name: "2 warnings" }).click();

    await expect
      .element(
        page
          .getByRole("group", { name: "Print warnings" })
          .getByText("2 very low resolution photos"),
      )
      .toBeVisible();
  });

  test("stays hidden when every photo prints sharply", async () => {
    await renderWarnings(
      [photoPage("page_1", [{ id: "sharp", width: 800, height: 600 }])],
      [["page_1"]],
    );

    expect(page.getByRole("button", { name: /warning/ }).query()).toBeNull();
  });
});
