import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";

import {
  shutterflyArchiveListResponseSchema,
  shutterflyArchiveResponseSchema,
} from "@zakka/api-contract";
import { makeFixedClock } from "@zakka/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { createCredentialCipher } from "./integrations/credential-cipher.js";
import { shutterflyProjectKind } from "./integrations/shutterfly/archive.js";
import {
  parseShutterflyAlbumMomentIds,
  readContentDispositionFileName,
} from "./integrations/shutterfly/client.js";
import { createShutterflyIntegration } from "./integrations/shutterfly/service.js";
import { createDatabaseConnection, type DatabaseConnection } from "./persistence/database.js";
import { runMigrations } from "./persistence/migrations.js";
import { createPageDocumentStore } from "./persistence/page-documents.js";
import { createRepositories } from "./persistence/repositories.js";
import { createDiskStorage } from "./storage/disk.js";
import { collectZipEntries, createZipStream, zipLength } from "./zip-stream.js";

const fixedDate = new Date("2026-05-17T12:00:00.000Z");
const validRefreshToken = "valid-refresh-token.abcdefghijklmnopqrstuvwxyz";
const connections: DatabaseConnection[] = [];
const tempDirs: string[] = [];
const fixturePath = new URL(
  "./integrations/shutterfly/__fixtures__/layflat-project.json",
  import.meta.url,
);

afterEach(async () => {
  for (const connection of connections.splice(0)) {
    connection.close();
  }

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "zakka-shutterfly-archive-"));

  tempDirs.push(dir);

  return dir;
};

/** Reads a stored (uncompressed) ZIP through its central directory, checking every CRC. */
const readZip = (zip: Buffer): Map<string, Buffer> => {
  const endOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entryCount = zip.readUInt16LE(endOffset + 10);
  let position = zip.readUInt32LE(endOffset + 16);
  const files = new Map<string, Buffer>();

  for (let index = 0; index < entryCount; index += 1) {
    expect(zip.readUInt32LE(position)).toBe(0x02014b50);

    const crc = zip.readUInt32LE(position + 16);
    const size = zip.readUInt32LE(position + 24);
    const nameLength = zip.readUInt16LE(position + 28);
    const extraLength = zip.readUInt16LE(position + 30);
    const commentLength = zip.readUInt16LE(position + 32);
    const localOffset = zip.readUInt32LE(position + 42);
    const name = zip.toString("utf8", position + 46, position + 46 + nameLength);
    const dataStart =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const data = zip.subarray(dataStart, dataStart + size);

    expect(zip.readUInt32LE(localOffset)).toBe(0x04034b50);
    expect(crc32(data)).toBe(crc);
    files.set(name, data);
    position += 46 + nameLength + extraLength + commentLength;
  }

  return files;
};

const streamToBuffer = async (stream: AsyncIterable<unknown>) => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks);
};

const fakeIdToken = () =>
  [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sfly_uid: "012345678901",
        sfly3_uid: "777",
        email: "reader@example.com",
        exp: Math.floor(fixedDate.getTime() / 1000) + 82_800,
        token_use: "id",
      }),
    ).toString("base64url"),
    "signature",
  ].join(".");

const albumMoments = (...ids: string[]) =>
  ids.map((id) => `${"x".repeat(9)}${id.padStart(16, "0")}${"y".repeat(252)}`).join("");

const rpc = (payload: unknown) => Response.json({ result: { success: true, payload } });

