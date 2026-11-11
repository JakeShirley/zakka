import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  pageResponseSchema,
  shutterflyConnectionResponseSchema,
  shutterflyImportResponseSchema,
  shutterflyProjectListResponseSchema,
} from "@zakka/api-contract";
import { makeFixedClock } from "@zakka/test-utils";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { createCredentialCipher } from "./integrations/credential-cipher.js";
import { createShutterflyClient } from "./integrations/shutterfly/client.js";
import {
  createShutterflyIntegration,
  readSolidSvgColor,
} from "./integrations/shutterfly/service.js";
import { createDatabaseConnection, type DatabaseConnection } from "./persistence/database.js";
import { runMigrations } from "./persistence/migrations.js";
import { createPageDocumentStore } from "./persistence/page-documents.js";
import { createRepositories, type Repositories } from "./persistence/repositories.js";
import { createDiskStorage } from "./storage/disk.js";

const fixedDate = new Date("2026-05-17T12:00:00.000Z");
const validRefreshToken = "valid-refresh-token.abcdefghijklmnopqrstuvwxyz";
const apiKey = "test-shutterfly-api-key";
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

const fakeIdToken = () =>
  [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sfly_uid: "012345678901",
        email: "reader@example.com",
        exp: Math.floor(fixedDate.getTime() / 1000) + 82_800,
        token_use: "id",
      }),
    ).toString("base64url"),
    "signature",
  ].join(".");

type FakeShutterfly = {
  fetch: typeof fetch;
  requests: Array<{ url: string; headers: Headers }>;
  rejectApi: boolean;
  rejectRefresh: boolean;
  refreshGate: Promise<void> | null;
};

const createFakeShutterfly = async (): Promise<FakeShutterfly> => {
  const fixtureText = await (await import("node:fs/promises")).readFile(fixturePath, "utf8");
  const photo = await sharp({
    create: { background: { r: 40, g: 120, b: 200 }, channels: 3, height: 375, width: 500 },
  })
    .jpeg()
    .toBuffer();
  // Each sticker gets distinct artwork so per-pack checksum dedupe keeps them separate.
  const stickerSvg = (url: string) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="96"><circle cx="48" cy="48" r="${(url.length % 40) + 10}" fill="#c0a060"/></svg>`,
    );
  const fake: FakeShutterfly = {
    fetch: async () => new Response(null, { status: 500 }),
    requests: [],
    rejectApi: false,
    rejectRefresh: false,
    refreshGate: null,
  };

  fake.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    fake.requests.push({ url, headers });

    if (url.startsWith("https://accounts.shutterfly.com/sso/v2/tokens")) {
      await fake.refreshGate;

      if (fake.rejectRefresh || !headers.get("cookie")?.endsWith(`=${validRefreshToken}`)) {
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

    if (fake.rejectApi && url.startsWith("https://projects-api3.shutterfly.com/")) {
      return new Response(null, { status: 401 });
    }

    if (url.startsWith("https://projects-api3.shutterfly.com/projects/v2/project?")) {
      return Response.json({
        resources: [
          { resource: { ...JSON.parse(fixtureText), photoWell: [], surfaceCategories: [] } },
          {
            resource: {
              _id: "2000000000002",
              projectName: "Holiday card",
              productCategory: "Cards",
              projectType: { group: "cards" },
            },
          },
        ],
      });
    }

    if (url.startsWith("https://projects-api3.shutterfly.com/projects/v2/project/1000000000002?")) {
      const project = JSON.parse(fixtureText);
      const inside = project.surfaceCategories.find(
        (category: { categoryName: string }) => category.categoryName === "inside",
      );

      inside.surfaces[0].surfaceData.layeredItems.unshift({
        type: "background",
        container: { x: 0, y: 0, w: 2385, h: 2385, rot: 0 },
        content: { contentType: "Background", userData: { assetId: "DA_bg1" } },
      });

      return Response.json(project);
    }

    if (url.startsWith("https://projects-api3.shutterfly.com/projects/v2/project/1000000000001?")) {
      return new Response(fixtureText, { headers: { "content-type": "application/json" } });
    }

    if (url.startsWith("https://projects-api3.shutterfly.com/projects/v2/project/")) {
      return new Response("{}", { status: 404 });
    }

    if (url.startsWith("https://mediaag.shutterfly.com/services/user-media/v3/012345678901/")) {
      return Response.json({
        "012345678901": [
          {
            id: "9000000000000001",
            fileName: "beach.jpg",
            url: "https://uniim-cp.shutterfly.com/procsimple?imageID=img-cover",
            image_def: { width: 400, height: 300 },
          },
        ],
      });
    }

    if (
      url.startsWith("https://catalog-api3.shutterfly.com/catalogdesign/v1/design-asset-by-ids")
    ) {
      const sticker = (id: string, name: string) => ({
        id,
        name,
        assetType: "embellishment",
        preview: `https://sfly3-catalog-design-imzr.sf-cdn.com/${id}.png`,
        files: { PRINT_RES: { location: `/internal/${id}.svg`, fileType: "SVG" } },
      });

      return Response.json({
        entities: {
          designAssets: [
            { id: "DA_46646", name: "Helvetica Neue", assetType: "font" },
            sticker("DA_22741", "round-frame"),
            sticker("DA_893", "winter-break"),
            {
              id: "DA_bg1",
              name: "linen",
              assetType: "background",
              preview: "https://sfly3-catalog-design-imzr.sf-cdn.com/DA_bg1.png",
            },
          ],
        },
      });
    }

    if (url.startsWith("https://uniim-cp.shutterfly.com/")) {
      return new Response(new Uint8Array(photo), { headers: { "content-type": "image/jpeg" } });
    }

    if (url.startsWith("https://sfly3-catalog-design-imzr.sf-cdn.com/")) {
      return new Response(new Uint8Array(photo), { headers: { "content-type": "image/jpeg" } });
    }

    if (url.startsWith("https://sfly3-catalog-design.sf-cdn.com/internal/")) {
      return new Response(new Uint8Array(stickerSvg(url)), {
        headers: { "content-type": "application/xml" },
      });
    }

    return new Response(null, { status: 404 });
  };

  return fake;
};

