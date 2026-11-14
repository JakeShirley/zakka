import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { PageResizeAnchor, PageResizeMode } from "@zakka/editor-core";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { BookDetail } from "../../types";
import { BookSettingsModal } from "./BookSettingsModal";

const book = {
  id: "book_1",
  title: "Family book",
  pageWidth: 2400,
  pageHeight: 2400,
  coverSpreadEnabled: true,
  pages: [],
} as unknown as BookDetail;

function SettingsHarness({
  onSubmit,
}: {
  onSubmit: (resize: { anchor: PageResizeAnchor; mode: PageResizeMode }) => void;
}) {
  const [pageSizeDraft, setPageSizeDraft] = useState("8x8-square");
  const [anchor, setAnchor] = useState<PageResizeAnchor>("center");
  const [mode, setMode] = useState<PageResizeMode>("fit");

  return (
    <BookSettingsModal
      book={book}
      closeDisabled={false}
      coverSpreadEnabledDraft
      pageResizeAnchor={anchor}
      pageResizeMode={mode}
      pageSizeDraft={pageSizeDraft}
      titleDraft={book.title}
      onClose={() => {}}
      onCoverSpreadEnabledDraftChange={() => {}}
      onDeleteRequest={() => {}}
      onPageResizeAnchorChange={setAnchor}
      onPageResizeModeChange={setMode}
      onPageSizeDraftChange={setPageSizeDraft}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ anchor, mode });
      }}
      onTitleDraftChange={() => {}}
    />
  );
}

const previewContent = () =>
  page
    .getByRole("img", { name: "Resize preview" })
    .element()
    .querySelector(".page-resize-preview-content");

describe("BookSettingsModal page resize", () => {
  test("lets the user anchor existing content when the page size changes", async () => {
    const onSubmit = vi.fn();
    await render(
      <FluentProvider theme={webLightTheme}>
        <SettingsHarness onSubmit={onSubmit} />
      </FluentProvider>,
    );

    await expect
      .element(page.getByRole("group", { name: "Existing content" }))
      .not.toBeInTheDocument();

    await page.getByRole("combobox", { name: "Page size" }).selectOptions("11x8_5-landscape");
    await expect.element(page.getByRole("group", { name: "Existing content" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Center" }))
      .toHaveAttribute("aria-pressed", "true");

    await page.getByRole("combobox", { name: "Content sizing" }).selectOptions("keep");
    await page.getByRole("button", { name: "Bottom right" }).click();
    await expect
      .element(page.getByRole("button", { name: "Bottom right" }))
      .toHaveAttribute("aria-pressed", "true");
    // Keep size anchored bottom-right: the 8 x 8 content hugs the 11 x 8.5 page's bottom-right corner.
    expect(previewContent()?.getAttribute("x")).toBe("900");
    expect(previewContent()?.getAttribute("y")).toBe("150");

    await page.getByRole("combobox", { name: "Content sizing" }).selectOptions("stretch");
    await expect.element(page.getByRole("button", { name: "Top left" })).toBeDisabled();

    await page.getByRole("button", { name: "Save" }).click();
    expect(onSubmit).toHaveBeenCalledWith({ anchor: "bottom-right", mode: "stretch" });
  });
});
