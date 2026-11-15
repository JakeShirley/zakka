import { Button } from "@fluentui/react-components";
import type { PageDocument } from "@zakka/editor-core";
import {
  applyPageLayout,
  decodePageLayouts,
  filterPageLayoutsForCanvas,
  getPageLayoutCategories,
  getPageLayoutFit,
  PageLayoutLayerLimitError,
  type PageLayout,
  type PageLayoutCategory,
  type PageLayoutPhotoSlot,
  type PageLayoutSlot,
  pageLayoutCategories,
  zakkaPageLayouts,
} from "@zakka/editor-core/page-layouts";
import { useEffect, useMemo, useState } from "react";

import { AppModal } from "../../components/layout";
import { getErrorMessage } from "../../lib/errors";
import type { Asset } from "../../types";

type CategoryFilter = "all" | PageLayoutCategory;

type PhotoFilter = "any" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7-9" | "10+";

const photoFilterLabels: Record<PhotoFilter, string> = {
  any: "Any",
  "0": "None",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7-9": "7\u20139",
  "10+": "10+",
};

const matchesPhotoFilter = (count: number, filter: PhotoFilter) => {
  if (filter === "any") return true;
  if (filter === "7-9") return count >= 7 && count <= 9;
  if (filter === "10+") return count >= 10;
  return count === Number(filter);
};

let shutterflyLayoutsPromise: Promise<PageLayout[]> | null = null;

const loadShutterflyLayouts = () => {
  shutterflyLayoutsPromise ??= import("@zakka/editor-core/page-layouts-shutterfly").then(
    ({ shutterflyPageLayouts }) => decodePageLayouts(shutterflyPageLayouts),
  );
  shutterflyLayoutsPromise.catch(() => {
    shutterflyLayoutsPromise = null;
  });
  return shutterflyLayoutsPromise;
};

const pluralize = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Applies a layout using each placed photo's natural aspect ratio from the asset library. */
export const applyPageLayoutWithAssets = (
  document: PageDocument,
  layout: PageLayout,
  assets: readonly Asset[],
) => {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return applyPageLayout(document, layout, {
    getPhotoAspectRatio: (layer) => {
      const asset = layer.assetId ? assetsById.get(layer.assetId) : undefined;
      if (!asset?.width || !asset.height) return null;
      // Stored dimensions are pre-rotation; EXIF orientations 5-8 display rotated a quarter turn.
      const isQuarterTurned =
        asset.orientation !== null && asset.orientation >= 5 && asset.orientation <= 8;
      return isQuarterTurned ? asset.height / asset.width : asset.width / asset.height;
    },
  });
};

const sourceLabel = (source: PageLayout["source"]) =>
  source === "zakka" ? "Zakka original" : "Shutterfly";

function PhotoSlotShape({ slot, width, height }: { slot: PageLayoutPhotoSlot } & Box) {
  const frameInset =
    slot.frame === "polaroid" || slot.frame === "mat" || slot.frame === "paper"
      ? Math.min(width, height) * 0.08
      : 0;
  const bottomInset = slot.frame === "polaroid" ? frameInset * 2.6 : frameInset;
  const inner = {
    x: frameInset,
    y: frameInset,
    width: Math.max(0, width - frameInset * 2),
    height: Math.max(0, height - frameInset - bottomInset),
  };
  const shape = (() => {
    switch (slot.mask) {
      case "ellipse":
        return (
          <ellipse
            cx={inner.x + inner.width / 2}
            cy={inner.y + inner.height / 2}
            rx={inner.width / 2}
            ry={inner.height / 2}
          />
        );
      case "diamond":
        return (
          <polygon
            points={`${inner.x + inner.width / 2},${inner.y} ${inner.x + inner.width},${inner.y + inner.height / 2} ${inner.x + inner.width / 2},${inner.y + inner.height} ${inner.x},${inner.y + inner.height / 2}`}
          />
        );
      case "arch": {
        const radius = inner.width / 2;
        return (
          <path
            d={`M ${inner.x} ${inner.y + inner.height} V ${inner.y + radius} A ${radius} ${radius} 0 0 1 ${inner.x + inner.width} ${inner.y + radius} V ${inner.y + inner.height} Z`}
          />
        );
      }
      case "ticket":
        return <rect {...inner} rx={Math.min(inner.width, inner.height) * 0.12} />;
      default:
        return <rect {...inner} />;
    }
  })();

  return (
    <>
      {frameInset > 0 ? (
        <rect className="layout-thumbnail-frame" width={width} height={height} />
      ) : null}
      <g className="layout-thumbnail-photo" data-frame={slot.frame ?? "none"}>
        {shape}
      </g>
    </>
  );
}

