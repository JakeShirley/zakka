import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeFixedClock } from "@zakka/test-utils";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { createMapTileSource, MapTileRangeError } from "./map-tiles.js";
import { createDatabaseConnection, type DatabaseConnection } from "./persistence/database.js";
import { runMigrations } from "./persistence/migrations.js";
import { createPageDocumentStore } from "./persistence/page-documents.js";
import { createRepositories } from "./persistence/repositories.js";

const connections: DatabaseConnection[] = [];
const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "zakka-map-tiles-"));

  tempDirs.push(dir);

  return dir;
};

const createTilePng = (): Promise<Buffer> =>
  sharp({
    create: { background: { alpha: 1, b: 40, g: 200, r: 30 }, channels: 4, height: 8, width: 8 },
  })
    .png()
    .toBuffer();

const createTileFetch = (body: Buffer | string, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(new Uint8Array(Buffer.from(body)), { status }));

afterEach(async () => {
  for (const connection of connections.splice(0)) connection.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("map tile source", () => {
  it("fetches each tile once, sharing in-flight requests and the disk cache", async () => {
    const cacheDir = await createTempDir();
    const png = await createTilePng();
    const fetchTile = createTileFetch(png);
    const source = createMapTileSource({ cacheDir, fetch: fetchTile, userAgent: "zakka-test" });
    const tile = { provider: "osm", x: 2, y: 1, z: 2 } as const;

    const [first, second] = await Promise.all([source.getTile(tile), source.getTile(tile)]);
    const reloaded = await createMapTileSource({ cacheDir, fetch: fetchTile }).getTile(tile);

    expect(first).toEqual({ buffer: png, mimeType: "image/png" });
    expect(second).toEqual(first);
    expect(reloaded).toEqual(first);
    expect(fetchTile).toHaveBeenCalledTimes(1);
    expect(fetchTile.mock.calls[0]?.[0]).toBe("https://tile.openstreetmap.org/2/2/1.png");
    expect(new Headers(fetchTile.mock.calls[0]?.[1]?.headers).get("user-agent")).toBe("zakka-test");
    expect(await readdir(join(cacheDir, "osm", "2", "2"))).toEqual(["1"]);
  });

  it("rejects tiles outside the grid and ignores non-image responses", async () => {
    const cacheDir = await createTempDir();
    const source = createMapTileSource({
      cacheDir,
      fetch: createTileFetch("<html>rate limited</html>"),
    });

    await expect(source.getTile({ provider: "osm", x: 4, y: 0, z: 2 })).rejects.toBeInstanceOf(
      MapTileRangeError,
    );
    await expect(source.getTile({ provider: "esriTopo", x: 0, y: 0, z: 1 })).resolves.toBeNull();
    await expect(
      createMapTileSource({ cacheDir, fetch: createTileFetch("", 503) }).getTile({
        provider: "osm",
        x: 0,
        y: 0,
        z: 0,
      }),
    ).resolves.toBeNull();
  });
});

describe("map tile route", () => {
  const createTileApp = async (fetchTile: typeof fetch) => {
    const connection = createDatabaseConnection({ databasePath: ":memory:" });
    const rootDir = await createTempDir();

    connections.push(connection);
    runMigrations(connection.sqlite);

    const clock = makeFixedClock(new Date("2026-05-17T12:00:00.000Z"));

    return createApp({
      clock,
      mapTiles: createMapTileSource({ cacheDir: join(rootDir, "map-tiles"), fetch: fetchTile }),
      repositories: createRepositories(connection.db, {
        clock,
        pageDocuments: createPageDocumentStore({ rootDir }),
      }),
    });
  };

  const register = async (app: ReturnType<typeof createApp>): Promise<string> => {
    const response = await app.request("/api/v1/auth/register", {
      body: JSON.stringify({
        displayName: "Map Maker",
        email: "maps@example.com",
        password: "correct horse battery staple",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);

    return response.headers.get("set-cookie")?.split(";")[0] ?? "";
  };

  it("serves cached provider tiles to signed-in accounts", async () => {
    const png = await createTilePng();
    const app = await createTileApp(createTileFetch(png));

    expect((await app.request("/api/v1/map-tiles/osm/3/4/2")).status).toBe(401);

    const cookie = await register(app);
    const response = await app.request("/api/v1/map-tiles/osm/3/4/2", { headers: { cookie } });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("max-age=");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);

    expect((await app.request("/api/v1/map-tiles/osm/3/8/2", { headers: { cookie } })).status).toBe(
      400,
    );
    expect(
      (await app.request("/api/v1/map-tiles/google/3/4/2", { headers: { cookie } })).status,
    ).toBe(400);
  });

  it("reports provider failures as a bad gateway", async () => {
    const app = await createTileApp(createTileFetch("", 429));
    const cookie = await register(app);
    const response = await app.request("/api/v1/map-tiles/esriTopo/3/4/2", {
      headers: { cookie },
    });

    expect(response.status).toBe(502);
  });
});