const createTestApp = async (options: { configured?: boolean } = {}) => {
  const connection = createDatabaseConnection({ databasePath: ":memory:" });
  const rootDir = await mkdtemp(join(tmpdir(), "zakka-shutterfly-"));
  const storage = createDiskStorage({ rootDir });

  connections.push(connection);
  tempDirs.push(rootDir);
  runMigrations(connection.sqlite);
  await storage.ensureReady();

  const repositories = createRepositories(connection.db, {
    clock: makeFixedClock(fixedDate),
    pageDocuments: createPageDocumentStore({ rootDir }),
  });
  const fake = await createFakeShutterfly();
  const clock = { now: fixedDate.getTime() };
  const app = createApp({
    clock: makeFixedClock(fixedDate),
    repositories,
    storage,
    ...(options.configured === false
      ? {}
      : {
          shutterfly: createShutterflyIntegration({
            apiKey,
            cipher: createCredentialCipher(randomBytes(32)),
            clock: () => new Date(clock.now),
            fetch: fake.fetch,
            repositories,
            storage,
          }),
        }),
  });

  return { app, clock, connection, fake, repositories };
};

const register = async (app: ReturnType<typeof createApp>, email = "maker@example.com") => {
  const response = await app.request("/api/v1/auth/register", {
    body: JSON.stringify({
      displayName: "Maker",
      email,
      password: "correct horse battery staple",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(response.status).toBe(201);

  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
};

const connect = (app: ReturnType<typeof createApp>, cookie: string, refreshToken: string) =>
  app.request("/api/v1/integrations/shutterfly", {
    body: JSON.stringify({ refreshToken }),
    headers: { "content-type": "application/json", cookie },
    method: "PUT",
  });

const importProject = (app: ReturnType<typeof createApp>, cookie: string, projectId: string) =>
  app.request(`/api/v1/integrations/shutterfly/projects/${projectId}/import`, {
    headers: { cookie },
    method: "POST",
  });

const countAssets = (repositories: Repositories, accountId: string) =>
  repositories.assets.listForAccount(accountId).length;

describe("Shutterfly integration routes", () => {
  it("reports when the server is not configured and rejects connections", async () => {
    const { app } = await createTestApp({ configured: false });
    const cookie = await register(app);
    const status = await app.request("/api/v1/integrations/shutterfly", { headers: { cookie } });

    expect(shutterflyConnectionResponseSchema.parse(await status.json())).toEqual({
      configured: false,
      connected: false,
      email: null,
      connectedAt: null,
    });
    expect((await connect(app, cookie, validRefreshToken)).status).toBe(503);
  });

  it("requires authentication", async () => {
    const { app } = await createTestApp();

    expect((await app.request("/api/v1/integrations/shutterfly")).status).toBe(401);
    expect((await app.request("/api/v1/integrations/shutterfly/projects")).status).toBe(401);
  });

  it("rejects refresh tokens Shutterfly does not accept", async () => {
    const { app } = await createTestApp();
    const cookie = await register(app);
    const response = await connect(app, cookie, "not-a-real-refresh-token-value");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "shutterfly_token_invalid" } });
  });

  it("connects with a pasted cookie and stores the refresh token encrypted", async () => {
    const { app, connection } = await createTestApp();
    const cookie = await register(app);
    const response = await connect(
      app,
      cookie,
      ` CognitoIdentityServiceProvider.client.someone%40example.com.refreshToken=${validRefreshToken} `,
    );

    expect(response.status).toBe(200);
    expect(shutterflyConnectionResponseSchema.parse(await response.json())).toMatchObject({
      configured: true,
      connected: true,
      email: "reader@example.com",
    });

    const stored = connection.sqlite
      .prepare("SELECT encrypted_credentials, external_account_id FROM integration_connections")
      .get() as { encrypted_credentials: string; external_account_id: string };

    expect(stored.external_account_id).toBe("012345678901");
    expect(stored.encrypted_credentials).not.toContain(validRefreshToken);

    const disconnect = await app.request("/api/v1/integrations/shutterfly", {
      headers: { cookie },
      method: "DELETE",
    });
    const status = await app.request("/api/v1/integrations/shutterfly", { headers: { cookie } });

    expect(disconnect.status).toBe(204);
    expect(await status.json()).toMatchObject({ connected: false });
  });

  it("lists only photo book projects with the Shutterfly API key and ID token", async () => {
    const { app, fake } = await createTestApp();
    const cookie = await register(app);

    await connect(app, cookie, validRefreshToken);

    const response = await app.request("/api/v1/integrations/shutterfly/projects", {
      headers: { cookie },
    });
    const body = shutterflyProjectListResponseSchema.parse(await response.json());
    const listRequest = fake.requests.find((request) => request.url.includes("/project?"));

    expect(response.status).toBe(200);
    expect(body.projects).toEqual([
      {
        id: "1000000000001",
        name: "Fixture Layflat Book",
        productName: "8x8 Deluxe Layflat Photo Book",
        thumbnailUrl: null,
        pageCount: 34,
        updatedAt: "2026-05-21T21:59:17.820Z",
      },
    ]);
    expect(listRequest?.url).toContain("accountId=012345678901");
    expect(listRequest?.headers.get("x-api-key")).toBe(apiKey);
    expect(listRequest?.headers.get("authorization")).toMatch(/^Bearer ey/);
  });

  it("imports a book with pages, photos, text, and stickers, reusing media on re-import", async () => {
    const { app, repositories } = await createTestApp();
    const cookie = await register(app);
    const accountId = repositories.accounts.findByPrimaryEmail("maker@example.com")?.id ?? "";

    await connect(app, cookie, validRefreshToken);

    const response = await importProject(app, cookie, "1000000000001");
    const body = shutterflyImportResponseSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(body.book).toMatchObject({
      title: "Fixture Layflat Book",
      pageWidth: 2385,
      pageHeight: 2385,
      pageCount: 34,
      coverSpreadEnabled: true,
    });
    expect(body.warnings).toEqual([]);

    const [photoAsset] = repositories.assets.listForAccount(accountId);
    const [pack] = repositories.stickerPacks.listForAccount(accountId);

    expect(photoAsset).toMatchObject({ originalFilename: "beach.jpg", width: 400, height: 300 });
    expect(pack).toMatchObject({ title: "Shutterfly", stickerCount: 2 });

    const pageOne = body.book.pages.find((page) => page.page.title === "Page 1");
    const pageResponse = await app.request(`/api/v1/pages/${pageOne?.pageId}`, {
      headers: { cookie },
    });
    const layers = pageResponseSchema.parse(await pageResponse.json()).document.layers;

    expect(layers.map((layer) => layer.kind).sort()).toEqual(["sticker", "text"]);
    expect(layers.find((layer) => layer.kind === "text")).toMatchObject({
      fontFamily: "Helvetica Neue",
      text: "Test test box",
    });

    const assetCount = countAssets(repositories, accountId);
    const reimport = await importProject(app, cookie, "1000000000001");

    expect(reimport.status).toBe(201);
    expect(countAssets(repositories, accountId)).toBe(assetCount);
    expect(repositories.stickerPacks.listForAccount(accountId)).toHaveLength(1);
    expect(repositories.books.listForAccount(accountId)).toHaveLength(2);
  });

  it("asks the user to reconnect when Shutterfly rejects the stored token", async () => {
    const { app, fake } = await createTestApp();
    const cookie = await register(app);

    await connect(app, cookie, validRefreshToken);
    fake.rejectApi = true;
    fake.rejectRefresh = true;

    const response = await app.request("/api/v1/integrations/shutterfly/projects", {
      headers: { cookie },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "shutterfly_reconnect_required" },
    });
  });

  it("keeps connections per account and reports missing projects", async () => {
    const { app } = await createTestApp();
    const cookie = await register(app);
    const otherCookie = await register(app, "other@example.com");

    await connect(app, cookie, validRefreshToken);

    const notConnected = await app.request("/api/v1/integrations/shutterfly/projects", {
      headers: { cookie: otherCookie },
    });

    expect(notConnected.status).toBe(409);
    expect(await notConnected.json()).toMatchObject({
      error: { code: "shutterfly_not_connected" },
    });
    expect((await importProject(app, cookie, "1999999999999")).status).toBe(404);
  });

  it("adds imported image backgrounds to the book's photos", async () => {
    const { app, repositories } = await createTestApp();
    const cookie = await register(app);
    const accountId = repositories.accounts.findByPrimaryEmail("maker@example.com")?.id ?? "";

    await connect(app, cookie, validRefreshToken);

    const response = await importProject(app, cookie, "1000000000002");
    const body = shutterflyImportResponseSchema.parse(await response.json());
    const bookAssets = repositories.books.listAssetsForBook(accountId, body.book.id);
    const pageOne = body.book.pages.find((page) => page.page.title === "Page 1");
    const layers = pageResponseSchema.parse(
      await (await app.request(`/api/v1/pages/${pageOne?.pageId}`, { headers: { cookie } })).json(),
    ).document.layers;
    const background = layers[0];

    expect(response.status).toBe(201);
    expect(background).toMatchObject({ kind: "photo", locked: true, width: 2385 });
    expect(bookAssets.map((asset) => asset.id)).toContain(
      background?.kind === "photo" ? background.assetId : "",
    );
  });

  it("does not restore a connection that was removed while a token refresh was in flight", async () => {
    const { app, clock, fake } = await createTestApp();
    const cookie = await register(app);
    let releaseRefresh = () => {};

    await connect(app, cookie, validRefreshToken);
    clock.now += 24 * 60 * 60 * 1000;
    fake.refreshGate = new Promise((resolve) => {
      releaseRefresh = resolve;
    });

    const pendingList = app.request("/api/v1/integrations/shutterfly/projects", {
      headers: { cookie },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    await app.request("/api/v1/integrations/shutterfly", { headers: { cookie }, method: "DELETE" });
    releaseRefresh();

    const list = await pendingList;
    const status = await app.request("/api/v1/integrations/shutterfly", { headers: { cookie } });

    expect(list.status).toBe(409);
    expect(await list.json()).toMatchObject({ error: { code: "shutterfly_not_connected" } });
    expect(await status.json()).toMatchObject({ connected: false });
  });
});

describe("readSolidSvgColor", () => {
  const svg = (body: string) =>
    `<?xml version="1.0"?><!-- Adobe Illustrator --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860.4 860.4">${body}<crp:colorMapping><crp:color rgb="FFFFFF"/></crp:colorMapping></svg>`;

  it("reads the color of a background made of one full-size rectangle", () => {
    expect(readSolidSvgColor(svg('<rect fill="#1A2B3C" height="860.4" width="860.4"/>'))).toBe(
      "#1a2b3c",
    );
  });

  it("ignores partial rectangles and patterned artwork", () => {
    expect(readSolidSvgColor(svg('<rect fill="#ffffff" height="400" width="860.4"/>'))).toBeNull();
    expect(
      readSolidSvgColor(
        svg('<rect fill="#ffffff" height="860.4" width="860.4"/><circle r="40" fill="#ff0000"/>'),
      ),
    ).toBeNull();
  });
});

describe("Shutterfly downloads", () => {
  it("stops reading a response once it exceeds the size cap, even without Content-Length", async () => {
    let chunksRead = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksRead += 1;
        controller.enqueue(chunk);
      },
    });
    const client = createShutterflyClient({
      apiKey,
      fetch: async () => new Response(body),
    });

    await expect(client.download("https://uniim-cp.shutterfly.com/huge")).rejects.toThrow(
      "Shutterfly download is too large",
    );
    expect(chunksRead).toBeLessThan(45);
  });
});
