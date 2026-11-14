import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { BookResponse, ShutterflyImportJobResponse } from "@zakka/api-contract";
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
  const mockConnectedProjects = () => {
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
  };

  const runningJob: ShutterflyImportJobResponse = {
    id: "shutterfly_import_1",
    projectId: "1219497168070",
    status: "running",
    progress: { step: "photos", completed: 1, total: 2, fraction: 0.475 },
    result: null,
    error: null,
  };

  test("shows import progress, then what could not be brought across", async () => {
    mockConnectedProjects();
    const startImport = vi.spyOn(apiClient, "startShutterflyImport").mockResolvedValue(runningJob);
    let finishImport: (job: ShutterflyImportJobResponse) => void = () => undefined;
    const getImport = vi.spyOn(apiClient, "getShutterflyImport").mockReturnValue(
      new Promise((resolve) => {
        finishImport = resolve;
      }),
    );
    const props = await renderModal();

    await expect.element(page.getByText("8x8 Deluxe Layflat Photo Book / 34 pages")).toBeVisible();
    await page.getByRole("button", { name: "Import Summer 2026" }).click();

    await expect.element(page.getByText("Downloading photos (1 of 2)")).toBeVisible();
    await expect.element(page.getByText("48%")).toBeVisible();
    await expect
      .element(page.getByRole("progressbar", { name: "Downloading photos (1 of 2)" }))
      .toHaveAttribute("value", "0.475");
    expect(startImport).toHaveBeenCalledWith("1219497168070");
    await expect.poll(() => getImport.mock.calls.length, { timeout: 3000 }).toBe(1);
    expect(getImport).toHaveBeenCalledWith("shutterfly_import_1");
    await expect.element(page.getByRole("button", { name: "Close" }).first()).toBeDisabled();

    finishImport({
      ...runningJob,
      status: "completed",
      progress: { step: "pages", completed: 34, total: 34, fraction: 1 },
      result: {
        book: importedBook,
        warnings: ["Skipped spine text because Zakka books have no spine"],
      },
    });

    await expect
      .element(page.getByText("Skipped spine text because Zakka books have no spine"))
      .toBeVisible();

    await page.getByRole("button", { name: "Open book" }).click();

    expect(props.onOpenBook).toHaveBeenCalledWith("book_imported");
  });

  test("shows why a background import failed", async () => {
    mockConnectedProjects();
    vi.spyOn(apiClient, "startShutterflyImport").mockResolvedValue(runningJob);
    vi.spyOn(apiClient, "getShutterflyImport").mockResolvedValue({
      ...runningJob,
      status: "failed",
      error: {
        code: "shutterfly_reconnect_required",
        message: "Shutterfly sign-in expired. Reconnect your Shutterfly account in Settings.",
      },
    });
    const props = await renderModal();

    await page.getByRole("button", { name: "Import Summer 2026" }).click();

    await expect
      .element(page.getByRole("alert"), { timeout: 3000 })
      .toHaveTextContent(
        "Shutterfly sign-in expired. Reconnect your Shutterfly account in Settings.",
      );
    await expect.element(page.getByRole("button", { name: "Import Summer 2026" })).toBeEnabled();
    expect(props.onOpenBook).not.toHaveBeenCalled();
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
