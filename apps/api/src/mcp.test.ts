import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  accessTokenCreateResponseSchema,
  accessTokenListResponseSchema,
  accessTokenPrefix,
  mcpEndpointPath,
} from "@zakka/api-contract";
import { makeFixedClock } from "@zakka/test-utils";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { createDatabaseConnection, type DatabaseConnection } from "./persistence/database.js";
import { runMigrations } from "./persistence/migrations.js";
import { createPageDocumentStore } from "./persistence/page-documents.js";
import { createRepositories } from "./persistence/repositories.js";
import { createDiskStorage } from "./storage/disk.js";

type TestApp = ReturnType<typeof createApp>;
type ToolContent = { type: string; text?: string; data?: string; mimeType?: string };
type ToolResult = { content: ToolContent[]; isError?: boolean };

const connections: DatabaseConnection[] = [];
const tempDirs: string[] = [];
const fixedDate = new Date("2026-05-17T12:00:00.000Z");

const createTestApp = async (): Promise<TestApp> => {
  const connection = createDatabaseConnection({ databasePath: ":memory:" });
  const rootDir = await mkdtemp(join(tmpdir(), "zakka-mcp-"));
  const storage = createDiskStorage({ rootDir });

  connections.push(connection);
  tempDirs.push(rootDir);
  runMigrations(connection.sqlite);
  await storage.ensureReady();

  return createApp({
    clock: makeFixedClock(fixedDate),
    repositories: createRepositories(connection.db, {
      clock: makeFixedClock(fixedDate),
      pageDocuments: createPageDocumentStore({ rootDir }),
    }),
    storage,
  });
};