const createFakeShutterfly = async () => {
  const fixtureText = await readFile(fixturePath, "utf8");
  const fixture = JSON.parse(fixtureText);
  const fake = {
    downloads: [] as string[],
    failingMoments: new Set<string>(["103"]),
    expired: false,
    pageRenders: [] as { height: string | null; surfaceNumber: unknown; apiKey: string | null }[],
    photoRenders: [] as string[],
    fetch: (async () => new Response(null, { status: 500 })) as typeof fetch,
  };

  fake.fetch = async (input, init) => {
    const url = String(input);

    if (url.startsWith("https://accounts.shutterfly.com/sso/v2/tokens")) {
      if (fake.expired) {
        return new Response(null, { status: 204 });
      }

      return Response.json([
        {
          name: "CognitoIdentityServiceProvider.client.zakka.refreshToken",
          value: validRefreshToken,
        },
        { name: "CognitoIdentityServiceProvider.client.zakka.idToken", value: fakeIdToken() },
      ]);
    }

    if (fake.expired) {
      return new Response(null, { status: 401 });
    }

    if (url.startsWith("https://commerce-api3.shutterfly.com/commerce/v1/order?")) {
      return url.includes("page=2")
        ? Response.json({ resources: [{ orderId: "order-2" }] })
        : Response.json({
            resources: [{ orderId: "order-1" }],
            nextRef: "https://commerce-api3.shutterfly.com/commerce/v1/order?page=2",
          });
    }

    if (url.startsWith("https://commerce-api3.shutterfly.com/commerce/v1/legacy/orders?")) {
      return Response.json({ resources: [{ orderId: "legacy-1" }] });
    }

    if (url.startsWith("https://projects-api3.shutterfly.com/projects/v2/project?")) {
      return Response.json({
        resources: [
          { resource: { ...fixture, photoWell: [], surfaceCategories: [] } },
          {
            resource: {
              _id: "2000000000002",
              projectName: "Holiday card",
              productCategory: "Cards",
            },
          },
        ],
      });
    }

    if (url.startsWith("https://projects-api3.shutterfly.com/projects/v2/project/1000000000001?")) {
      return new Response(fixtureText, { headers: { "content-type": "application/json" } });
    }

    if (url.startsWith("https://projects-api3.shutterfly.com/projects/v2/project/2000000000002?")) {
      return Response.json({ _id: "2000000000002", projectName: "Holiday card" });
    }

    if (url.startsWith("https://mediaag.shutterfly.com/services/user-media/v3/012345678901/")) {
      return Response.json({
        "012345678901": [
          {
            id: "9000000000000001",
            fileName: "beach.jpg",
            url: "https://uniim-cp.shutterfly.com/procsimple?imageID=img-cover",
          },
        ],
      });
    }

    if (url.startsWith("https://uniim-cp.shutterfly.com/")) {
      fake.photoRenders.push(url);

      return new Response("rendered-photo", { headers: { "content-type": "image/jpeg" } });
    }

    if (
      url.startsWith(
        "https://rendering-api3.shutterfly.com/rendering/renderer/v1/surfacesvg/preview?",
      )
    ) {
      const [surface] = JSON.parse(String(init?.body)).surfaces;

      fake.pageRenders.push({
        height: new URL(url).searchParams.get("height"),
        surfaceNumber: surface.surfaceNumber,
        apiKey: new Headers(init?.headers).get("x-api-key"),
      });

      const fontStyle = `<style>@font-face { font-family: "Page"; src: url("https://sfly3-design-portal.internal.shutterfly.com/704/fonts/page.woff?_t=1") format("woff"); }</style>`;

      const mockup = `<image width="1401" height="1343" xlink:href="https://sfly3-catalog-stepassets.shutterfly.com/mockup.png"/>`;

      return new Response(
        [
          `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3647 3499"><g transform="scale(2.6)">`,
          `<svg viewBox="0 0 1401 1343"><g id="Underlay">${mockup}</g>`,
          `<g id="Surface"><g clip-path="url(#slot)"><g transform="translate(52.4, 996.1) scale(0.38)">`,
          `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="2385" height="2910" viewBox="0 0 2385 2910">`,
          fontStyle,
          `<image width="2385" height="1200" xlink:href="https://uniim-cp.shutterfly.com/procsimple?imageID=page&amp;rendersize=fit1600x1600"/>`,
          fontStyle,
          `<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`,
          `<image href="https://example.com/elsewhere.png"/>`,
          `</svg>`,
          `</g></g></g><g id="ClipMask"><clipPath id="slot"><path d="M0,0h1401v1343H0z"/></clipPath></g>`,
          `<g id="Overlay">${mockup}</g></svg></g></svg>`,
        ].join(""),
        { headers: { "content-type": "application/xml" } },
      );
    }

    if (url.startsWith("https://sfly3-catalog-design.sf-cdn.com/externalabc/704/fonts/page.woff")) {
      return new Response("wOFF-font", { headers: { "content-type": "font/woff" } });
    }

    if (
      url.startsWith("https://catalog-api3.shutterfly.com/catalogdesign/v1/design-asset-by-ids")
    ) {
      return Response.json({
        entities: {
          designAssets: [
            {
              id: "DA_46646",
              name: "Helvetica Neue",
              assetType: "font",
              files: {
                WOFF: {
                  location:
                    "https://sfly3-catalog-design.sf-cdn.com/externalabc/704/fonts/page.woff?_t=1",
                  fileType: "WOFF",
                },
              },
            },
            {
              id: "DA_22741",
              name: "round-frame",
              assetType: "embellishment",
              files: { PRINT_RES: { location: "/internal/DA_22741.svg", fileType: "SVG" } },
            },
          ],
        },
      });
    }

    if (url.startsWith("https://sfly3-catalog-design.sf-cdn.com/internal/DA_22741.svg")) {
      return new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } });
    }

    if (url.startsWith("https://photos-api3.shutterfly.com/photos/json?method=searchMoments")) {
      return rpc({ moments: ["101", "102", "103"] });
    }

    if (url.startsWith("https://cmd.thislife.com/json?method=album.getAlbums")) {
      return rpc([
        [{ story: { uid: "a1", name: "Summer" } }],
        [{ story: { uid: "a2", name: "From Grandma" } }],
      ]);
    }

    if (url.startsWith("https://cmd.thislife.com/json?method=album.getAlbum")) {
      const albumId = JSON.parse(String(init?.body)).params[1];

      return albumId === "a1"
        ? rpc({ uid: "a1", name: "Summer", moments: albumMoments("102", "104") })
        : rpc({ uid: "a2", name: "From Grandma", moments: "" });
    }

    if (url.startsWith("https://io.thislife.com/download?")) {
      const momentId = new URL(url).searchParams.get("momentId") ?? "";

      fake.downloads.push(momentId);

      if (fake.failingMoments.has(momentId)) {
        return new Response("unavailable", { status: 500 });
      }

      if (momentId === "104") {
        return new Response("video-104", { headers: { "content-type": "video/mp4" } });
      }

      return new Response(`photo-${momentId}`, {
        headers: {
          "content-type": "image/jpeg",
          "content-disposition": `attachment; filename="IMG_0001.jpg"`,
        },
      });
    }

    return new Response(null, { status: 404 });
  };

  return fake;
};

