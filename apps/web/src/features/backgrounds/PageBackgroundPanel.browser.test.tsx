import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { apiClient } from "../../apiClient";
import type { CustomBackground } from "../../types";
import { PageBackgroundPanel } from "./PageBackgroundPanel";

const createCustomBackground = (overrides: Partial<CustomBackground> = {}): CustomBackground => ({
  id: "custom_background_beach",
  backgroundId: "custom:custom_background_beach",
  name: "Beach day",
  mimeType: "image/png",
  byteSize: 1024,
  width: 64,
  height: 32,
  source: "shutterfly",
  contentUrl: "/api/v1/custom-backgrounds/custom_background_beach/content",
  thumbnailUrl: "/api/v1/custom-backgrounds/custom_background_beach/thumbnail",
  createdAt: "2026-05-17T12:00:00.000Z",
  updatedAt: "2026-05-17T12:00:00.000Z",
  ...overrides,
});

const renderPanel = async (props: Partial<Parameters<typeof PageBackgroundPanel>[0]> = {}) => {
  const handlers = {
    applyTarget: "spread" as const,
    background: null,
    backgroundColor: "#ffffff",
    canApplyToSpread: true,
    onApplyTargetChange: vi.fn(),
    onBackgroundColorChange: vi.fn(),
    onRemove: vi.fn(),
    onRotationChange: vi.fn(),
    onScaleChange: vi.fn(),
    onSelect: vi.fn(),
  };

  await render(<PageBackgroundPanel {...handlers} {...props} />);

  return handlers;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PageBackgroundPanel", () => {
  test("applies built-in and imported backgrounds from the library", async () => {
    vi.spyOn(apiClient, "listCustomBackgrounds").mockResolvedValue({
      backgrounds: [createCustomBackground()],
    });
    const { onApplyTargetChange, onSelect } = await renderPanel();

    await page.getByRole("button", { name: "Use Red gingham background" }).click();
    expect(onSelect).toHaveBeenLastCalledWith("zakka:gingham-red");

    await page.getByRole("button", { name: "Use Beach day background" }).click();
    expect(onSelect).toHaveBeenLastCalledWith("custom:custom_background_beach");

    await page.getByRole("button", { name: "This page" }).click();
    expect(onApplyTargetChange).toHaveBeenCalledWith("page");
  });

  test("filters the library by name and category", async () => {
    vi.spyOn(apiClient, "listCustomBackgrounds").mockResolvedValue({ backgrounds: [] });
    await renderPanel();

    await page.getByRole("searchbox", { name: "Search backgrounds" }).fill("wood");

    await expect
      .element(page.getByRole("button", { name: "Use Light oak background" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Use Red gingham background" }))
      .not.toBeInTheDocument();
  });

  test("adjusts tile size and rotation and removes a tiled background", async () => {
    vi.spyOn(apiClient, "listCustomBackgrounds").mockResolvedValue({ backgrounds: [] });
    const { onRemove, onRotationChange, onScaleChange } = await renderPanel({
      background: {
        backgroundId: "zakka:hearts",
        x: 0,
        y: 0,
        width: 1200,
        height: 600,
        scale: 1.5,
        rotation: 30,
      },
      canApplyToSpread: false,
    });

    await expect.element(page.getByRole("button", { name: "This page" })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Use Hearts background" }))
      .toHaveAttribute("aria-pressed", "true");

    await page.getByRole("slider", { name: "Tile size" }).fill("2");
    expect(onScaleChange).toHaveBeenLastCalledWith(2);

    await page.getByRole("button", { name: "Reset tile size" }).click();
    expect(onScaleChange).toHaveBeenLastCalledWith(1);

    await expect.element(page.getByText("30°")).toBeInTheDocument();
    await page.getByRole("slider", { name: "Rotation" }).fill("-45");
    expect(onRotationChange).toHaveBeenLastCalledWith(-45);

    await page.getByRole("button", { name: "Reset rotation" }).click();
    expect(onRotationChange).toHaveBeenLastCalledWith(0);

    await page.getByRole("button", { name: "Remove" }).click();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  test("hides the tile size control but keeps rotation for cover backgrounds", async () => {
    vi.spyOn(apiClient, "listCustomBackgrounds").mockResolvedValue({ backgrounds: [] });
    await renderPanel({
      background: {
        backgroundId: "zakka:sky-sunset",
        x: 0,
        y: 0,
        width: 600,
        height: 600,
        scale: 1,
        rotation: 0,
      },
    });

    await expect.element(page.getByText("Sunset", { exact: true }).first()).toBeInTheDocument();
    await expect.element(page.getByRole("slider", { name: "Tile size" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("slider", { name: "Rotation" })).toBeInTheDocument();
  });

  test("selects a single uploaded background right away", async () => {
    vi.spyOn(apiClient, "listCustomBackgrounds").mockResolvedValue({ backgrounds: [] });
    const upload = vi.spyOn(apiClient, "uploadCustomBackground").mockImplementation(async (file) =>
      createCustomBackground({
        id: "custom_background_new",
        backgroundId: "custom:custom_background_new",
        name: file.name,
        source: "upload",
      }),
    );
    const { onSelect } = await renderPanel();

    await page
      .getByLabelText("Background image files")
      .upload(new File(["png"], "garden.png", { type: "image/png" }));

    await expect.poll(() => onSelect.mock.calls.at(-1)).toEqual(["custom:custom_background_new"]);
    expect(upload).toHaveBeenCalledTimes(1);
    await expect
      .element(page.getByRole("button", { name: "Use garden.png background" }))
      .toBeInTheDocument();
  });
});
