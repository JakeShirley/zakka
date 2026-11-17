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
      return new Response("rendered-photo", { headers: { "content-type": "image/jpeg" } });
    }

    if (
      url.startsWith("https://catalog-api3.shutterfly.com/catalogdesign/v1/design-asset-by-ids")
    ) {
      return Response.json({
        entities: {
          designAssets: [
            { id: "DA_46646", name: "Helvetica Neue", assetType: "font" },
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