const registerAccount = async (app: TestApp, email: string): Promise<string> => {
  const response = await app.request("/api/v1/auth/register", {
    body: JSON.stringify({ displayName: "Ada", email, password: "correct horse battery staple" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(response.status).toBe(201);

  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
};

const createToken = async (app: TestApp, cookie: string, name = "Claude") => {
  const response = await app.request("/api/v1/account/access-tokens", {
    body: JSON.stringify({ name }),
    headers: { cookie, "content-type": "application/json" },
    method: "POST",
  });

  expect(response.status).toBe(201);

  return accessTokenCreateResponseSchema.parse(await response.json());
};

const postMcp = (app: TestApp, body: unknown, secret?: string) =>
  app.request(mcpEndpointPath, {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    method: "POST",
  });

const callTool = async (
  app: TestApp,
  secret: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> => {
  const response = await postMcp(
    app,
    { id: 1, jsonrpc: "2.0", method: "tools/call", params: { arguments: args, name } },
    secret,
  );

  expect(response.status).toBe(200);

  const body = (await response.json()) as { result: ToolResult };

  return body.result;
};

const callToolJson = async <T>(
  app: TestApp,
  secret: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> => {
  const result = await callTool(app, secret, name, args);

  expect(result.isError ?? false, result.content[0]?.text).toBe(false);

  return JSON.parse(result.content[0]?.text ?? "null") as T;
};

afterEach(async () => {
  for (const connection of connections.splice(0)) {
    connection.close();
  }

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("personal access tokens", () => {
  it("creates, lists and revokes tokens without exposing the secret again", async () => {
    const app = await createTestApp();
    const cookie = await registerAccount(app, "ada@example.com");
    const created = await createToken(app, cookie, "  Claude Desktop  ");

    expect(created.secret.startsWith(accessTokenPrefix)).toBe(true);
    expect(created.token).toMatchObject({ lastUsedAt: null, name: "Claude Desktop" });
    expect(created.secret.startsWith(created.token.tokenPrefix)).toBe(true);

    const listResponse = await app.request("/api/v1/account/access-tokens", {
      headers: { cookie },
    });
    const listText = await listResponse.text();

    expect(listResponse.status).toBe(200);
    expect(listText).not.toContain(created.secret);
    expect(accessTokenListResponseSchema.parse(JSON.parse(listText)).tokens).toEqual([
      created.token,
    ]);

    const deleteResponse = await app.request(`/api/v1/account/access-tokens/${created.token.id}`, {
      headers: { cookie },
      method: "DELETE",
    });

    expect(deleteResponse.status).toBe(204);

    const repeatDelete = await app.request(`/api/v1/account/access-tokens/${created.token.id}`, {
      headers: { cookie },
      method: "DELETE",
    });

    expect(repeatDelete.status).toBe(404);

    const revoked = await postMcp(
      app,
      { id: 1, jsonrpc: "2.0", method: "tools/list" },
      created.secret,
    );

    expect(revoked.status).toBe(401);
  });

  it("requires a signed-in session to manage tokens", async () => {
    const app = await createTestApp();

    const response = await app.request("/api/v1/account/access-tokens");

    expect(response.status).toBe(401);
  });

  it("does not let accounts revoke each other's tokens", async () => {
    const app = await createTestApp();
    const ada = await registerAccount(app, "ada@example.com");
    const grace = await registerAccount(app, "grace@example.com");
    const created = await createToken(app, ada);

    const response = await app.request(`/api/v1/account/access-tokens/${created.token.id}`, {
      headers: { cookie: grace },
      method: "DELETE",
    });

    expect(response.status).toBe(404);
  });
});

describe("mcp endpoint", () => {
  it("rejects requests without a valid token", async () => {
    const app = await createTestApp();
    const request = { id: 1, jsonrpc: "2.0", method: "tools/list" };

    const missing = await postMcp(app, request);
    const invalid = await postMcp(app, request, `${accessTokenPrefix}not-a-real-token`);

    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("Bearer");
    expect(invalid.status).toBe(401);
  });

  it("only accepts POST", async () => {
    const app = await createTestApp();

    const response = await app.request(mcpEndpointPath);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("initializes, lists tools and records token use", async () => {
    const app = await createTestApp();
    const cookie = await registerAccount(app, "ada@example.com");
    const { secret } = await createToken(app, cookie);

    const initialize = await postMcp(
      app,
      {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
          protocolVersion: "2025-06-18",
        },
      },
      secret,
    );
    const initializeBody = (await initialize.json()) as {
      result: { instructions?: string; serverInfo: { name: string } };
    };

    expect(initialize.status).toBe(200);
    expect(initializeBody.result.serverInfo.name).toBe("zakka");
    expect(initializeBody.result.instructions).toContain("300 dpi");

    const list = await postMcp(app, { id: 2, jsonrpc: "2.0", method: "tools/list" }, secret);
    const listBody = (await list.json()) as { result: { tools: { name: string }[] } };

    expect(listBody.result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["list_books", "create_page", "add_layer", "render_page"]),
    );

    const tokens = accessTokenListResponseSchema.parse(
      await (await app.request("/api/v1/account/access-tokens", { headers: { cookie } })).json(),
    );

    expect(tokens.tokens[0]?.lastUsedAt).toBe(fixedDate.toISOString());
  });

  it("builds and renders a page in a book", async () => {
    const app = await createTestApp();
    const cookie = await registerAccount(app, "ada@example.com");
    const { secret } = await createToken(app, cookie);

    const book = await callToolJson<{ id: string; pages: { id: string; title: string }[] }>(
      app,
      secret,
      "create_book",
      { title: "Summer", pageWidth: 1200, pageHeight: 1500 },
    );

    expect(book.pages.map((page) => page.title)).toEqual(["Front cover", "Back cover"]);

    const page = await callToolJson<{ id: string; width: number; height: number }>(
      app,
      secret,
      "create_page",
      { bookId: book.id, title: "Beach day", backgroundColor: "#ddeeff" },
    );

    expect(page).toMatchObject({ height: 1500, width: 1200 });

    const bookAfterCreate = await callToolJson<{ pages: { id: string }[] }>(
      app,
      secret,
      "get_book",
      { bookId: book.id },
    );

    expect(bookAfterCreate.pages.map((entry) => entry.id)).toEqual([
      book.pages[0]?.id,
      page.id,
      book.pages[1]?.id,
    ]);

    const added = await callToolJson<{ layer: { id: string; text: string; border?: unknown } }>(
      app,
      secret,
      "add_layer",
      {
        kind: "text",
        pageId: page.id,
        properties: { text: "**Beach** day", x: 100, y: 120, width: 800, height: 200 },
      },
    );

    expect(added.layer).toMatchObject({ text: "**Beach** day", x: 100, y: 120 });

    const updated = await callToolJson<{ layer: { fontSize: number; x: number } }>(
      app,
      secret,
      "update_layer",
      { changes: { fontSize: 96 }, layerId: added.layer.id, pageId: page.id },
    );

    expect(updated.layer).toMatchObject({ fontSize: 96, x: 100 });

    const stored = await callToolJson<{
      document: { canvas: { backgroundColor: string }; layers: { id: string }[] };
    }>(app, secret, "get_page", { pageId: page.id });

    expect(stored.document.canvas.backgroundColor).toBe("#ddeeff");
    expect(stored.document.layers.map((layer) => layer.id)).toEqual([added.layer.id]);

    const render = await callTool(app, secret, "render_page", { maxSize: 256, pageId: page.id });
    const image = render.content[0];

    expect(image).toMatchObject({ mimeType: "image/jpeg", type: "image" });

    const metadata = await sharp(Buffer.from(image?.data ?? "", "base64")).metadata();

    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(256);

    await callToolJson(app, secret, "delete_layer", { layerId: added.layer.id, pageId: page.id });

    const emptied = await callToolJson<{ document: { layers: unknown[] } }>(
      app,
      secret,
      "get_page",
      { pageId: page.id },
    );

    expect(emptied.document.layers).toEqual([]);
  });

  it("browses photos and decorations and places a photo with its aspect ratio", async () => {
    const app = await createTestApp();
    const cookie = await registerAccount(app, "ada@example.com");
    const { secret } = await createToken(app, cookie);
    const png = await sharp({
      create: { background: { b: 90, g: 160, r: 210 }, channels: 3, height: 200, width: 400 },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set("file", new File([new Uint8Array(png)], "wide.png", { type: "image/png" }));
    const upload = await app.request("/api/v1/assets/uploads", {
      body: form,
      headers: { cookie },
      method: "POST",
    });

    expect(upload.status).toBe(201);

    const photos = await callToolJson<{ photos: { id: string; width: number }[]; total: number }>(
      app,
      secret,
      "list_photos",
    );

    expect(photos.total).toBe(1);

    const photoId = photos.photos[0]?.id ?? "";
    const view = await callTool(app, secret, "view_photo", { photoId, size: "large" });

    expect(view.content[0]).toMatchObject({ mimeType: "image/jpeg", type: "image" });

    const page = await callToolJson<{ id: string }>(app, secret, "create_page", {});
    const photoLayer = await callToolJson<{ layer: { height: number; width: number } }>(
      app,
      secret,
      "add_layer",
      { kind: "photo", pageId: page.id, properties: { assetId: photoId, width: 1000 } },
    );

    expect(photoLayer.layer).toMatchObject({ height: 500, width: 1000 });

    const missingPhoto = await callTool(app, secret, "add_layer", {
      kind: "photo",
      pageId: page.id,
      properties: { assetId: "asset_missing" },
    });

    expect(missingPhoto.isError).toBe(true);

    const stickers = await callToolJson<{ stickers: { id: string }[] }>(
      app,
      secret,
      "search_stickers",
      { limit: 5, query: "heart" },
    );
    const backgrounds = await callToolJson<{ backgrounds: { id: string }[] }>(
      app,
      secret,
      "list_backgrounds",
    );
    const fonts = await callToolJson<{ fonts: { family: string }[] }>(app, secret, "list_fonts");

    expect(stickers.stickers.length).toBeGreaterThan(0);
    expect(fonts.fonts.length).toBeGreaterThan(0);

    const sticker = await callToolJson<{ layer: { stickerId: string } }>(app, secret, "add_layer", {
      kind: "sticker",
      pageId: page.id,
      properties: { stickerId: stickers.stickers[0]?.id },
    });

    expect(sticker.layer.stickerId).toBe(stickers.stickers[0]?.id);

    const withBackground = await callToolJson<{
      document: { canvas: { background?: { backgroundId: string } } };
    }>(app, secret, "update_page", {
      background: { backgroundId: backgrounds.backgrounds[0]?.id },
      pageId: page.id,
    });

    expect(withBackground.document.canvas.background?.backgroundId).toBe(
      backgrounds.backgrounds[0]?.id,
    );
  });

  it("uploads an image into the library, an album and a book", async () => {
    const app = await createTestApp();
    const cookie = await registerAccount(app, "ada@example.com");
    const { secret } = await createToken(app, cookie);
    const albumResponse = await app.request("/api/v1/albums", {
      body: JSON.stringify({ title: "Trip" }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    });
    const album = (await albumResponse.json()) as { id: string };
    const book = await callToolJson<{ id: string }>(app, secret, "create_book", { title: "Trip" });
    const png = await sharp({
      create: { background: { b: 90, g: 160, r: 210 }, channels: 3, height: 300, width: 600 },
    })
      .png()
      .toBuffer();

    const uploaded = await callToolJson<{
      photo: { filename: string; height: number; id: string; width: number };
    }>(app, secret, "upload_image", {
      albumId: album.id,
      bookId: book.id,
      data: `data:image/png;base64,${png.toString("base64")}`,
      filename: "beach.png",
    });

    expect(uploaded.photo).toMatchObject({ filename: "beach.png", height: 300, width: 600 });

    for (const filter of [{ albumId: album.id }, { bookId: book.id }]) {
      const listed = await callToolJson<{ photos: { id: string }[] }>(
        app,
        secret,
        "list_photos",
        filter,
      );

      expect(listed.photos.map((photo) => photo.id)).toEqual([uploaded.photo.id]);
    }

    const notImage = await callTool(app, secret, "upload_image", {
      data: Buffer.from("hello").toString("base64"),
    });
    const notBase64 = await callTool(app, secret, "upload_image", { data: "not base64!" });
    const missingAlbum = await callTool(app, secret, "upload_image", {
      albumId: "album_missing",
      data: png.toString("base64"),
    });

    expect(notImage.content[0]?.text).toContain("not a valid image");
    expect(notBase64.content[0]?.text).toContain("base64");
    expect(missingAlbum.isError).toBe(true);

    const photos = await callToolJson<{ total: number }>(app, secret, "list_photos");

    expect(photos.total).toBe(1);
  });

  it("adds existing photos to a book and removes them", async () => {
    const app = await createTestApp();
    const cookie = await registerAccount(app, "ada@example.com");
    const { secret } = await createToken(app, cookie);
    const book = await callToolJson<{ id: string }>(app, secret, "create_book", { title: "Trip" });
    const png = await sharp({
      create: { background: { b: 90, g: 160, r: 210 }, channels: 3, height: 100, width: 100 },
    })
      .png()
      .toBuffer();
    const { photo } = await callToolJson<{ photo: { id: string } }>(app, secret, "upload_image", {
      data: png.toString("base64"),
    });

    const added = await callToolJson<{ added: string[]; bookPhotoCount: number }>(
      app,
      secret,
      "add_photos_to_book",
      { bookId: book.id, photoIds: [photo.id, photo.id] },
    );
    const again = await callToolJson<{ added: string[] }>(app, secret, "add_photos_to_book", {
      bookId: book.id,
      photoIds: [photo.id],
    });
    const missing = await callTool(app, secret, "add_photos_to_book", {
      bookId: book.id,
      photoIds: ["asset_missing"],
    });

    expect(added).toEqual({ added: [photo.id], bookPhotoCount: 1 });
    expect(again.added).toEqual([]);
    expect(missing.content[0]?.text).toContain("asset_missing");

    const removed = await callToolJson(app, secret, "remove_photos_from_book", {
      bookId: book.id,
      photoIds: [photo.id, "asset_missing"],
    });
    const library = await callToolJson<{ total: number }>(app, secret, "list_photos");

    expect(removed).toEqual({ bookPhotoCount: 0, removed: [photo.id] });
    expect(library.total).toBe(1);
  });

  it("reports invalid layer properties as tool errors", async () => {
    const app = await createTestApp();
    const cookie = await registerAccount(app, "ada@example.com");
    const { secret } = await createToken(app, cookie);
    const page = await callToolJson<{ id: string }>(app, secret, "create_page", {});

    const result = await callTool(app, secret, "add_layer", {
      kind: "text",
      pageId: page.id,
      properties: { opacity: 4 },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("opacity");
  });

  it("scopes tools to the token's account", async () => {
    const app = await createTestApp();
    const ada = await createToken(app, await registerAccount(app, "ada@example.com"));
    const grace = await createToken(app, await registerAccount(app, "grace@example.com"));
    const page = await callToolJson<{ id: string }>(app, ada.secret, "create_page", {
      title: "Private",
    });

    const pages = await callToolJson<{ pages: unknown[] }>(app, grace.secret, "list_pages");
    const lookup = await callTool(app, grace.secret, "get_page", { pageId: page.id });

    expect(pages.pages).toEqual([]);
    expect(lookup.isError).toBe(true);
    expect(lookup.content[0]?.text).toContain("was not found");
  });
});