type Box = { width: number; height: number };

function LayoutSlotShape({ slot, canvas }: { slot: PageLayoutSlot; canvas: Box }) {
  const width = slot.width * canvas.width;
  const height = slot.height * canvas.height;
  const transform = `translate(${slot.x * canvas.width} ${slot.y * canvas.height})${
    slot.rotation ? ` rotate(${slot.rotation} ${width / 2} ${height / 2})` : ""
  }`;

  if (slot.kind === "photo") {
    return (
      <g transform={transform}>
        <PhotoSlotShape slot={slot} width={width} height={height} />
      </g>
    );
  }

  const lineHeight = Math.min(
    height * 0.5,
    canvas.height * (slot.role === "title" ? 0.045 : 0.022),
  );
  const lineCount = Math.max(1, Math.min(4, Math.floor(height / (lineHeight * 1.9))));
  const lineWidth = (index: number) =>
    width * (index === lineCount - 1 && lineCount > 1 ? 0.6 : 0.9);
  const lineX = (lineLength: number) =>
    slot.align === "center"
      ? (width - lineLength) / 2
      : slot.align === "right"
        ? width - lineLength
        : 0;
  const blockHeight = lineCount * lineHeight * 1.9 - lineHeight * 0.9;

  return (
    <g transform={transform} className="layout-thumbnail-text" data-role={slot.role}>
      {Array.from({ length: lineCount }, (_, index) => {
        const lineLength = lineWidth(index);
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional placeholders
            key={index}
            x={lineX(lineLength)}
            y={(height - blockHeight) / 2 + index * lineHeight * 1.9}
            width={lineLength}
            height={lineHeight}
            rx={lineHeight / 2}
          />
        );
      })}
    </g>
  );
}

