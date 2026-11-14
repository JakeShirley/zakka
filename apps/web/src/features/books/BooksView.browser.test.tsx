import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { apiClient } from "../../apiClient";
import type { BookSummary } from "../../types";
import { BooksView } from "./BooksView";

const importedBook: BookSummary = {
  id: "book_imported",
  title: "Summer 2026",
  pageWidth: 2385,
  pageHeight: 2385,
  coverSpreadEnabled: true,
  pageCount: 34,
  spreadCount: 17,
  createdAt: "2026-05-17T12:00:00.000Z",
  updatedAt: "2026-05-17T12:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BooksView Shutterfly import", () => {
  test("shows an imported book after the import dialog is closed without opening it", async () => {
    vi.spyOn(apiClient, "listBooks")
      .mockResolvedValueOnce({ books: [] })
      .mockResolvedValue({ books: [importedBook] });
    vi.spyOn(apiClient, "getShutterflyConnection").mockResolvedValue({
      configured: true,
      connected: true,
      email: "reader@example.com",
      connectedAt: "2026-05-17T12:00:00.000Z",
    });
    vi.spyOn(apiClient, "listShutterflyProjects").mockResolvedValue({
      projects: [
        {
          id: "1219497168070",
          name: "Summer 2026",
          productName: null,
          thumbnailUrl: null,
          pageCount: 34,
          updatedAt: null,
        },
      ],
    });
    vi.spyOn(apiClient, "startShutterflyImport").mockResolvedValue({
      id: "shutterfly_import_1",
      projectId: "1219497168070",
      status: "completed",
      progress: { step: "pages", completed: 34, total: 34, fraction: 1 },
      result: {
        book: { ...importedBook, pages: [], spreads: [] },
        warnings: ["Skipped spine text because Zakka books have no spine"],
      },
      error: null,
    });

    await render(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter>
          <BooksView />
        </MemoryRouter>
      </FluentProvider>,
    );

    await expect.element(page.getByText("No books yet.")).toBeVisible();
    await page.getByRole("button", { name: "Import from Shutterfly" }).click();
    await page.getByRole("button", { name: "Import Summer 2026" }).click();
    await expect
      .element(page.getByText("Skipped spine text because Zakka books have no spine"))
      .toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();

    await expect.element(page.getByRole("button", { name: /Summer 2026/ })).toBeVisible();
  });
});
