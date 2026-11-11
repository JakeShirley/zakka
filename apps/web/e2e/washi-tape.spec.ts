import {
  canvasLayers,
  createBook,
  expect,
  getSavedPage,
  openBook,
  pageFrame,
  test,
} from "./fixtures";

type SavedWashiTape = {
  id: string;
  name: string;
  design: { outline: string; pattern: { kind: string } };
};

type SavedWashiTapeLayer = {
  kind: string;
  outline?: string;
  pattern?: { kind: string };
};

test.describe("washi tape gallery", () => {
  test("a custom washi tape saved from the editor gallery can be added to a page (#9)", async ({
    account: _,
    page,
  }) => {
    const book = await createBook(page.request);
    const coverId = book.pages[0]?.pageId ?? "";
    await openBook(page, book.id);

    await page.getByRole("button", { name: "Add washi tape" }).click();
    const gallery = page.getByRole("dialog", { name: "Add washi tape" });
    await expect(gallery).toBeVisible();

    await gallery.getByRole("button", { name: /Create custom washi tape/ }).click();
    const creator = gallery.getByRole("form", { name: "Create custom washi tape" });
    await creator.getByRole("combobox", { name: /^Outline/ }).selectOption("wave");
    await creator.getByRole("combobox", { name: /^Pattern/ }).selectOption("checker");
    await creator.getByRole("textbox", { name: "Name" }).fill("Picnic");
    await creator.getByRole("button", { name: "Save to gallery" }).click();

    await expect(creator).toHaveCount(0);
    const myWashiTape = gallery.getByRole("region", { name: "My washi tape" });
    await expect(myWashiTape.getByRole("button", { name: "Add Picnic" })).toBeVisible();

    const listResponse = await page.request.get("/api/v1/custom-washi-tapes");
    const { washiTapes } = (await listResponse.json()) as { washiTapes: SavedWashiTape[] };
    expect(washiTapes).toHaveLength(1);
    expect(washiTapes[0]).toMatchObject({
      name: "Picnic",
      design: { outline: "wave", pattern: { kind: "checker" } },
    });

    await myWashiTape.getByRole("button", { name: "Add Picnic" }).click();
    await expect(gallery).toHaveCount(0);
    await expect(canvasLayers(pageFrame(page, 1), "washiTape")).toHaveCount(1);

    await expect
      .poll(async () => {
        const layer = (await getSavedPage(page.request, coverId)).document.layers[0] as
          | SavedWashiTapeLayer
          | undefined;
        return layer && { kind: layer.kind, outline: layer.outline, pattern: layer.pattern?.kind };
      })
      .toEqual({ kind: "washiTape", outline: "wave", pattern: "checker" });
  });

  test("the Washi Tape page edits and deletes saved tape (#9)", async ({ account: _, page }) => {
    const createResponse = await page.request.post("/api/v1/custom-washi-tapes", {
      data: {
        name: "Mint stripes",
        design: {
          outline: "torn",
          pattern: { kind: "stripe", primaryColor: "#ffffff", secondaryColor: "#79a9a4" },
          tile: { scale: 1, scaleX: 1, scaleY: 1, rotation: 0, offsetX: 0, offsetY: 0 },
        },
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBe(true);

    await page.goto("/washi-tape");
    const myWashiTape = page.getByRole("region", { name: "My washi tape" });
    await expect(myWashiTape.getByText("Mint stripes")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Designs" }).getByRole("listitem").first(),
    ).toBeVisible();

    await myWashiTape.getByRole("button", { name: "Edit Mint stripes" }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit washi tape" });
    const editor = editDialog.getByRole("form", { name: "Edit washi tape" });
    await expect(editor).toBeVisible();
    await expect(page.getByRole("button", { name: /Create custom washi tape/ })).toBeVisible();
    await editor.getByRole("textbox", { name: "Name" }).fill("Mint ribbon");
    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect(editDialog).toHaveCount(0);
    await expect(myWashiTape.getByText("Mint ribbon")).toBeVisible();

    await page.reload();
    await expect(myWashiTape.getByText("Mint ribbon")).toBeVisible();

    await myWashiTape.getByRole("button", { name: "Delete Mint ribbon" }).click();
    await expect(myWashiTape.getByText("Mint ribbon")).toHaveCount(0);
    const listResponse = await page.request.get("/api/v1/custom-washi-tapes");
    expect(((await listResponse.json()) as { washiTapes: unknown[] }).washiTapes).toEqual([]);
  });
});
