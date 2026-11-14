// Imports Shutterfly's single-page photo book layouts and converts them into Zakka's own page
// layout format (normalized slot rectangles). Only the converted geometry is checked in; the raw
// catalog responses are never stored.
//
// Usage: SHUTTERFLY_API_KEY=... node scripts/import-shutterfly-layouts.mjs [--from 78000] [--to 82000]
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv, env, exit } from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(packageRoot, "src/page-layouts-shutterfly.ts");
const catalogUrl =
  "https://catalog-api3.shutterfly.com/catalogdesign/v1/design-asset-by-ids?context=/sfly/shutterfly/shutterfly-us/default&channel=web";
// Inside-page layout pools; other book sizes reuse the same designs at the same aspect ratios.
const pagePools = [
  /^10x10_books-pool-b_.*_page$/,
  /^8x8_books-pool-c_.*_page$/,
  /^8x11_books-pool-[bc]_.*_page$/,
  /^11x8_books-pool-b_.*_page$/,
];
const units = 10000;
const dedupeUnits = 50;

const readArgument = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? Number(argv[index + 1]) : fallback;
};

const apiKey = env.SHUTTERFLY_API_KEY;
if (!apiKey) {
  console.error("Set SHUTTERFLY_API_KEY to import Shutterfly layouts.");
  exit(1);
}

const firstId = readArgument("from", 78000);
const lastId = readArgument("to", 82000);

const fetchJson = async (url, init, attempt = 0) => {
  const response = await fetch(url, init);
  if (response.ok) return response.json();
  if (attempt < 3 && response.status >= 500) return fetchJson(url, init, attempt + 1);
  throw new Error(`${response.status} ${response.statusText} for ${url}`);
};

const inBatches = async (items, size, run) => {
  const results = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...(await Promise.all(items.slice(index, index + size).map(run))));
  }
  return results;
};

const fetchLayoutAssets = async () => {
  const starts = [];
  for (let start = firstId; start < lastId; start += 100) starts.push(start);

  const pages = await inBatches(starts, 8, async (start) => {
    const ids = Array.from(
      { length: Math.min(100, lastId - start) },
      (_, index) => `DA_${start + index}`,
    );
    const body = await fetchJson(catalogUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ designAssetIds: ids, legacyIds: [], legacyNames: [] }),
    });
    return body.entities?.designAssets ?? [];
  });

  return pages
    .flat()
    .filter(
      (asset) =>
        asset.assetType === "layout" &&
        asset.files?.SURFACE_SPEC?.location &&
        pagePools.some((pool) => pool.test(asset.name)),
    );
};

const toUnits = (value, size) => Math.max(0, Math.min(units, Math.round((value / size) * units)));

const alignFromAnchor = (anchor) => {
  const column = (Number(anchor) - 1) % 3;
  return column === 1 ? "c" : column === 2 ? "r" : "l";
};

const convertSpec = (spec) => {
  const page = spec.designSurfaceData?.pageDetails;
  const items = spec.designSurfaceData?.layeredItems ?? [];
  if (!page?.width || !page?.height) return null;

  const aspect = page.width / page.height;
  const orientation = aspect > 1.1 ? "landscape" : aspect < 0.9 ? "portrait" : "square";
  const slots = items.flatMap((item) => {
    const container = item.container;
    if (!container || (item.type !== "photo" && item.type !== "text")) return [];

    const left = toUnits(container.x, page.width);
    const top = toUnits(container.y, page.height);
    // Edge-to-edge photos extend into the print bleed; clamp them to the trimmed page.
    const values = [
      left,
      top,
      toUnits(container.x + container.w, page.width) - left,
      toUnits(container.y + container.h, page.height) - top,
    ];
    const rotation = Math.round(Number(container.rot) || 0);

    if (item.type === "photo") {
      return [{ kind: "p", values, rotation }];
    }

    const role = item.content?.textClass === "title" ? "title" : "body";
    const align = alignFromAnchor(item.content?.userData?.alignmentAnchor ?? 1);
    return [{ kind: "t", values, rotation, role, align }];
  });

  if (slots.length === 0) return null;

  return { orientation, slots };
};

const encodeSlot = (slot) => {
  const geometry = [...slot.values, ...(slot.rotation ? [slot.rotation] : [])].join(",");
  return slot.kind === "p"
    ? `p:${geometry}`
    : `t:${geometry}:${slot.role === "title" ? "T" : "B"}${slot.align}`;
};

const signature = (layout) =>
  `${layout.orientation}|${layout.slots
    .map(
      (slot) =>
        `${slot.kind}${slot.values.map((value) => Math.round(value / dedupeUnits)).join(",")}`,
    )
    .sort()
    .join(";")}`;

const readingOrder = (left, right) =>
  left.values[1] - right.values[1] || left.values[0] - right.values[0];

const assets = await fetchLayoutAssets();
console.log(`Found ${assets.length} Shutterfly page layouts.`);

const converted = await inBatches(assets, 12, async (asset) => {
  const spec = await fetchJson(asset.files.SURFACE_SPEC.location);
  const layout = convertSpec(spec);
  return layout ? { id: asset.id, ...layout } : null;
});

const seen = new Set();
const layouts = converted
  .filter((layout) => layout !== null)
  .map((layout) => ({
    ...layout,
    slots: [...layout.slots].sort(
      (left, right) => left.kind.localeCompare(right.kind) || readingOrder(left, right),
    ),
  }))
  .sort(
    (left, right) =>
      left.orientation.localeCompare(right.orientation) ||
      left.slots.filter((slot) => slot.kind === "p").length -
        right.slots.filter((slot) => slot.kind === "p").length ||
      left.slots.length - right.slots.length ||
      Number(left.id.slice(3)) - Number(right.id.slice(3)),
  )
  .filter((layout) => {
    const key = signature(layout);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

const lines = layouts.map(
  (layout) =>
    `  [${JSON.stringify(layout.id)}, ${JSON.stringify(layout.orientation)}, ${JSON.stringify(
      layout.slots.map(encodeSlot).join(" "),
    )}],`,
);

writeFileSync(
  outputPath,
  `// Generated by scripts/import-shutterfly-layouts.mjs from Shutterfly's photo book page layouts.
// Do not edit by hand; re-run the script to refresh. Each entry is [source id, orientation, slots].
// Slots are space separated: "p:x,y,w,h[,rotation]" for photos and "t:x,y,w,h[,rotation]:<role><align>"
// for text, with geometry in 1/${units} of the page and role T(itle)/B(ody), align l/c/r.
import type { EncodedPageLayout } from "./page-layouts.js";

export const shutterflyPageLayouts: readonly EncodedPageLayout[] = [
${lines.join("\n")}
];
`,
);

const counts = Object.groupBy(layouts, (layout) => layout.orientation);
console.log(
  `Wrote ${layouts.length} layouts (${Object.entries(counts)
    .map(([orientation, entries]) => `${entries.length} ${orientation}`)
    .join(", ")}) to ${outputPath}.`,
);