const createTestApp = async () => {
  const connection = createDatabaseConnection({ databasePath: ":memory:" });
  const rootDir = await createTempDir();
  const storage = createDiskStorage({ rootDir });

  connections.push(connection);
  runMigrations(connection.sqlite);
  await storage.ensureReady();

  const repositories = createRepositories(connection.db, {
    clock: makeFixedClock(fixedDate),
    pageDocuments: createPageDocumentStore({ rootDir }),
  });
  const fake = await createFakeShutterfly();
  const archiveDir = join(rootDir, "shutterfly-archives");
  const app = createApp({
    clock: makeFixedClock(fixedDate),
    repositories,
    storage,
    shutterfly: createShutterflyIntegration({
      apiKey: "test-shutterfly-api-key",
      cipher: createCredentialCipher(randomBytes(32)),
      clock: () => fixedDate,
      fetch: (input, init) => fake.fetch(input, init),
      repositories,
      storage,
    }),
    shutterflyArchiveDir: archiveDir,
  });
  const registration = await app.request("/api/v1/auth/register", {
    body: JSON.stringify({
      displayName: "Maker",
      email: "maker@example.com",
      password: "correct horse battery staple",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookie = registration.headers.get("set-cookie")?.split(";")[0] ?? "";

  return { app, archiveDir, cookie, fake };
};

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const connect = async ({ app, cookie }: TestApp) => {
  const response = await app.request("/api/v1/integrations/shutterfly", {
    body: JSON.stringify({ refreshToken: validRefreshToken }),
    headers: { "content-type": "application/json", cookie },
    method: "PUT",
  });

  expect(response.status).toBe(200);
};

const waitForArchive = async ({ app, cookie }: TestApp, archiveId: string) => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const response = await app.request(`/api/v1/integrations/shutterfly/archives/${archiveId}`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);

    const archive = shutterflyArchiveResponseSchema.parse(await response.json());

    if (archive.status !== "running") {
      return archive;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Archive ${archiveId} did not finish`);
};

const download = async ({ app, cookie }: TestApp, archiveId: string) => {
  const response = await app.request(
    `/api/v1/integrations/shutterfly/archives/${archiveId}/download`,
    { headers: { cookie } },
  );

  expect(response.status).toBe(200);

  const zip = Buffer.from(await response.arrayBuffer());

  expect(response.headers.get("content-length")).toBe(String(zip.length));
  expect(response.headers.get("content-disposition")).toBe(
    'attachment; filename="shutterfly-archive-2026-05-17.zip"',
  );

  const prefix = "shutterfly-archive-2026-05-17/";

  return new Map(
    [...readZip(zip)].map(([name, data]) => {
      expect(name.startsWith(prefix)).toBe(true);

      return [name.slice(prefix.length), data] as const;
    }),
  );
};

const readJson = (files: Map<string, Buffer>, name: string): unknown => {
  const data = files.get(name);

  if (!data) {
    throw new Error(`${name} is missing from the archive`);
  }

  return JSON.parse(data.toString("utf8"));
};

describe("Shutterfly archive helpers", () => {
  it("reads moment ids from album records and file names from Content-Disposition", () => {
    expect(parseShutterflyAlbumMomentIds(albumMoments("102", "4000000000000104", "102"))).toEqual([
      "102",
      "4000000000000104",
    ]);
    expect(readContentDispositionFileName(`attachment; filename="IMG 1.jpg"`)).toBe("IMG 1.jpg");
    expect(
      readContentDispositionFileName(
        `attachment; filename="x.jpg"; filename*=UTF-8''%C3%A9t%C3%A9.jpg`,
      ),
    ).toBe("été.jpg");
    expect(readContentDispositionFileName(null)).toBeNull();
  });

  it("sorts projects into archive parts by their Shutterfly category", () => {
    const kind = (productCategory: string | undefined, group?: string) =>
      shutterflyProjectKind({
        _id: "1",
        ...(productCategory ? { productCategory } : {}),
        ...(group ? { projectType: { group } } : {}),
      });

    expect(kind("Books")).toBe("books");
    expect(kind(undefined, "photobooks")).toBe("books");
    expect(kind("Calendars")).toBe("calendars");
    expect(kind("Cards & Stationery")).toBe("cards");
    expect(kind("Prints")).toBe("prints");
    expect(kind("Notebooks")).toBe("otherProjects");
    expect(kind(undefined)).toBe("otherProjects");
  });

  it("streams a ZIP whose length matches the precomputed size", async () => {
    const dir = await createTempDir();

    await mkdir(join(dir, "photos"));
    await writeFile(join(dir, "photos", "été.jpg"), randomBytes(70_000));
    await writeFile(join(dir, "README.txt"), "hello");
    await writeFile(join(dir, "empty.json"), "");

    const entries = await collectZipEntries(dir, "archive/");
    const zip = await streamToBuffer(createZipStream(entries));
    const files = readZip(zip);

    expect(zip.length).toBe(zipLength(entries));
    expect([...files.keys()]).toEqual([
      "archive/empty.json",
      "archive/photos/été.jpg",
      "archive/README.txt",
    ]);
    expect(files.get("archive/photos/été.jpg")).toEqual(
      await readFile(join(dir, "photos", "été.jpg")),
    );
  });
});

describe("Shutterfly archive routes", () => {
  it("archives photos, albums, projects, and orders, then resumes to retry failures", async () => {
    const testApp = await createTestApp();
    const { app, archiveDir, cookie, fake } = testApp;

    await connect(testApp);

    const started = await app.request("/api/v1/integrations/shutterfly/archives", {
      headers: { cookie },
      method: "POST",
    });

    expect(started.status).toBe(202);

    const { id } = shutterflyArchiveResponseSchema.parse(await started.json());
    const first = await waitForArchive(testApp, id);

    expect(first).toMatchObject({
      status: "completed",
      error: null,
      progress: {
        step: "finishing",
        photos: { completed: 3, failed: 1, total: 4 },
        projects: { completed: 2, failed: 0, total: 2 },
        albums: { completed: 2, failed: 0, total: 2 },
        orders: 3,
        errorCount: 1,
      },
    });

    let files = await download(testApp, id);
    // 101 and 102 share an original name; whichever finishes first keeps it unsuffixed.
    const photo102 =
      files.get("photos/IMG_0001.jpg")?.toString() === "photo-102"
        ? "photos/IMG_0001.jpg"
        : "photos/IMG_0001 (102).jpg";
    const photo101 =
      photo102 === "photos/IMG_0001.jpg" ? "photos/IMG_0001 (101).jpg" : "photos/IMG_0001.jpg";

    expect(files.get(photo101)?.toString()).toBe("photo-101");
    expect(files.get(photo102)?.toString()).toBe("photo-102");
    expect(files.get("photos/104.mp4")?.toString()).toBe("video-104");
    expect(readJson(files, "albums/Summer/album.json")).toMatchObject({
      name: "Summer",
      owned: true,
      photos: [
        { momentId: "102", file: photo102 },
        { momentId: "104", file: "photos/104.mp4" },
      ],
    });
    expect(readJson(files, "albums/albums.json")).toMatchObject([
      { id: "a1", owned: true },
      { id: "a2", name: "From Grandma", owned: false, photoCount: 0 },
    ]);
    expect(readJson(files, "orders/orders.json")).toEqual([
      { orderId: "order-1" },
      { orderId: "order-2" },
    ]);
    expect(readJson(files, "orders/legacy-orders.json")).toEqual([{ orderId: "legacy-1" }]);

    const book = "projects/Books/Fixture Layflat Book (1000000000001)";

    expect(readJson(files, `${book}/project.json`)).toMatchObject({ _id: "1000000000001" });
    expect(files.get(`${book}/photos/beach.jpg`)?.toString()).toBe("rendered-photo");
    expect(files.get(`${book}/design-assets/round-frame (DA_22741).svg`)?.toString()).toBe(
      "<svg/>",
    );
    expect(readJson(files, `${book}/pages.json`)).toEqual([
      { file: "pages/coverSpread-01.svg", category: "coverSpread", surfaceNumber: "0" },
      ...[0, "1", "3", "19", "29"].map((surfaceNumber, index) => ({
        file: `pages/inside-0${index + 1}.svg`,
        category: "inside",
        surfaceNumber,
      })),
      { file: "pages/logo-01.svg", category: "logo", surfaceNumber: "-7" },
    ]);
    expect(fake.pageRenders).toContainEqual({
      height: "2910",
      surfaceNumber: "0",
      apiKey: "test-shutterfly-api-key",
    });

    const pageSvg = files.get(`${book}/pages/inside-02.svg`)?.toString() ?? "";

    // The page is saved on its own at print size, without the product mockup around it.
    expect(pageSvg).toMatch(/^<\?xml[^>]*>\s*<svg [^>]*viewBox="0 0 2385 2910">/);
    expect(pageSvg).toContain(`<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`);
    expect(pageSvg.trimEnd()).toMatch(
      /<image href="https:\/\/example\.com\/elsewhere\.png"\/><\/svg>$/,
    );
    expect(pageSvg).not.toMatch(/Underlay|Overlay|mockup/);

    // Photos and fonts are built in so the page still opens after Shutterfly deletes them. Fonts on
    // Shutterfly's internal host come from the public copy listed in the design assets.
    expect(pageSvg).toContain(
      `xlink:href="data:application/octet-stream;base64,${Buffer.from("rendered-photo").toString("base64")}"`,
    );
    expect(pageSvg).toContain(
      `url("data:font/woff;base64,${Buffer.from("wOFF-font").toString("base64")}")`,
    );
    // Shutterfly repeats each font's style for every text box; one copy is kept.
    expect(pageSvg.match(/@font-face/g)).toHaveLength(1);
    expect(pageSvg).toContain(`href="https://example.com/elsewhere.png"`);
    expect(pageSvg).not.toContain("shutterfly.com");
    expect(pageSvg).not.toContain("sf-cdn.com");
    // Page photos are fetched at the next size Shutterfly allows above how large they are placed.
    expect(fake.photoRenders).toContain(
      "https://uniim-cp.shutterfly.com/procsimple?imageID=page&rendersize=fit3000x3000",
    );
    expect(readJson(files, "projects/Cards/Holiday card (2000000000002)/project.json")).toEqual({
      _id: "2000000000002",
      projectName: "Holiday card",
    });
    expect(readJson(files, "errors.json")).toEqual([
      expect.objectContaining({ section: "photos", item: "103" }),
    ]);
    expect(readJson(files, "account.json")).toMatchObject({
      shutterflyAccountId: "012345678901",
      photoLibraryId: "777",
    });

    fake.failingMoments.clear();
    fake.downloads.length = 0;

    const resumed = await app.request(`/api/v1/integrations/shutterfly/archives/${id}/resume`, {
      headers: { cookie },
      method: "POST",
    });

    expect(resumed.status).toBe(202);
    expect(await waitForArchive(testApp, id)).toMatchObject({
      status: "completed",
      progress: { photos: { completed: 4, failed: 0, total: 4 }, errorCount: 0 },
    });
    // Photos saved by the first run are kept rather than downloaded again.
    expect(fake.downloads).toEqual(["103"]);

    files = await download(testApp, id);

    expect(files.get("photos/IMG_0001 (103).jpg")?.toString()).toBe("photo-103");
    expect(files.get(photo101)?.toString()).toBe("photo-101");
    expect(readJson(files, "errors.json")).toEqual([]);

    // Projects are archived side by side; each records only the bytes in its own folder.
    const [projectsState] = (await readdir(archiveDir, { recursive: true })).filter(
      (entry) => entry.includes(id) && entry.endsWith("projects.jsonl"),
    );
    const projectEntries = (await readFile(join(archiveDir, projectsState as string), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { folder: string; bytes: number });

    expect(projectEntries.length).toBeGreaterThan(1);

    for (const { folder, bytes } of projectEntries) {
      expect(bytes).toBe(
        [...files]
          .filter(([name]) => name.startsWith(`${folder}/`))
          .reduce((total, [, data]) => total + data.length, 0),
      );
    }

    const list = await app.request("/api/v1/integrations/shutterfly/archives", {
      headers: { cookie },
    });

    expect(shutterflyArchiveListResponseSchema.parse(await list.json()).archives).toHaveLength(1);

    const removed = await app.request(`/api/v1/integrations/shutterfly/archives/${id}`, {
      headers: { cookie },
      method: "DELETE",
    });

    expect(removed.status).toBe(204);
    expect(
      (await readdir(archiveDir, { recursive: true })).filter((entry) => entry.includes(id)),
    ).toEqual([]);
    expect(
      (
        await app.request(`/api/v1/integrations/shutterfly/archives/${id}`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(404);
  });

  it("archives only the chosen parts", async () => {
    const testApp = await createTestApp();
    const { app, cookie, fake } = testApp;

    await connect(testApp);

    const started = await app.request("/api/v1/integrations/shutterfly/archives", {
      body: JSON.stringify({ parts: ["cards", "albums"] }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    });

    expect(started.status).toBe(202);

    const { id, parts } = shutterflyArchiveResponseSchema.parse(await started.json());

    expect(parts).toEqual(["albums", "cards"]);
    expect(await waitForArchive(testApp, id)).toMatchObject({
      status: "completed",
      parts: ["albums", "cards"],
      progress: {
        photos: { completed: 2, failed: 0, total: 2 },
        projects: { completed: 1, failed: 0, total: 1 },
        albums: { completed: 2, failed: 0, total: 2 },
        orders: 0,
      },
    });
    // Only album photos are downloaded when the photo library is left out.
    expect([...fake.downloads].sort()).toEqual(["102", "104"]);

    const files = await download(testApp, id);
    const names = [...files.keys()];

    expect(names.some((name) => name.startsWith("orders/"))).toBe(false);
    expect(names.some((name) => name.startsWith("projects/Books/"))).toBe(false);
    expect(readJson(files, "projects/projects.json")).toEqual([
      expect.objectContaining({ _id: "2000000000002" }),
    ]);
    expect(names).toContain("projects/Cards/Holiday card (2000000000002)/project.json");
    expect(names).toContain("albums/albums.json");
    expect(readJson(files, "account.json")).toMatchObject({ parts: ["albums", "cards"] });
  });

  it("adds page renders to projects archived before they existed", async () => {
    const testApp = await createTestApp();
    const { app, archiveDir, cookie, fake } = testApp;

    await connect(testApp);

    const started = await app.request("/api/v1/integrations/shutterfly/archives", {
      body: JSON.stringify({ parts: ["books"] }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    });
    const { id } = shutterflyArchiveResponseSchema.parse(await started.json());

    await waitForArchive(testApp, id);

    // Rewind the archive to how an earlier version left it: no pages, and no pages flag.
    const [stateFile] = (await readdir(archiveDir, { recursive: true }))
      .filter((entry) => entry.includes(id) && entry.endsWith("projects.jsonl"))
      .map((entry) => join(archiveDir, entry));
    const book = "projects/Books/Fixture Layflat Book (1000000000001)";
    const bookDir = join(stateFile as string, "..", "..", "files", ...book.split("/"));
    const entry = JSON.parse(await readFile(stateFile as string, "utf8"));

    delete entry.pages;
    await writeFile(stateFile as string, `${JSON.stringify(entry)}\n`);
    await rm(join(bookDir, "pages"), { recursive: true });
    await rm(join(bookDir, "pages.json"));
    fake.pageRenders.length = 0;

    const projectRequests: string[] = [];
    const fetchProjects = fake.fetch;

    fake.fetch = async (input, init) => {
      if (String(input).includes("/projects/v2/project/")) {
        projectRequests.push(String(input));
      }

      return fetchProjects(input, init);
    };

    await app.request(`/api/v1/integrations/shutterfly/archives/${id}/resume`, {
      headers: { cookie },
      method: "POST",
    });

    expect(await waitForArchive(testApp, id)).toMatchObject({
      status: "completed",
      progress: { projects: { completed: 1, failed: 0, total: 1 }, errorCount: 0 },
    });
    expect(fake.pageRenders).toHaveLength(7);
    // The saved project.json is rendered rather than downloading the project again.
    expect(projectRequests).toEqual([]);

    const files = await download(testApp, id);

    expect(files.get(`${book}/pages/logo-01.svg`)?.toString()).toContain("data:font/woff;base64,");
    expect(files.get(`${book}/photos/beach.jpg`)?.toString()).toBe("rendered-photo");
  });

  it("rejects an empty list of parts", async () => {
    const testApp = await createTestApp();

    await connect(testApp);

    const response = await testApp.app.request("/api/v1/integrations/shutterfly/archives", {
      body: JSON.stringify({ parts: [] }),
      headers: { "content-type": "application/json", cookie: testApp.cookie },
      method: "POST",
    });

    expect(response.status).toBe(400);
  });

  it("stops with a reconnect error when Shutterfly rejects the sign-in", async () => {
    const testApp = await createTestApp();

    await connect(testApp);
    testApp.fake.expired = true;

    const started = await testApp.app.request("/api/v1/integrations/shutterfly/archives", {
      headers: { cookie: testApp.cookie },
      method: "POST",
    });
    const { id } = shutterflyArchiveResponseSchema.parse(await started.json());
    const archive = await waitForArchive(testApp, id);

    expect(archive.status).toBe("failed");
    expect(archive.error?.code).toBe("shutterfly_reconnect_required");
  });

  it("rejects archiving before the account is connected", async () => {
    const testApp = await createTestApp();
    const response = await testApp.app.request("/api/v1/integrations/shutterfly/archives", {
      headers: { cookie: testApp.cookie },
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "shutterfly_not_connected" } });
  });
});
