import { isAllowedShutterflyDownloadUrl } from "./client.js";
import { mapWithConcurrency, safeFileName } from "./util.js";

export type ShutterflyProjectPage = {
  /** Path relative to the project folder, such as `pages/inside-01.svg`. */
  file: string;
  category: string | null;
  surfaceNumber: unknown;
  surface: unknown;
  /** Print height of the surface in pixels, which renders the page at full size. */
  height: number;
};

// Shutterfly's photo renderer only accepts a few sizes and rejects everything else with a 400.
const photoRenderSizes = [1600, 2000, 3000, 3600];
const fallbackPageHeight = 3000;
const publicDesignHost = "https://sfly3-catalog-design.sf-cdn.com/";
const resourceConcurrency = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Lists every surface in a raw Shutterfly project, in the order the builder shows them. */
export const listShutterflyProjectPages = (project: unknown): ShutterflyProjectPage[] => {
  const categories = isRecord(project) ? project.surfaceCategories : null;

  if (!Array.isArray(categories)) {
    return [];
  }

  const pages: ShutterflyProjectPage[] = [];

  categories.forEach((category, categoryIndex) => {
    if (!isRecord(category) || !Array.isArray(category.surfaces)) {
      return;
    }

    const name = typeof category.categoryName === "string" ? category.categoryName : null;
    const prefix = safeFileName(name, `surfaces-${categoryIndex + 1}`);
    const digits = Math.max(2, String(category.surfaces.length).length);

    category.surfaces.forEach((surface, index) => {
      if (!isRecord(surface)) {
        return;
      }

      const pageDetails = isRecord(surface.surfaceData) ? surface.surfaceData.pageDetails : null;
      const height = isRecord(pageDetails) ? Number(pageDetails.height) : Number.NaN;

      pages.push({
        file: `pages/${prefix}-${String(index + 1).padStart(digits, "0")}.svg`,
        category: name,
        surfaceNumber: surface.surfaceNumber ?? null,
        surface,
        height: Number.isFinite(height) && height > 0 ? height : fallbackPageHeight,
      });
    });
  });

  return pages;
};

const decodeXmlEntities = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
    const lower = name.toLowerCase();

    if (lower.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    }

    if (lower.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    }

    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[lower] ?? entity;
  });

const readNumberAttribute = (tag: string, name: string): number | null => {
  const match = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)`).exec(tag);
  const value = match ? Number(match[1]) : Number.NaN;

  return Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * Shutterfly renders page photos at 1600px, which looks soft on a full-size page. Asks for a size
 * that matches how large the photo is placed, without ever going below Shutterfly's choice.
 */
const upsizePhotoUrl = (url: string, tag: string): string => {
  const current = /([?&]rendersize=fit)(\d+)x(\d+)/.exec(url);

  if (!current || !/^https:\/\/uniim[\w-]*\.shutterfly\.com\//.test(url)) {
    return url;
  }

  const placed = Math.max(
    readNumberAttribute(tag, "width") ?? 0,
    readNumberAttribute(tag, "height") ?? 0,
  );
  const shutterflySize = Math.max(Number(current[2]), Number(current[3]));

  if (placed <= shutterflySize) {
    return url;
  }

  const size =
    photoRenderSizes.find((candidate) => candidate >= placed) ??
    (photoRenderSizes.at(-1) as number);

  return size > shutterflySize ? url.replace(current[0], `${current[1]}${size}x${size}`) : url;
};

/**
 * Some rendered pages point their fonts at a Shutterfly-internal host that can't be reached from
 * outside. The project's design assets list the same files on Shutterfly's public CDN, under an
 * extra leading folder, so this maps each internal URL to its public copy.
 */
export const createShutterflyDesignUrlResolver = (designAssets: unknown) => {
  const publicUrls = new Map<string, string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      if (value.startsWith(publicDesignHost)) {
        const rest = value.slice(publicDesignHost.length);
        const slash = rest.indexOf("/");

        if (slash > 0) {
          publicUrls.set(rest.slice(slash), value);
        }
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (isRecord(value)) {
      Object.values(value).forEach(visit);
    }
  };

  visit(designAssets);

  return (url: string): string => {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      return url;
    }

    if (!parsed.hostname.endsWith(".internal.shutterfly.com")) {
      return url;
    }

    return publicUrls.get(`${parsed.pathname}${parsed.search}`) ?? url;
  };
};

// Shutterfly repeats the same @font-face <style> next to every text element, which embeds each
// font hundreds of times on a calendar page once inlined. Styles apply document-wide, so one copy
// is enough.
const removeDuplicateStyles = (svg: string) => {
  const seen = new Set<string>();

  return svg.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, (style) => {
    if (seen.has(style)) {
      return "";
    }

    seen.add(style);

    return style;
  });
};

// The renderer places the page inside a product mockup (spiral binding, wall hanger, ...) whose
// slot clips most of it. The page itself is the first <svg> in the "Surface" group, drawn at print
// size with its own styles and defs, so it is kept on its own.
const extractPageSvg = (svg: string) => {
  const surface = svg.search(/<g\s[^>]*\bid\s*=\s*["']Surface["']/);

  if (surface < 0) {
    return svg;
  }

  const tags = /<(\/?)svg\b[^>]*?(\/?)>/g;
  let start = -1;
  let depth = 0;

  tags.lastIndex = surface;

  for (let match = tags.exec(svg); match; match = tags.exec(svg)) {
    if (start < 0) {
      if (match[1]) {
        return svg;
      }

      start = match.index;
    }

    if (match[1]) {
      depth -= 1;
    } else if (!match[2]) {
      depth += 1;
    }

    if (depth === 0) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n${svg.slice(start, tags.lastIndex)}\n`;
    }
  }

  return svg;
};

