import { type ShutterflyArchiveResponse, shutterflyArchiveParts } from "@zakka/api-contract";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { apiClient } from "../../apiClient";
import { ShutterflyArchiveSection } from "./ShutterflyArchiveSection";

const progress: ShutterflyArchiveResponse["progress"] = {
  step: "finishing",
  photos: { completed: 1200, failed: 2, total: 1202 },
  projects: { completed: 14, failed: 0, total: 14 },
  albums: { completed: 9, failed: 0, total: 9 },
  orders: 37,
  bytes: 5 * 1024 * 1024 * 1024,
  errorCount: 2,
};

const archive = (overrides: Partial<ShutterflyArchiveResponse>): ShutterflyArchiveResponse => ({
  id: "shutterfly_archive_1",
  parts: [...shutterflyArchiveParts],
  status: "completed",
  progress,
  error: null,
  createdAt: "2026-05-17T12:00:00.000Z",
  updatedAt: "2026-05-17T13:00:00.000Z",
  finishedAt: "2026-05-17T13:00:00.000Z",
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

const partName = (part: (typeof shutterflyArchiveParts)[number]) =>
  ({
    photos: "Photo library",
    albums: "Albums",
    books: "Photo books",
    calendars: "Calendars",
    cards: "Cards & stationery",
    prints: "Prints",
    otherProjects: "Other projects",
    orders: "Order history",
  })[part];

describe("ShutterflyArchiveSection", () => {
  test("starts an archive and shows its progress", async () => {
    vi.spyOn(apiClient, "listShutterflyArchives").mockResolvedValue({ archives: [] });
    const startShutterflyArchive = vi.spyOn(apiClient, "startShutterflyArchive").mockResolvedValue(
      archive({
        status: "running",
        finishedAt: null,
        progress: {
          ...progress,
          step: "photos",
          photos: { completed: 300, failed: 0, total: 1202 },
          errorCount: 0,
        },
      }),
    );

    await render(<ShutterflyArchiveSection connected />);
    await page.getByRole("button", { name: "Archive my Shutterfly account" }).click();

    expect(startShutterflyArchive).toHaveBeenCalledWith(shutterflyArchiveParts);
    await expect.element(page.getByText("Downloading original photos")).toBeVisible();
    await expect.element(page.getByText(/300 of 1,202 photos/)).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Archive my Shutterfly account" }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("link", { name: "Download ZIP" })).not.toBeInTheDocument();
  });

  test("archives only the chosen parts", async () => {
    vi.spyOn(apiClient, "listShutterflyArchives").mockResolvedValue({ archives: [] });
    const startShutterflyArchive = vi
      .spyOn(apiClient, "startShutterflyArchive")
      .mockResolvedValue(archive({ parts: ["cards", "orders"], progress }));

    await render(<ShutterflyArchiveSection connected />);

    for (const part of shutterflyArchiveParts) {
      await page.getByRole("checkbox", { name: partName(part) }).click();
    }

    await expect
      .element(page.getByRole("button", { name: "Archive selected parts" }))
      .toBeDisabled();

    await page.getByRole("checkbox", { name: "Cards & stationery" }).click();
    await page.getByRole("checkbox", { name: "Order history" }).click();
    await page.getByRole("button", { name: "Archive selected parts" }).click();

    expect(startShutterflyArchive).toHaveBeenCalledWith(["cards", "orders"]);
    await expect
      .element(page.getByText("Includes: Cards & stationery, Order history"))
      .toBeVisible();
    await expect.element(page.getByText(/14 of 14 projects · 37 orders/)).toBeVisible();
    await expect.element(page.getByText(/\d photos/)).not.toBeInTheDocument();
  });

  test("downloads, resumes, and deletes finished archives", async () => {
    vi.spyOn(apiClient, "listShutterflyArchives").mockResolvedValue({
      archives: [
        archive({
          status: "interrupted",
          finishedAt: null,
          error: { code: "archive_stopped", message: "The server restarted." },
        }),
      ],
    });
    const resumeShutterflyArchive = vi
      .spyOn(apiClient, "resumeShutterflyArchive")
      .mockResolvedValue(archive({ status: "running", finishedAt: null }));
    const deleteShutterflyArchive = vi
      .spyOn(apiClient, "deleteShutterflyArchive")
      .mockResolvedValue();

    await render(<ShutterflyArchiveSection connected />);

    await expect.element(page.getByRole("alert")).toHaveTextContent("The server restarted.");
    await expect.element(page.getByText(/2 items could not be saved/)).toBeVisible();
    await expect.element(page.getByText(/5\.0 GB/)).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Download ZIP" }))
      .toHaveAttribute(
        "href",
        "/api/v1/integrations/shutterfly/archives/shutterfly_archive_1/download",
      );

    await page.getByRole("button", { name: "Resume" }).click();

    expect(resumeShutterflyArchive).toHaveBeenCalledWith("shutterfly_archive_1");
    await expect.element(page.getByText("In progress")).toBeVisible();

    await page.getByRole("button", { name: /^Cancel archive from/ }).click();
    await page.getByRole("button", { name: "Delete archive" }).click();

    expect(deleteShutterflyArchive).toHaveBeenCalledWith("shutterfly_archive_1");
    await expect.element(page.getByText("In progress")).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Archive my Shutterfly account" }))
      .toBeVisible();
  });

  test("lists archives without archive actions when disconnected", async () => {
    vi.spyOn(apiClient, "listShutterflyArchives").mockResolvedValue({ archives: [archive({})] });

    await render(<ShutterflyArchiveSection connected={false} />);

    await expect.element(page.getByRole("link", { name: "Download ZIP" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Update" })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Archive my Shutterfly account" }))
      .not.toBeInTheDocument();
  });
});
