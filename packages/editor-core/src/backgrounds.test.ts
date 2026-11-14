import { describe, expect, it } from "vitest";

import {
  builtInBackgrounds,
  createPageDocument,
  createPhotoLayer,
  getBuiltInBackground,
  type PageBackground,
  renderPageDocumentSvg,
  resizePageDocument,
  setPageBackground,
} from "./index.js";

const canvas = { width: 1000, height: 800 };
const frame = (backgroundId: string, overrides: Partial<PageBackground> = {}): PageBackground => ({
  backgroundId,
  x: 0,
  y: 0,
  width: 1000,
  height: 800,
  scale: 1,
  rotation: 0,
  ...overrides,
});

describe("page backgrounds", () => {
  it("has unique ids and a built-in for every category", () => {
    const ids = builtInBackgrounds.map((background) => background.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(builtInBackgrounds.map((background) => background.category))).toEqual(
      new Set(["patterns", "paper", "wood", "fabric", "sky"]),
    );
  });

  it("sets and removes a page background", () => {
    const document = setPageBackground(
      createPageDocument({ canvas }),
      frame("zakka:gingham-red", { scale: 2 }),
    );

    expect(document.canvas.background).toEqual(frame("zakka:gingham-red", { scale: 2 }));
    expect("background" in setPageBackground(document, null).canvas).toBe(false);
  });

  it("draws a scaled pattern between the background colour and the layers", () => {
    const document = setPageBackground(
      createPageDocument({
        canvas,
        layers: [createPhotoLayer({ assetId: "asset_1", id: "photo_1" })],
      }),
      frame("zakka:gingham-red", { scale: 2 }),
    );
    const svg = renderPageDocumentSvg(document, {
      idPrefix: "p1",
      resolvePhotoHref: () => "photo.jpg",
    });

    expect(svg).toContain(
      '<pattern id="p1_page-background" patternUnits="userSpaceOnUse" x="0" y="0" width="300" height="300" viewBox="0 0 150 150">',
    );
    expect(svg.indexOf('data-page-background="zakka:gingham-red"')).toBeLessThan(
      svg.indexOf('href="photo.jpg"'),
    );
    expect(svg.indexOf('href="photo.jpg"')).toBeGreaterThan(-1);
    expect(renderPageDocumentSvg(document, { includeBackground: false })).not.toContain(
      "data-page-background",
    );
  });

  it("tiles textures from the resolved href and falls back to the base colour", () => {
    const texture = getBuiltInBackground("zakka:kraft-paper");
    const document = setPageBackground(createPageDocument({ canvas }), frame("zakka:kraft-paper"));

    expect(texture?.fit === "tile" && texture.kind === "texture").toBe(true);
    expect(
      renderPageDocumentSvg(document, { resolveBackgroundHref: () => "/kraft.jpg" }),
    ).toContain('href="/kraft.jpg" preserveAspectRatio="none"');
    expect(renderPageDocumentSvg(document)).toContain(`fill="${texture?.baseColor}"`);
  });

  it("covers the frame with custom images and clips spread frames to the page", () => {
    const rightPage = setPageBackground(
      createPageDocument({ canvas }),
      frame("custom:custom_background_1", { x: -1000, width: 2000 }),
    );
    const svg = renderPageDocumentSvg(rightPage, {
      resolveBackgroundHref: (background) => `/bg/${background.backgroundId}`,
    });

    expect(svg).toContain('<rect x="0" y="0" width="1000" height="800" />');
    expect(svg).toContain(
      '<image x="-1000" y="0" width="2000" height="800" href="/bg/custom:custom_background_1" preserveAspectRatio="xMidYMid slice" />',
    );
    expect(renderPageDocumentSvg(rightPage)).not.toContain("data-page-background");
  });

  it("rotates backgrounds around the centre of their frame", () => {
    const leftPage = setPageBackground(
      createPageDocument({ canvas }),
      frame("zakka:gingham-red", { width: 2000, rotation: 45 }),
    );
    const rightPage = setPageBackground(
      createPageDocument({ canvas }),
      frame("custom:custom_background_1", { x: -1000, width: 2000, rotation: 90 }),
    );

    expect(renderPageDocumentSvg(leftPage)).toContain('patternTransform="rotate(45 1000 400)"');
    // The rotated image grows to cover the frame, which is now 800 wide and 2000 tall.
    expect(renderPageDocumentSvg(rightPage, { resolveBackgroundHref: () => "/bg.jpg" })).toContain(
      '<g transform="rotate(90 0 400)"><image x="-400" y="-600" width="800" height="2000" href="/bg.jpg"',
    );
    expect(
      setPageBackground(createPageDocument({ canvas }), {
        backgroundId: "zakka:stars",
        x: 0,
        y: 0,
        width: 1000,
        height: 800,
      }).canvas.background,
    ).toEqual(frame("zakka:stars"));
  });

  it("skips backgrounds whose frame misses the page or whose id is unknown", () => {
    const offPage = setPageBackground(
      createPageDocument({ canvas }),
      frame("zakka:gingham-red", { x: 1000 }),
    );
    const unknown = setPageBackground(createPageDocument({ canvas }), frame("zakka:retired"));

    expect(renderPageDocumentSvg(offPage)).not.toContain("data-page-background");
    expect(renderPageDocumentSvg(unknown)).not.toContain("data-page-background");
  });

  it("moves and scales the background frame when the page is resized", () => {
    const document = setPageBackground(
      createPageDocument({ canvas }),
      frame("zakka:gingham-red", { x: -1000, width: 2000 }),
    );

    expect(
      resizePageDocument(document, { width: 500, height: 400 }, { mode: "fit" }).canvas.background,
    ).toEqual(frame("zakka:gingham-red", { x: -500, width: 1000, height: 400, scale: 0.5 }));
  });

  it("keeps a shared spread frame aligned when the page aspect ratio changes", () => {
    const narrow = { width: 600, height: 400 };
    const shared = { width: 1200, height: 400 };
    const [left, right] = [0, -600].map(
      (x) =>
        resizePageDocument(
          setPageBackground(
            createPageDocument({ canvas: narrow }),
            frame("custom:custom_background_1", { x, ...shared }),
          ),
          { width: 800, height: 400 },
          { mode: "fit" },
        ).canvas.background,
    );

    expect(left).toMatchObject({ x: 0, width: 1600, height: 400 });
    expect(right).toMatchObject({ x: -800, width: 1600, height: 400 });
  });
});