export function LayoutThumbnail({ layout, canvas }: { layout: PageLayout; canvas: Box }) {
  return (
    <svg
      className="layout-thumbnail"
      viewBox={`0 0 ${canvas.width} ${canvas.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <rect className="layout-thumbnail-page" width={canvas.width} height={canvas.height} />
      {layout.slots.map((slot, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: slots have no identity beyond their order
        <LayoutSlotShape key={index} slot={slot} canvas={canvas} />
      ))}
    </svg>
  );
}

const LAYOUT_PAGE_SIZE = 48;

function LayoutGrid({
  canvas,
  extraPhotoCounts,
  layouts,
  onApply,
}: {
  canvas: Box;
  extraPhotoCounts?: Map<string, number>;
  layouts: PageLayout[];
  onApply: (layout: PageLayout) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(LAYOUT_PAGE_SIZE);
  const remaining = layouts.length - visibleCount;
  return (
    <div className="layout-picker-grid">
      {layouts.slice(0, visibleCount).map((layout) => {
        const extraPhotos = extraPhotoCounts?.get(layout.id) ?? 0;
        return (
          <button
            type="button"
            key={layout.id}
            className="layout-picker-item"
            data-source={layout.source}
            aria-label={`Apply ${layout.name} layout (${sourceLabel(layout.source)})${
              extraPhotos > 0 ? `, removes ${pluralize(extraPhotos, "photo")}` : ""
            }`}
            onClick={() => onApply(layout)}
          >
            <LayoutThumbnail layout={layout} canvas={canvas} />
            <span className="layout-picker-item-copy">
              <span>{layout.name}</span>
              <span>
                {extraPhotos > 0
                  ? `Removes ${pluralize(extraPhotos, "photo")}`
                  : sourceLabel(layout.source)}
              </span>
            </span>
          </button>
        );
      })}
      {remaining > 0 ? (
        <button
          type="button"
          className="secondary-button layout-picker-more"
          onClick={() => setVisibleCount((count) => count + LAYOUT_PAGE_SIZE * 2)}
        >
          Show more ({remaining})
        </button>
      ) : null}
    </div>
  );
}

export function LayoutPickerModal({
  confirmPhotoRemoval = false,
  document,
  onApply,
  onClose,
}: {
  /** Ask before applying a layout that drops photos (for editors without undo). */
  confirmPhotoRemoval?: boolean;
  document: PageDocument;
  onApply: (layout: PageLayout) => void;
  onClose: () => void;
}) {
  const [shutterflyLayouts, setShutterflyLayouts] = useState<PageLayout[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [photoFilter, setPhotoFilter] = useState<PhotoFilter>("any");
  const [pendingLayout, setPendingLayout] = useState<PageLayout | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const { canvas } = document;
  const filterKey = `${categoryFilter}:${photoFilter}`;

  // Editors close the picker before applying, so catch layouts that cannot fit here.
  const applyLayout = (layout: PageLayout) => {
    setPendingLayout(null);
    try {
      applyPageLayout(document, layout);
    } catch (error) {
      if (!(error instanceof PageLayoutLayerLimitError)) throw error;
      setApplyError(error.message);
      return;
    }
    setApplyError(null);
    onApply(layout);
  };

  useEffect(() => {
    let isCancelled = false;
    loadShutterflyLayouts()
      .then((layouts) => {
        if (!isCancelled) setShutterflyLayouts(layouts);
      })
      .catch((error: unknown) => {
        if (!isCancelled) setLoadError(getErrorMessage(error));
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  const { candidates, categoryCounts } = useMemo(() => {
    const photoMatches = filterPageLayoutsForCanvas(
      [...zakkaPageLayouts, ...(shutterflyLayouts ?? [])],
      canvas,
    ).filter((layout) => matchesPhotoFilter(layout.photoSlotCount, photoFilter));
    const counts = new Map<PageLayoutCategory, number>();
    const inCategory: PageLayout[] = [];
    for (const layout of photoMatches) {
      const categories = getPageLayoutCategories(layout);
      for (const category of categories) counts.set(category, (counts.get(category) ?? 0) + 1);
      if (categoryFilter === "all" || categories.has(categoryFilter)) inCategory.push(layout);
    }
    return { candidates: inCategory, categoryCounts: counts };
  }, [canvas, categoryFilter, photoFilter, shutterflyLayouts]);

  const { fitting, other, extraPhotoCounts, pageFit } = useMemo(() => {
    const fits: PageLayout[] = [];
    const doesNotFit: PageLayout[] = [];
    const extras = new Map<string, number>();
    const pageFit = getPageLayoutFit(document, blankLayout);
    for (const layout of candidates) {
      const fit = getPageLayoutFit(document, layout);
      if (fit.fits) {
        fits.push(layout);
      } else {
        doesNotFit.push(layout);
        extras.set(layout.id, fit.extraPhotoCount);
      }
    }
    // Closest matches first: the fewest empty photo slots, then text slots for the page's text.
    // A page without photos would put text-only layouts first, so it ranks Zakka layouts and
    // small photo layouts ahead of them instead.
    const emptySlots = (layout: PageLayout) =>
      pageFit.photoCount === 0 && layout.photoSlotCount === 0
        ? Number.POSITIVE_INFINITY
        : layout.photoSlotCount - pageFit.photoCount;
    const zakkaFirst = (left: PageLayout, right: PageLayout) =>
      Number(right.source === "zakka") - Number(left.source === "zakka");
    const missingText = (layout: PageLayout) => Math.abs(layout.textSlotCount - pageFit.textCount);
    fits.sort((left, right) =>
      pageFit.photoCount === 0
        ? zakkaFirst(left, right) ||
          emptySlots(left) - emptySlots(right) ||
          missingText(left) - missingText(right)
        : emptySlots(left) - emptySlots(right) ||
          zakkaFirst(left, right) ||
          missingText(left) - missingText(right),
    );
    doesNotFit.sort(
      (left, right) =>
        right.photoSlotCount - left.photoSlotCount || missingText(left) - missingText(right),
    );
    return { fitting: fits, other: doesNotFit, extraPhotoCounts: extras, pageFit };
  }, [candidates, document]);

  const pageSummary =
    pageFit.photoCount === 0 && pageFit.textCount === 0
      ? "This page is empty, so the layout adds photo and text placeholders to fill in."
      : `This page has ${pluralize(pageFit.photoCount, "photo")} and ${pageFit.textCount} text ${
          pageFit.textCount === 1 ? "box" : "boxes"
        }. Layouts move them into place and add placeholders for empty spots.`;

  return (
    <AppModal title="Page layouts" onClose={onClose}>
      <div className="photo-picker-modal layout-picker-modal">
        <div className="photo-picker-toolbar layout-picker-toolbar">
          <p className="layout-picker-summary">{pageSummary}</p>
          <label className="photo-picker-sort" htmlFor="layout-picker-photos">
            <span>Photos</span>
            <select
              id="layout-picker-photos"
              value={photoFilter}
              onChange={(event) => setPhotoFilter(event.currentTarget.value as PhotoFilter)}
            >
              {(Object.keys(photoFilterLabels) as PhotoFilter[]).map((filter) => (
                <option key={filter} value={filter}>
                  {photoFilterLabels[filter]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="album-chip-bar layout-picker-categories">
          <div className="album-chip-bar-list" role="tablist" aria-label="Filter by layout style">
            {[{ id: "all" as const, label: "All layouts" }, ...pageLayoutCategories].map(
              ({ id, label }) => {
                const isSelected = categoryFilter === id;
                const count = id === "all" ? null : (categoryCounts.get(id) ?? 0);
                return (
                  <Button
                    key={id}
                    type="button"
                    appearance={isSelected ? "primary" : "subtle"}
                    className={`album-chip${isSelected ? " album-chip-selected" : ""}`}
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setCategoryFilter(id)}
                  >
                    <span className="album-chip-label">{label}</span>
                    {count === null ? null : (
                      <span className="album-chip-count" aria-hidden="true">
                        {count}
                      </span>
                    )}
                  </Button>
                );
              },
            )}
          </div>
        </div>
        <div className="layout-picker-sections">
          {pendingLayout ? (
            <div className="layout-picker-confirm" role="alert">
              <span>
                {pendingLayout.name} has room for {pluralize(pendingLayout.photoSlotCount, "photo")}
                . Applying it removes{" "}
                {pluralize(extraPhotoCounts.get(pendingLayout.id) ?? 0, "photo")} from this page.
              </span>
              <Button type="button" appearance="primary" onClick={() => applyLayout(pendingLayout)}>
                Apply and remove photos
              </Button>
              <Button type="button" onClick={() => setPendingLayout(null)}>
                Cancel
              </Button>
            </div>
          ) : null}
          {applyError ? (
            <p className="empty-state" role="alert">
              {applyError}
            </p>
          ) : null}
          {loadError ? (
            <p className="empty-state" role="alert">
              Could not load all layouts: {loadError}
            </p>
          ) : null}
          <section className="layout-picker-section" aria-label="Layouts that fit this page">
            <h3>
              Fits this page <span>{fitting.length}</span>
            </h3>
            {fitting.length > 0 ? (
              <LayoutGrid key={filterKey} canvas={canvas} layouts={fitting} onApply={applyLayout} />
            ) : (
              <p className="empty-state">
                {shutterflyLayouts || loadError
                  ? "No layouts with room for every photo match these filters."
                  : "Loading layouts"}
              </p>
            )}
          </section>
          {other.length > 0 ? (
            <section className="layout-picker-section" aria-label="Other layouts">
              <h3>
                Other layouts <span>{other.length}</span>
              </h3>
              <p className="layout-picker-section-note">
                These have fewer photo spots than this page has photos. Applying one removes the
                photos that don&apos;t fit from the page.
              </p>
              <LayoutGrid
                key={filterKey}
                canvas={canvas}
                extraPhotoCounts={extraPhotoCounts}
                layouts={other}
                onApply={confirmPhotoRemoval ? setPendingLayout : applyLayout}
              />
            </section>
          ) : null}
        </div>
      </div>
    </AppModal>
  );
}

const blankLayout: PageLayout = {
  id: "blank",
  name: "Blank",
  source: "zakka",
  orientation: "any",
  slots: [],
  photoSlotCount: 0,
  textSlotCount: 0,
};
