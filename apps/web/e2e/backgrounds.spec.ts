import type { Page } from "@playwright/test";
import { PNG } from "pngjs";

import {
  addBookPage,
  createBook,
  expect,
  filmstripPage,
  getSavedPage,
  openBook,
  test,
} from "./fixtures";

type SavedBackground = {
  backgroundId: string;
  height: number;
  scale: number;
  width: number;
  x: number;
  y: number;
};

type SavedCustomBackground = { backgroundId: string; id: string; name: string; source: string };

const savedBackground = async (
  request: Parameters<typeof getSavedPage>[0],
  pageId: string,
): Promise<SavedBackground | null> => {
  const saved = await getSavedPage(request, pageId);
  const canvas = saved.document.canvas as { background?: SavedBackground };
  return canvas.background ?? null;
};

const canvasBackgrounds = (page: Page, backgroundId: string) =>
  page
    .getByRole("region", { name: "Book editor" })
    .locator(`[data-page-background="${backgroundId}"]`);

function createPng(): Buffer {
  const png = new PNG({ width: 32, height: 16 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 120;
    png.data[index + 1] = 180;
    png.data[index + 2] = 220;
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
}

test.describe("page backgrounds", () => {
  test("a background spans the spread, resizes together, and can be removed from one page", async ({
    account: _,
    page,
  }) => {
    const book = await createBook(page.request);
    const leftId = await addBookPage(page.request, book.id, "Left page");
    const rightId = await addBookPage(page.request, book.id, "Right page");
    await openBook(page, book.id);

    await filmstripPage(page, /Right page/).click();
    await page.getByRole("button", { name: "Backgrounds" }).click();

    await expect(page.getByRole("button", { name: "Whole spread" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Use Gold stars background" }).click();

    await expect(canvasBackgrounds(page, "zakka:stars")).toHaveCount(2);
    await expect
      .poll(async () => [
        await savedBackground(page.request, leftId),
        await savedBackground(page.request, rightId),
      ])
      .toEqual([
        { backgroundId: "zakka:stars", x: 0, y: 0, width: 4800, height: 3000, scale: 1 },
        { backgroundId: "zakka:stars", x: -2400, y: 0, width: 4800, height: 3000, scale: 1 },
      ]);

    await page.getByRole("slider", { name: "Tile size" }).fill("2");
    await expect
      .poll(async () => [
        (await savedBackground(page.request, leftId))?.scale,
        (await savedBackground(page.request, rightId))?.scale,
      ])
      .toEqual([2, 2]);

    await page.getByRole("button", { name: "This page" }).click();
    await page.getByRole("button", { name: "Remove" }).click();

    await expect(canvasBackgrounds(page, "zakka:stars")).toHaveCount(1);
    await expect.poll(() => savedBackground(page.request, rightId)).toBeNull();
    expect(await savedBackground(page.request, leftId)).toMatchObject({ scale: 2 });

    await page.keyboard.press("Control+z");
    await expect(canvasBackgrounds(page, "zakka:stars")).toHaveCount(2);
  });

  test("the Backgrounds page uploads, renames, and deletes custom backgrounds", async ({
    account: _,
    page,
  }) => {
    await page.goto("/backgrounds");
    const myBackgrounds = page.getByRole("region", { name: "My backgrounds" });
    await expect(
      page.getByRole("region", { name: "Paper" }).getByRole("listitem").first(),
    ).toBeVisible();

    await page.getByLabel("Background image files").setInputFiles({
      name: "lake.png",
      mimeType: "image/png",
      buffer: createPng(),
    });

    await expect(myBackgrounds.getByText("lake", { exact: true })).toBeVisible();
    await expect(myBackgrounds.getByText("Uploaded")).toBeVisible();
    await expect
      .poll(() =>
        myBackgrounds
          .locator("img")
          .first()
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);

    await myBackgrounds.getByRole("button", { name: "Rename lake" }).click();
    await myBackgrounds.getByRole("textbox", { name: "Name for lake" }).fill("Mountain lake");
    await myBackgrounds.getByRole("button", { name: "Save name" }).click();
    await expect(myBackgrounds.getByText("Mountain lake", { exact: true })).toBeVisible();

    const listResponse = await page.request.get("/api/v1/custom-backgrounds");
    const { backgrounds } = (await listResponse.json()) as {
      backgrounds: SavedCustomBackground[];
    };
    expect(backgrounds).toMatchObject([{ name: "Mountain lake", source: "upload" }]);

    await myBackgrounds.getByRole("button", { name: "Delete Mountain lake" }).click();
    await expect(myBackgrounds.getByText("Mountain lake", { exact: true })).toHaveCount(0);
    const afterDelete = await page.request.get("/api/v1/custom-backgrounds");
    expect(((await afterDelete.json()) as { backgrounds: unknown[] }).backgrounds).toEqual([]);
  });

  test("an uploaded background can be applied to a page", async ({ account: _, page }) => {
    const book = await createBook(page.request);
    const pageId = await addBookPage(page.request, book.id, "Only page");
    await openBook(page, book.id);
    await filmstripPage(page, /Only page/).click();
    await page.getByRole("button", { name: "Backgrounds" }).click();

    await page.getByLabel("Background image files").setInputFiles({
      name: "meadow.png",
      mimeType: "image/png",
      buffer: createPng(),
    });

    await expect
      .poll(async () => (await savedBackground(page.request, pageId))?.backgroundId ?? "")
      .toMatch(/^custom:/);
    const image = page
      .getByRole("region", { name: "Book editor" })
      .locator('[data-page-background^="custom:"] image')
      .first();
    await expect(image).toHaveAttribute("href", /\/api\/v1\/custom-backgrounds\/.+\/content$/);
  });
});
