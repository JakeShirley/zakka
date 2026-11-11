import type { Locator, Page } from "@playwright/test";
import { PNG } from "pngjs";

import {
  addBookPage,
  canvasLayers,
  createBook,
  expect,
  filmstripPage,
  getBook,
  getSavedPage,
  openBook,
  pageFrame,
  test,
} from "./fixtures";

const undoShortcut = "ControlOrMeta+z";
const redoShortcut = "ControlOrMeta+Shift+z";

async function addTextToActivePage(page: Page) {
  await page.getByRole("button", { name: "Add text" }).click();
}

async function dragBy(page: Page, target: Locator, dx: number, dy: number) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Drag target is not visible");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

function createPng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 210;
    png.data[index + 1] = 120;
    png.data[index + 2] = 60;
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
}

test.describe("books", () => {
  test("New book opens the editor with a front and back cover", async ({ account: _, page }) => {
    await page.goto("/books");
    await page.getByRole("button", { name: "Create your first book" }).click();

    await expect(page).toHaveURL(/\/books\/[^/]+$/);
    await expect(filmstripPage(page, /Front cover/)).toBeVisible();
    await expect(filmstripPage(page, /Back cover/)).toBeVisible();

    await page.getByRole("link", { name: "Books" }).click();
    await expect(page.getByRole("button", { name: /Book 1\s*2 pages/ })).toBeVisible();
  });
});

