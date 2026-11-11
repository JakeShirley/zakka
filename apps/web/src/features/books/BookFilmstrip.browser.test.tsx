import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createPageDocument } from "@zakka/editor-core";
import type { ComponentProps } from "react";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { PageDetail } from "../../types";
import { BookFilmstrip } from "./BookFilmstrip";

const pageIds = ["page_1", "page_2", "page_3", "page_4"];

const pageDetail = (id: string, index: number): PageDetail => ({
  createdAt: "2026-05-25T12:00:00.000Z",
  document: createPageDocument(),
  height: 3000,
  layerCount: 0,
  id,
  title: `Page title ${index + 1}`,
  updatedAt: "2026-05-25T12:00:00.000Z",
  width: 2400,
});

async function renderFilmstrip(overrides: Partial<ComponentProps<typeof BookFilmstrip>> = {}) {
  const props = {
    draggedPageIds: [],
    editingPageId: null,
    isWorking: false,
    markedPageIds: [],
    orderedPageIds: pageIds,
    pageDetails: new Map(pageIds.map((id, index) => [id, pageDetail(id, index)])),
    pageDropTarget: null,
    visiblePageIds: ["page_2", "page_3"],
    onAddPage: vi.fn(),
    onClearDragState: vi.fn(),
    onClearSelection: vi.fn(),
    onDragOver: vi.fn(),
    onDragStart: vi.fn(),
    onDrop: vi.fn(),
    onSelectPage: vi.fn(),
    onTogglePageSettings: vi.fn(),
    ...overrides,
  };

  await render(
    <FluentProvider theme={webLightTheme}>
      <BookFilmstrip {...props} />
    </FluentProvider>,
  );

  return props;
}

const pageButton = (title: string | RegExp) =>
  page.getByRole("list", { name: "Book pages" }).getByRole("button", { name: title });

// macOS turns Ctrl-click into a right-click before the page sees it, so Mac users rely on Cmd.
const isMac = navigator.platform.startsWith("Mac");

describe("page selection modifiers", () => {
  test.each([
    ["a plain click", [], "replace"],
    ...(isMac ? [] : [["Ctrl-click", ["Control"], "toggle"] as const]),
    ["Cmd-click", ["Meta"], "toggle"],
    ["Shift-click", ["Shift"], "range"],
  ] as const)("%s selects with %s mode", async (_label, modifiers, expectedMode) => {
    const props = await renderFilmstrip();

    await pageButton("Page title 3").click({ modifiers: [...modifiers] });

    expect(props.onSelectPage).toHaveBeenCalledExactlyOnceWith("page_3", expectedMode);
  });
});

test("pages on the canvas and marked pages are announced to assistive tech", async () => {
  await renderFilmstrip({ markedPageIds: ["page_1", "page_2"] });

  await expect
    .element(pageButton(/Page title 2\s*, selected and on canvas$/))
    .toHaveAttribute("aria-current", "page");
  await expect
    .element(pageButton(/Page title 1\s*, selected$/))
    .toHaveAttribute("aria-pressed", "true");
  await expect.element(pageButton(/Page title 4$/)).toHaveAttribute("aria-pressed", "false");
  await expect.element(page.getByRole("status")).toHaveTextContent("2 pages selected");
});

test("a multi-page selection offers Clear selection", async () => {
  const props = await renderFilmstrip({ markedPageIds: ["page_1", "page_3"] });

  await page.getByRole("button", { name: "Clear selection" }).click();

  expect(props.onClearSelection).toHaveBeenCalledOnce();
});

test("a single marked page does not show the multi-select bar", async () => {
  await renderFilmstrip({ markedPageIds: ["page_1"] });

  await expect
    .element(page.getByRole("button", { name: "Clear selection" }))
    .not.toBeInTheDocument();
});

test("while a page operation is running pages cannot be dragged or added", async () => {
  await renderFilmstrip({ isWorking: true });

  const items = page.getByRole("list", { name: "Book pages" }).getByRole("listitem").elements();
  expect(
    items.slice(0, pageIds.length).every((item) => item.getAttribute("draggable") === "false"),
  ).toBe(true);
  await expect.element(page.getByRole("button", { name: "Add page" })).toBeDisabled();
});

test("the edit button opens settings for that page", async () => {
  const props = await renderFilmstrip();

  await page.getByRole("button", { name: "Edit page 2" }).click();

  expect(props.onTogglePageSettings).toHaveBeenCalledExactlyOnceWith("page_2");
  expect(props.onSelectPage).not.toHaveBeenCalled();
});

test("dragging a selected page shows how many pages are moving", async () => {
  await renderFilmstrip({
    draggedPageIds: ["page_1", "page_2"],
    markedPageIds: ["page_1", "page_2"],
  });

  const draggedItem = page.getByRole("listitem").filter({ hasText: "Page title 1" });
  await expect.element(draggedItem).toHaveAttribute("data-dragging", "true");
  expect(draggedItem.element().querySelector(".book-filmstrip-drag-count")?.textContent).toBe("2");
});
