import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { BookResponse } from "@zakka/api-contract";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { apiClient } from "../../apiClient";
import { ShutterflyImportModal } from "./ShutterflyImportModal";

const importedBook: BookResponse = {
  id: "book_imported",
  title: "Summer 2026",
  pageWidth: 2385,
  pageHeight: 2385,
  coverSpreadEnabled: true,
  pageCount: 34,
  spreadCount: 17,
  createdAt: "2026-05-17T12:00:00.000Z",
  updatedAt: "2026-05-17T12:00:00.000Z",
  pages: [],
  spreads: [],
};

const renderModal = async () => {
  const props = { onClose: vi.fn(), onOpenBook: vi.fn() };

  await render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <ShutterflyImportModal {...props} />
      </MemoryRouter>
    </FluentProvider>,
  );

  return props;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ShutterflyImportModal", () => {
  test("imports the chosen project and shows what could not be brought across", async () => {
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
          productName: "8x8 Deluxe Layflat Photo Book",
          thumbnailUrl: null,
          pageCount: 34,
          updatedAt: "2026-05-21T21:59:17.820Z",
        },
      ],
    });
    const importProject = vi.spyOn(apiClient, "importShutterflyProject").mockResolvedValue({
      book: importedBook,
      warnings: ["Skipped spine text because Zakka books have no spine"],
    });
    const props = await renderModal();

    await expect.element(page.getByText("8x8 Deluxe Layflat Photo Book / 34 pages")).toBeVisible();
    await page.getByRole("button", { name: "Import Summer 2026" }).click();

    await expect
      .element(page.getByText("Skipped spine text because Zakka books have no spine"))
      .toBeVisible();
    expect(importProject).toHaveBeenCalledWith("1219497168070");

    await page.getByRole("button", { name: "Open book" }).click();

    expect(props.onOpenBook).toHaveBeenCalledWith("book_imported");
  });

  test("sends users to Settings when Shutterfly is not connected", async () => {
    vi.spyOn(apiClient, "getShutterflyConnection").mockResolvedValue({
      configured: true,
      connected: false,
      email: null,
      connectedAt: null,
    });
    const listProjects = vi.spyOn(apiClient, "listShutterflyProjects");

    await renderModal();

    await expect.element(page.getByRole("button", { name: "Connect in Settings" })).toBeVisible();
    expect(listProjects).not.toHaveBeenCalled();
  });
});