test.describe("editing a page", () => {
  test("typed text autosaves and is still there after a reload", async ({ account: _, page }) => {
    const book = await createBook(page.request);
    const coverId = book.pages[0]?.pageId ?? "";
    await openBook(page, book.id);

    await addTextToActivePage(page);
    const textLayer = canvasLayers(pageFrame(page, 1), "text");
    await expect(textLayer).toHaveCount(1);
    await textLayer.locator(".canvas-layer-hitbox").dblclick();
    await expect(page.getByRole("textbox", { name: "Edit text" })).toBeFocused();
    await page.keyboard.type(" from e2e");
    await page.keyboard.press("Escape");

    await expect
      .poll(async () => (await getSavedPage(page.request, coverId)).document.layers[0]?.text)
      .toBe("New text from e2e");

    await page.reload();
    await expect(canvasLayers(pageFrame(page, 1), "text")).toHaveCount(1);
  });

  test("dragging a layer saves its new position", async ({ account: _, page }) => {
    const book = await createBook(page.request);
    const coverId = book.pages[0]?.pageId ?? "";
    await openBook(page, book.id);
    await addTextToActivePage(page);
    await expect
      .poll(async () => (await getSavedPage(page.request, coverId)).document.layers)
      .toHaveLength(1);
    const before = (await getSavedPage(page.request, coverId)).document.layers[0];

    const canvas = pageFrame(page, 1).getByRole("group", { name: "Editable page canvas" });
    const canvasBox = await canvas.boundingBox();
    const hitbox = canvasLayers(pageFrame(page, 1), "text").locator(".canvas-layer-hitbox");
    await dragBy(page, hitbox, 60, 40);

    const saved = await getSavedPage(page.request, coverId);
    const unitsPerPixel = saved.document.canvas.width / (canvasBox?.width ?? 1);
    await expect
      .poll(async () => (await getSavedPage(page.request, coverId)).document.layers[0]?.x)
      .toBeCloseTo((before?.x ?? 0) + 60 * unitsPerPixel, -1);
    const after = (await getSavedPage(page.request, coverId)).document.layers[0];
    expect(after?.y).toBeCloseTo((before?.y ?? 0) + 40 * unitsPerPixel, -1);
  });

  test("Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes book edits, and the inspector buttons match", async ({
    account: _,
    page,
  }) => {
    const book = await createBook(page.request);
    await openBook(page, book.id);
    const textLayers = canvasLayers(pageFrame(page, 1), "text");

    await addTextToActivePage(page);
    await expect(textLayers).toHaveCount(1);

    await page.keyboard.press(undoShortcut);
    await expect(textLayers).toHaveCount(0);
    await page.keyboard.press(redoShortcut);
    await expect(textLayers).toHaveCount(1);

    // Redo restores the selection, so the inspector with its history buttons is open again.
    const inspector = page.getByRole("dialog", { name: "Edit Text" });
    await inspector.getByRole("button", { name: "Undo" }).click();
    await expect(textLayers).toHaveCount(0);
    await addTextToActivePage(page);
    await expect(inspector.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  test("Ctrl/Cmd+Z inside a form field undoes the field, not the book", async ({
    account: _,
    page,
  }) => {
    const book = await createBook(page.request);
    await openBook(page, book.id);
    await addTextToActivePage(page);
    const textLayers = canvasLayers(pageFrame(page, 1), "text");
    await expect(textLayers).toHaveCount(1);

    await page.getByRole("button", { name: "Edit page 1" }).click();
    const titleInput = page.getByRole("form", { name: "Edit page 1" }).getByLabel("Title");
    await titleInput.press("End");
    await titleInput.pressSequentially("!");
    await titleInput.press(undoShortcut);

    await expect(titleInput).toHaveValue("Front cover");
    await expect(textLayers).toHaveCount(1);

    // The field's own undo is itself a book edit, so the next book undo outside the field restores
    // the "!" and leaves the text layer. Had the field undo been treated as a book undo, this one
    // would remove the text layer instead.
    await titleInput.blur();
    await page.keyboard.press(undoShortcut);
    await expect(titleInput).toHaveValue("Front cover!");
    await expect(textLayers).toHaveCount(1);
  });

  test("Delete removes the selected layer, but Backspace while typing edits the text", async ({
    account: _,
    page,
  }) => {
    const book = await createBook(page.request);
    await openBook(page, book.id);
    await addTextToActivePage(page);
    const textLayers = canvasLayers(pageFrame(page, 1), "text");

    await textLayers.locator(".canvas-layer-hitbox").dblclick();
    await page.keyboard.press("Backspace");
    await expect(textLayers).toHaveCount(1);
    await page.keyboard.press("Escape");

    await page.keyboard.press("Delete");
    await expect(textLayers).toHaveCount(0);
  });

  test("page settings rename the page and close when another page is selected (#52)", async ({
    account: _,
    page,
  }) => {
    const book = await createBook(page.request);
    const coverId = book.pages[0]?.pageId ?? "";
    await openBook(page, book.id);

    await page.getByRole("button", { name: "Edit page 1" }).click();
    const settings = page.getByRole("form", { name: "Edit page 1" });
    await settings.getByLabel("Title").fill("Our summer");
    await expect(filmstripPage(page, /Our summer/)).toBeVisible();
    await expect
      .poll(async () => (await getSavedPage(page.request, coverId)).title)
      .toBe("Our summer");

    await filmstripPage(page, /Back cover/).click();
    await expect(settings).toBeHidden();
  });
});

test.describe("book pages", () => {
  test("Shift-click selects a range of pages that drag together and keep their order (#8)", async ({
    account: _,
    page,
  }) => {
    const book = await createBook(page.request);
    for (const title of ["Alpha", "Bravo", "Charlie"]) {
      await addBookPage(page.request, book.id, title);
    }
    await openBook(page, book.id);

    await filmstripPage(page, /Alpha/).click();
    await filmstripPage(page, /Bravo/).click({ modifiers: ["Shift"] });
    await expect(page.getByRole("status").filter({ hasText: "2 pages selected" })).toBeAttached();

    const pageItems = page.getByRole("list", { name: "Book pages" }).getByRole("listitem");
    const charlieItem = pageItems.filter({ hasText: "Charlie" });
    const alphaItem = pageItems.filter({ hasText: "Alpha" });
    const charlieBox = await charlieItem.boundingBox();
    await alphaItem.dragTo(charlieItem, {
      targetPosition: { x: (charlieBox?.width ?? 0) - 4, y: (charlieBox?.height ?? 0) / 2 },
    });

    await expect
      .poll(async () =>
        (await getBook(page.request, book.id)).pages.map((entry) => entry.page.title),
      )
      .toEqual(["Front cover", "Charlie", "Alpha", "Bravo", "Back cover"]);
  });
});

test.describe("photos", () => {
  test("an uploaded photo can be added to a book and dropped onto a page", async ({
    account: _,
    page,
  }) => {
    const book = await createBook(page.request);
    const coverId = book.pages[0]?.pageId ?? "";

    await page.goto("/library");
    await page.locator('input[type="file"]').setInputFiles({
      buffer: createPng(320, 240),
      mimeType: "image/png",
      name: "orange-test.png",
    });
    await expect(page.getByText("orange-test.png")).toBeVisible();

    await openBook(page, book.id);
    await page.getByRole("button", { name: "Add more photos" }).click();
    await page.getByRole("button", { name: "Select orange-test.png" }).click();
    await page.getByRole("button", { name: "Add 1 to book" }).click();

    const railPhoto = page.getByRole("button", { name: "Drag orange-test.png onto the page" });
    await railPhoto.dragTo(pageFrame(page, 1).getByRole("group", { name: "Editable page canvas" }));

    await expect(canvasLayers(pageFrame(page, 1), "photo")).toHaveCount(1);
    await expect
      .poll(async () =>
        (await getSavedPage(page.request, coverId)).document.layers.map((layer) => layer.kind),
      )
      .toEqual(["photo"]);
  });
});

test.describe("exports", () => {
  test("exporting a book as PDF offers a working download link", async ({ account: _, page }) => {
    const book = await createBook(page.request);
    await openBook(page, book.id);

    await page.getByRole("button", { name: "Export book PDF" }).click();
    const download = page.getByRole("link", { name: "Download book PDF" });
    await expect(download).toBeVisible({ timeout: 30_000 });

    const response = await page.request.get((await download.getAttribute("href")) ?? "");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("application/pdf");
  });
});

test("Settings shows the signed-in account", async ({ account, page }) => {
  await page.goto("/settings");

  await expect(page.getByLabel("Account").getByText(account.email)).toBeVisible();
});
