import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { getMapTileUrl, type MapTile, mapTileProviders } from "@zakka/editor-core";

export type MapTileImage = { buffer: Buffer; mimeType: "image/jpeg" | "image/png" };

export type MapTileSource = {
  /**
   * Aborting `signal` resolves this request to null. The upstream fetch, shared with concurrent
   * requests for the same tile, is dropped from the queue or cancelled once every caller has
   * aborted.
   */
  getTile: (tile: MapTile, options?: { signal?: AbortSignal }) => Promise<MapTileImage | null>;
};

export class MapTileRangeError extends Error {
  constructor(tile: MapTile) {
    super(`Map tile ${tile.provider}/${tile.z}/${tile.x}/${tile.y} is outside the tile grid`);
    this.name = "MapTileRangeError";
  }
}

const defaultUserAgent = "Zakka/1.0 (self-hosted photo book editor; map tile cache)";
const fetchTimeoutMs = 15_000;
// Tile providers ask bulk clients to keep parallel connections low.
const maxConcurrentUpstreamFetches = 4;

const sniffMimeType = (buffer: Buffer): MapTileImage["mimeType"] | null => {
  if (buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";

  return null;
};

export const isMapTileInRange = (tile: MapTile): boolean => {
  const { maxZoom } = mapTileProviders[tile.provider];
  const size = 2 ** tile.z;

  return (
    Number.isInteger(tile.z) &&
    Number.isInteger(tile.x) &&
    Number.isInteger(tile.y) &&
    tile.z >= 0 &&
    tile.z <= maxZoom &&
    tile.x >= 0 &&
    tile.x < size &&
    tile.y >= 0 &&
    tile.y < size
  );
};

/** One upstream load shared by every concurrent request for the same tile. */
type PendingTile = {
  /** Callers still waiting; callers without an abort signal keep the load alive. */
  callers: number;
  controller: AbortController;
  request: Promise<MapTileImage | null>;
};

/**
 * Fetches raster tiles from their provider and keeps them on disk. Tile providers ask
 * clients to cache aggressively and identify themselves, and exports need the same bytes
 * the editor showed, so tiles are kept until the cache directory is cleared.
 */
export const createMapTileSource = (options: {
  cacheDir: string;
  fetch?: typeof fetch;
  userAgent?: string;
}): MapTileSource => {
  const cacheDir = resolve(options.cacheDir);
  const fetchTile = options.fetch ?? globalThis.fetch;
  const pending = new Map<string, PendingTile>();
  const waiting: Array<() => void> = [];
  let activeFetches = 0;

  /** Resolves false, without taking a slot, if `signal` aborts first. */
  const acquireUpstreamSlot = (signal: AbortSignal): Promise<boolean> => {
    if (signal.aborted) return Promise.resolve(false);

    if (activeFetches < maxConcurrentUpstreamFetches) {
      activeFetches += 1;
      return Promise.resolve(true);
    }

    return new Promise((resolveSlot) => {
      const onAbort = () => {
        const index = waiting.indexOf(grant);

        if (index >= 0) waiting.splice(index, 1);
        resolveSlot(false);
      };
      const grant = () => {
        signal.removeEventListener("abort", onAbort);
        resolveSlot(true);
      };

      waiting.push(grant);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  };

  const releaseUpstreamSlot = () => {
    // A finishing fetch hands its slot straight to the next waiter.
    const next = waiting.shift();

    if (next) next();
    else activeFetches -= 1;
  };

  const load = async (tile: MapTile, signal: AbortSignal): Promise<MapTileImage | null> => {
    const cachePath = join(cacheDir, tile.provider, String(tile.z), String(tile.x), `${tile.y}`);

    try {
      const cached = await readFile(cachePath);
      const mimeType = sniffMimeType(cached);

      if (mimeType) return { buffer: cached, mimeType };
    } catch {
      // Not cached yet.
    }

    if (!(await acquireUpstreamSlot(signal))) return null;

    let buffer: Buffer | null;

    try {
      const response = await fetchTile(getMapTileUrl(tile), {
        headers: { "user-agent": options.userAgent ?? defaultUserAgent },
        signal: AbortSignal.any([AbortSignal.timeout(fetchTimeoutMs), signal]),
      });

      buffer = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
    } finally {
      releaseUpstreamSlot();
    }

    if (!buffer) return null;

    const mimeType = sniffMimeType(buffer);

    if (!mimeType) return null;

    const temporaryPath = `${cachePath}.${crypto.randomUUID()}.tmp`;

    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(temporaryPath, buffer);
    await rename(temporaryPath, cachePath);

    return { buffer, mimeType };
  };

  return {
    getTile: (tile, requestOptions) => {
      if (!isMapTileInRange(tile)) {
        return Promise.reject(new MapTileRangeError(tile));
      }

      const signal = requestOptions?.signal;

      if (signal?.aborted) return Promise.resolve(null);

      const key = `${tile.provider}/${tile.z}/${tile.x}/${tile.y}`;
      let shared = pending.get(key);

      if (!shared) {
        const controller = new AbortController();
        const created: PendingTile = {
          callers: 0,
          controller,
          request: load(tile, controller.signal).finally(() => {
            if (pending.get(key) === created) pending.delete(key);
          }),
        };

        pending.set(key, created);
        shared = created;
      }

      const entry = shared;

      entry.callers += 1;

      if (!signal) return entry.request;

      return new Promise((resolveTile, rejectTile) => {
        const onAbort = () => {
          entry.callers -= 1;

          // Cancel the upstream fetch only once no caller still needs the tile.
          if (entry.callers === 0) {
            if (pending.get(key) === entry) pending.delete(key);
            entry.controller.abort(signal.reason);
          }

          resolveTile(null);
        };

        signal.addEventListener("abort", onAbort, { once: true });
        entry.request
          .then(resolveTile, rejectTile)
          .finally(() => signal.removeEventListener("abort", onAbort));
      });
    },
  };
};