const sniffMimeType = (data: Buffer): string => {
  const ascii = data.subarray(0, 12).toString("latin1");

  if (data[0] === 0xff && data[1] === 0xd8) return "image/jpeg";
  if (ascii.startsWith("\x89PNG")) return "image/png";
  if (ascii.startsWith("GIF8")) return "image/gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  if (ascii.startsWith("wOFF")) return "font/woff";
  if (ascii.startsWith("wOF2")) return "font/woff2";
  if (ascii.startsWith("OTTO")) return "font/otf";
  if (ascii.startsWith("\x00\x01\x00\x00") || ascii.startsWith("true")) return "font/ttf";
  if (/^\s*(<\?xml|<svg)/i.test(data.subarray(0, 256).toString("utf8"))) return "image/svg+xml";

  return "application/octet-stream";
};

const tagPattern = /<[A-Za-z][^<>]*>/g;
const hrefPattern = /(\s(?:xlink:)?href\s*=\s*)(["'])(https:[^"']*)\2/g;
const cssUrlPattern = /url\(\s*(["']?)(https:[^"')\s]+)\1\s*\)/g;

/**
 * Replaces every Shutterfly-hosted photo, artwork, and font in a rendered page with an inline data
 * URI so the SVG opens offline and keeps working after Shutterfly removes the originals. References
 * that fail to download are left pointing at Shutterfly and reported in `failures`.
 * `resolveUrl` can swap a reference for another copy of the same file before it is downloaded.
 */
export const inlineShutterflySvgResources = async (
  rawSvg: string,
  load: (url: string) => Promise<Buffer>,
  signal?: AbortSignal,
  resolveUrl: (url: string) => string = (url) => url,
): Promise<{ svg: string; failures: { url: string; error: unknown }[] }> => {
  const svg = removeDuplicateStyles(extractPageSvg(rawSvg));
  const tagUrls = new Map<string, string>();
  const cssUrls = new Map<string, string>();
  const urls = new Set<string>();

  for (const tag of svg.match(tagPattern) ?? []) {
    for (const match of tag.matchAll(hrefPattern)) {
      const url = resolveUrl(upsizePhotoUrl(decodeXmlEntities(match[3] as string), tag));

      tagUrls.set(`${tag}\u0000${match[3]}`, url);
      urls.add(url);
    }
  }

  for (const match of svg.matchAll(cssUrlPattern)) {
    const url = resolveUrl(decodeXmlEntities(match[2] as string));

    cssUrls.set(match[2] as string, url);
    urls.add(url);
  }

  const dataUris = new Map<string, string>();
  const failures: { url: string; error: unknown }[] = [];

  await mapWithConcurrency(
    [...urls].filter((url) => isAllowedShutterflyDownloadUrl(url)),
    resourceConcurrency,
    async (url) => {
      signal?.throwIfAborted();

      try {
        const data = await load(url);

        dataUris.set(url, `data:${sniffMimeType(data)};base64,${data.toString("base64")}`);
      } catch (error) {
        signal?.throwIfAborted();
        failures.push({ url, error });
      }
    },
  );

  const inlined = svg
    .replace(tagPattern, (tag) =>
      tag.replace(hrefPattern, (attribute, prefix: string, quote: string, value: string) => {
        const dataUri = dataUris.get(tagUrls.get(`${tag}\u0000${value}`) ?? "");

        return dataUri ? `${prefix}${quote}${dataUri}${quote}` : attribute;
      }),
    )
    .replace(cssUrlPattern, (reference, _quote: string, value: string) => {
      const dataUri = dataUris.get(cssUrls.get(value) ?? "");

      return dataUri ? `url("${dataUri}")` : reference;
    });

  return { svg: inlined, failures };
};
