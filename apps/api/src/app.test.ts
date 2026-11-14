import { mkdtempSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assetResponseSchema,
  authSessionResponseSchema,
  bookResponseSchema,
  customBackgroundListResponseSchema,
  customBackgroundResponseSchema,
  customWashiTapeListResponseSchema,
  customWashiTapeResponseSchema,
  exportJobResponseSchema,
  healthResponseSchema,
  pageResponseSchema,
  serverLogListResponseSchema,
  systemInfoResponseSchema,
} from "@zakka/api-contract";
import { createPageDocument, createPhotoLayer, createTextLayer } from "@zakka/editor-core";
import { makeFixedClock } from "@zakka/test-utils";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { createDatabaseConnection, type DatabaseConnection } from "./persistence/database.js";
import { runMigrations } from "./persistence/migrations.js";
import { createPageDocumentStore } from "./persistence/page-documents.js";
import { createRepositories } from "./persistence/repositories.js";
import { createDiskStorage } from "./storage/disk.js";

const connections: DatabaseConnection[] = [];
const tempDirs: string[] = [];
const fixedDate = new Date("2026-05-17T12:00:00.000Z");

const createTestApp = () => {
  const connection = createDatabaseConnection({ databasePath: ":memory:" });
  const rootDir = mkdtempSync(join(tmpdir(), "scrapbook-api-"));
  const pageDocuments = createPageDocumentStore({ rootDir });

  connections.push(connection);
  tempDirs.push(rootDir);
  runMigrations(connection.sqlite);

  return createApp({
    clock: makeFixedClock(fixedDate),
    repositories: createRepositories(connection.db, {
      clock: makeFixedClock(fixedDate),
      pageDocuments,
    }),
  });
};

const createTestAppWithStorage = async () => {
  const connection = createDatabaseConnection({ databasePath: ":memory:" });
  const rootDir = await mkdtemp(join(tmpdir(), "scrapbook-api-assets-"));
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

const postJson = (
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  cookie?: string,
) =>
  app.request(path, {
    body: JSON.stringify(body),
    headers: {
      ...(cookie ? { cookie } : {}),
      "content-type": "application/json",
    },
    method: "POST",
  });

const registerAccount = async (
  app: ReturnType<typeof createApp>,
  input: { displayName: string; email: string },
): Promise<string> => {
  const response = await postJson(app, "/api/v1/auth/register", {
    ...input,
    password: "correct horse battery staple",
  });

  expect(response.status).toBe(201);

  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
};

const createPng = (): Promise<Buffer> =>
  sharp({
    create: {
      background: { alpha: 1, b: 90, g: 160, r: 210 },
      channels: 4,
      height: 16,
      width: 24,
    },
  })
    .png()
    .toBuffer();

const createHeic = (): Buffer =>
  Buffer.from(
    [
      "AAAAGGZ0eXBoZWljAAAAAGhlaWNtaWYxAAAB7G1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAA",
      "AAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEA",
      "AAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABpp",
      "cmVmAAAAAAAAAA5jZHNjAAIAAQABAAABD2lwcnAAAADtaXBjbwAAABNjb2xybmNseAACAAIABoAAAAAM",
      "Y2xsaQDLAEAAAAAUaXNwZQAAAAAAAAAMAAAACgAAAChjbGFwAAAADAAAAAEAAAAJAAAAAQAAAAAAAAAB",
      "/8AAAACAAAAAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcWh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4",
      "AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAI0IBAQNwAAADALAAAAMAAAMAHqAUIEHA",
      "lw5iHuRZVNwICBgCogABAAlEAcBhcshEU2QAAAAaaXBtYQAAAAAAAAABAAEHgQIDBoeEhQAAACxpbG9j",
      "AAAAAEQAAAIAAQAAAAEAAAJgAAAAUAACAAAAAQAAAhQAAABMAAAAAW1kYXQAAAAAAAAArAAAAAZFeGlm",
      "AABNTQAqAAAACAADARoABQAAAAEAAAAyARsABQAAAAEAAAA6ASgAAwAAAAEAAgAAAAAAAAAAABkAAAAB",
      "AAAAGQAAAAEAAABMKAGvo2MaYiP1H/7T9lW5yJFB0bfdB59DFNqitGvl+is14NCz4J1eZPfCbwd97Kyr",
      "/QbEmTHgyBrtqYfta7a8U9/7jPch6LGnrxtCYA==",
    ].join(""),
    "base64",
  );

const createHeif = (): Buffer => {
  const buffer = createHeic();
  buffer.write("mif1", 8, 4, "ascii");
  buffer.write("mif1", 16, 4, "ascii");
  return buffer;
};

const createTiff = (): Promise<Buffer> =>
  sharp({
    create: {
      background: { b: 60, g: 140, r: 220 },
      channels: 3,
      height: 18,
      width: 24,
    },
  })
    .tiff({ compression: "none" })
    .toBuffer();

const createJpegWithExif = (input: {
  dateTimeOriginal?: string;
  offsetTimeOriginal?: string;
  make?: string;
  model?: string;
  lensModel?: string;
  iso?: string;
  fNumber?: string;
  exposureTime?: string;
  focalLength?: string;
  focalLengthIn35mmFormat?: string;
  orientation?: string;
}): Promise<Buffer> => {
  const ifd0: Record<string, string> = {};
  const ifd2: Record<string, string> = {};

  if (input.make) ifd0.Make = input.make;
  if (input.model) ifd0.Model = input.model;
  if (input.orientation) ifd0.Orientation = input.orientation;

  if (input.dateTimeOriginal) ifd2.DateTimeOriginal = input.dateTimeOriginal;
  if (input.offsetTimeOriginal) ifd2.OffsetTimeOriginal = input.offsetTimeOriginal;
  if (input.lensModel) ifd2.LensModel = input.lensModel;
  if (input.iso) ifd2.ISOSpeedRatings = input.iso;
  if (input.fNumber) ifd2.FNumber = input.fNumber;
  if (input.exposureTime) ifd2.ExposureTime = input.exposureTime;
  if (input.focalLength) ifd2.FocalLength = input.focalLength;
  if (input.focalLengthIn35mmFormat) ifd2.FocalLengthIn35mmFilm = input.focalLengthIn35mmFormat;

  const exif: Record<string, Record<string, string>> = {};
  if (Object.keys(ifd0).length > 0) exif.IFD0 = ifd0;
  if (Object.keys(ifd2).length > 0) exif.IFD2 = ifd2;

  return sharp({
    create: {
      background: { b: 60, g: 140, r: 220 },
      channels: 3,
      height: 16,
      width: 24,
    },
  })
    .withExif(exif)
    .jpeg()
    .toBuffer();
};

const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

const uploadImage = async (app: ReturnType<typeof createApp>, cookie: string, file: File) => {
  const form = new FormData();
  form.set("file", file);

  return app.request("/api/v1/assets/uploads", {
    body: form,
    headers: { cookie },
    method: "POST",
  });
};

afterEach(() => {
  for (const connection of connections.splice(0)) {
    connection.close();
  }
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("api app", () => {
  it("serves the health endpoint", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();

    const body = healthResponseSchema.parse(await response.json());

    expect(body.status).toBe("ok");
    expect(body.service).toBe("zakka-api");
  });

  it("uses the shared error envelope for missing routes", async () => {
    const app = createApp();
    const response = await app.request("/missing");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: {
        code: "not_found",
        message: "Route not found",
      },
    });
  });

  it("registers an account and serves the current browser session", async () => {
    const app = createTestApp();
    const registerResponse = await postJson(app, "/api/v1/auth/register", {
      displayName: "Ada Lovelace",
      email: "Ada@example.com",
      password: "correct horse battery staple",
    });

    expect(registerResponse.status).toBe(201);
    const cookie = registerResponse.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toMatch(/^scrapbook_session=/);

    const registerBody = authSessionResponseSchema.parse(await registerResponse.json());

    expect(registerBody.account).toMatchObject({
      displayName: "Ada Lovelace",
      primaryEmail: "ada@example.com",
    });

    const sessionResponse = await app.request("/api/v1/auth/session", {
      headers: { cookie: cookie ?? "" },
    });

    expect(sessionResponse.status).toBe(200);
    expect(authSessionResponseSchema.parse(await sessionResponse.json()).session.id).toBe(
      registerBody.session.id,
    );
  });

  it("uses non-secure session cookies for local HTTP requests", async () => {
    const app = createTestApp();
    const registerResponse = await postJson(app, "/api/v1/auth/register", {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct horse battery staple",
    });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.headers.get("set-cookie")).not.toContain("; Secure");
  });

  it("uses secure session cookies for proxied HTTPS requests", async () => {
    const app = createTestApp();
    const registerResponse = await app.request("/api/v1/auth/register", {
      body: JSON.stringify({
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        password: "correct horse battery staple",
      }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
      },
      method: "POST",
    });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.headers.get("set-cookie")).toContain("; Secure");
  });

  it("allows session cookie security to be explicitly overridden", async () => {
    const connection = createDatabaseConnection({ databasePath: ":memory:" });
    const rootDir = mkdtempSync(join(tmpdir(), "scrapbook-api-"));
    const pageDocuments = createPageDocumentStore({ rootDir });

    connections.push(connection);
    tempDirs.push(rootDir);
    runMigrations(connection.sqlite);

    const app = createApp({
      clock: makeFixedClock(fixedDate),
      repositories: createRepositories(connection.db, {
        clock: makeFixedClock(fixedDate),
        pageDocuments,
      }),
      sessionCookieSecure: false,
    });
    const registerResponse = await app.request("/api/v1/auth/register", {
      body: JSON.stringify({
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        password: "correct horse battery staple",
      }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
      },
      method: "POST",
    });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.headers.get("set-cookie")).not.toContain("; Secure");
  });

  it("logs in, rejects duplicate registration, and logs out", async () => {
    const app = createTestApp();
    await postJson(app, "/api/v1/auth/register", {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct horse battery staple",
    });

    const duplicateResponse = await postJson(app, "/api/v1/auth/register", {
      displayName: "Ada Lovelace",
      email: "ADA@example.com",
      password: "correct horse battery staple",
    });
    const badLoginResponse = await postJson(app, "/api/v1/auth/login", {
      email: "ada@example.com",
      password: "incorrect password",
    });
    const loginResponse = await postJson(app, "/api/v1/auth/login", {
      email: "ada@example.com",
      password: "correct horse battery staple",
    });

    expect(duplicateResponse.status).toBe(409);
    expect(badLoginResponse.status).toBe(401);
    expect(loginResponse.status).toBe(200);

    const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0] ?? "";
    const logoutResponse = await postJson(app, "/api/v1/auth/logout", {}, cookie);
    const sessionResponse = await app.request("/api/v1/auth/session", {
      headers: { cookie },
    });

    expect(logoutResponse.status).toBe(204);
    expect(sessionResponse.status).toBe(401);
  });

  it("lists recent server logs by minimum verbosity", async () => {
    const app = createTestApp();
    const cookie = await registerAccount(app, {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    });

    const listResponse = await app.request("/api/v1/pages", { headers: { cookie } });
    const missingResponse = await app.request("/api/v1/pages/missing", { headers: { cookie } });
    const logsResponse = await app.request("/api/v1/logs?level=warn", { headers: { cookie } });

    expect(listResponse.status).toBe(200);
    expect(missingResponse.status).toBe(404);
    expect(logsResponse.status).toBe(200);

    const body = serverLogListResponseSchema.parse(await logsResponse.json());

    expect(body.level).toBe("warn");
    expect(body.logs).toEqual([
      expect.objectContaining({
        level: "warn",
        method: "GET",
        path: "/api/v1/pages/missing",
        status: 404,
      }),
    ]);
  });

  it("stores the UI theme preference per account", async () => {
    const app = createTestApp();
    const cookie = await registerAccount(app, {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    });
    const otherCookie = await registerAccount(app, {
      displayName: "Grace Hopper",
      email: "grace@example.com",
    });
    const patchPreferences = (body: unknown, sessionCookie: string) =>
      app.request("/api/v1/account/preferences", {
        body: JSON.stringify(body),
        headers: { cookie: sessionCookie, "content-type": "application/json" },
        method: "PATCH",
      });

    const unauthenticatedResponse = await app.request("/api/v1/account/preferences");
    const defaultResponse = await app.request("/api/v1/account/preferences", {
      headers: { cookie },
    });
    const invalidResponse = await patchPreferences({ uiTheme: "neon" }, cookie);
    const patchResponse = await patchPreferences({ uiTheme: "sakura" }, cookie);
    const emptyPatchResponse = await patchPreferences({}, cookie);
    const reloadedResponse = await app.request("/api/v1/account/preferences", {
      headers: { cookie },
    });
    const otherAccountResponse = await app.request("/api/v1/account/preferences", {
      headers: { cookie: otherCookie },
    });

    expect(unauthenticatedResponse.status).toBe(401);
    expect(await defaultResponse.json()).toEqual({ uiTheme: "system" });
    expect(invalidResponse.status).toBe(400);
    expect(patchResponse.status).toBe(200);
    expect(await patchResponse.json()).toEqual({ uiTheme: "sakura" });
    expect(await emptyPatchResponse.json()).toEqual({ uiTheme: "sakura" });
    expect(await reloadedResponse.json()).toEqual({ uiTheme: "sakura" });
    expect(await otherAccountResponse.json()).toEqual({ uiTheme: "system" });
  });

  it("reports system info with uptime to authenticated users", async () => {
    let now = fixedDate.getTime();
    const connection = createDatabaseConnection({ databasePath: ":memory:" });
    const rootDir = mkdtempSync(join(tmpdir(), "scrapbook-api-"));

    connections.push(connection);
    tempDirs.push(rootDir);
    runMigrations(connection.sqlite);

    const clock = () => new Date(now);
    const app = createApp({
      clock,
      repositories: createRepositories(connection.db, {
        clock,
        pageDocuments: createPageDocumentStore({ rootDir }),
      }),
    });

    const unauthenticatedResponse = await app.request("/api/v1/system/info");
    expect(unauthenticatedResponse.status).toBe(401);

    const cookie = await registerAccount(app, {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    });
    now += 90_500;

    const response = await app.request("/api/v1/system/info", { headers: { cookie } });
    expect(response.status).toBe(200);

    const body = systemInfoResponseSchema.parse(await response.json());
    expect(body).toMatchObject({
      service: "zakka-api",
      startedAt: fixedDate.toISOString(),
      uptimeSeconds: 90,
      nodeVersion: process.version,
    });
  });

  it("uploads images, stores metadata, lists assets, and streams original and variants", async () => {
    const app = await createTestAppWithStorage();
    const cookie = await registerAccount(app, {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    });
    const image = await createPng();
    const uploadResponse = await uploadImage(
      app,
      cookie,
      new File([toArrayBuffer(image)], "family.png", { type: "image/png" }),
    );

    expect(uploadResponse.status).toBe(201);

    const uploaded = assetResponseSchema.parse(await uploadResponse.json());

    expect(uploaded).toMatchObject({
      originalFilename: "family.png",
      mimeType: "image/png",
      byteSize: image.byteLength,
      width: 24,
      height: 16,
    });
    const thumbnail = uploaded.variants.find((variant) => variant.kind === "thumbnail");
    const preview = uploaded.variants.find((variant) => variant.kind === "preview");

    if (!thumbnail || !preview) {
      throw new Error("Expected thumbnail and preview variants");
    }

    expect(uploaded.thumbnailUrl).toBe(`/api/v1/assets/${uploaded.id}/variants/${thumbnail.id}`);
    expect(uploaded.variants).toHaveLength(2);
    expect(preview).toMatchObject({
      height: 16,
      kind: "preview",
      mimeType: "image/png",
      width: 24,
    });

    const listResponse = await app.request("/api/v1/assets", { headers: { cookie } });
    const detailResponse = await app.request(`/api/v1/assets/${uploaded.id}`, {
      headers: { cookie },
    });
    const originalResponse = await app.request(`/api/v1/assets/${uploaded.id}/content`, {
      headers: { cookie },
    });
    const thumbnailResponse = await app.request(
      `/api/v1/assets/${uploaded.id}/variants/${thumbnail.id}`,
      { headers: { cookie } },
    );
    const previewResponse = await app.request(
      `/api/v1/assets/${uploaded.id}/variants/${preview.id}`,
      { headers: { cookie } },
    );

    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).assets).toHaveLength(1);
    expect(detailResponse.status).toBe(200);
    expect((await detailResponse.json()).id).toBe(uploaded.id);
    expect(originalResponse.status).toBe(200);
    expect(originalResponse.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await originalResponse.arrayBuffer())).toEqual(image);
    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await thumbnailResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await previewResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("uploads HEIC images and creates browser-readable variants", async () => {
    const app = await createTestAppWithStorage();
    const cookie = await registerAccount(app, {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    });
    const image = createHeic();
    const uploadResponse = await uploadImage(
      app,
      cookie,
      new File([toArrayBuffer(image)], "family.heic", { type: "image/heic" }),
    );

    expect(uploadResponse.status).toBe(201);

    const uploaded = assetResponseSchema.parse(await uploadResponse.json());

    expect(uploaded).toMatchObject({
      originalFilename: "family.heic",
      mimeType: "image/heic",
      byteSize: image.byteLength,
      width: 12,
      height: 9,
    });

    const thumbnail = uploaded.variants.find((variant) => variant.kind === "thumbnail");
    const preview = uploaded.variants.find((variant) => variant.kind === "preview");

    if (!thumbnail || !preview) {
      throw new Error("Expected thumbnail and preview variants");
    }

    expect(uploaded.variants).toHaveLength(2);
    expect(preview).toMatchObject({
      height: 9,
      kind: "preview",
      mimeType: "image/jpeg",
      width: 12,
    });

    const originalResponse = await app.request(`/api/v1/assets/${uploaded.id}/content`, {
      headers: { cookie },
    });
    const thumbnailResponse = await app.request(
      `/api/v1/assets/${uploaded.id}/variants/${thumbnail.id}`,
      { headers: { cookie } },
    );
    const previewResponse = await app.request(
      `/api/v1/assets/${uploaded.id}/variants/${preview.id}`,
      { headers: { cookie } },
    );

    expect(originalResponse.status).toBe(200);
    expect(originalResponse.headers.get("content-type")).toBe("image/heic");
    expect(Buffer.from(await originalResponse.arrayBuffer())).toEqual(image);
    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await thumbnailResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await previewResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("uploads HEIF images and creates browser-readable variants", async () => {
    const app = await createTestAppWithStorage();
    const cookie = await registerAccount(app, {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    });
    const image = createHeif();
    const uploadResponse = await uploadImage(
      app,
      cookie,
      new File([toArrayBuffer(image)], "family.heif", { type: "image/heif" }),
    );

    expect(uploadResponse.status).toBe(201);

    const uploaded = assetResponseSchema.parse(await uploadResponse.json());

    expect(uploaded).toMatchObject({
      originalFilename: "family.heif",
      mimeType: "image/heif",
      byteSize: image.byteLength,
      width: 12,
      height: 9,
    });

    const originalResponse = await app.request(`/api/v1/assets/${uploaded.id}/content`, {
      headers: { cookie },
    });

    expect(originalResponse.status).toBe(200);
    expect(originalResponse.headers.get("content-type")).toBe("image/heif");
    expect(Buffer.from(await originalResponse.arrayBuffer())).toEqual(image);
  });

  it("uploads TIFF/DNG-family images and creates browser-readable variants", async () => {
    const app = await createTestAppWithStorage();
    const cookie = await registerAccount(app, {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    });
    const image = await createTiff();
    const uploadResponse = await uploadImage(
      app,
      cookie,
      new File([toArrayBuffer(image)], "IMG_2807.raw", { type: "" }),
    );

    expect(uploadResponse.status).toBe(201);

    const uploaded = assetResponseSchema.parse(await uploadResponse.json());

    expect(uploaded).toMatchObject({
      originalFilename: "IMG_2807.raw",
      mimeType: "image/tiff",
      byteSize: image.byteLength,
      width: 24,
      height: 18,
    });

    const thumbnail = uploaded.variants.find((variant) => variant.kind === "thumbnail");
    const preview = uploaded.variants.find((variant) => variant.kind === "preview");

    if (!thumbnail || !preview) {
      throw new Error("Expected thumbnail and preview variants");
    }

    const originalResponse = await app.request(`/api/v1/assets/${uploaded.id}/content`, {
      headers: { cookie },
    });
    const thumbnailResponse = await app.request(
      `/api/v1/assets/${uploaded.id}/variants/${thumbnail.id}`,
      { headers: { cookie } },
    );
    const previewResponse = await app.request(
      `/api/v1/assets/${uploaded.id}/variants/${preview.id}`,
      { headers: { cookie } },
    );

    expect(originalResponse.status).toBe(200);
    expect(originalResponse.headers.get("content-type")).toBe("image/tiff");
    expect(Buffer.from(await originalResponse.arrayBuffer())).toEqual(image);
    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await thumbnailResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await previewResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("extracts EXIF date taken from uploaded photos", async () => {
    const app = await createTestAppWithStorage();
    const cookie = await registerAccount(app, {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    });

    const withExif = await createJpegWithExif({
      dateTimeOriginal: "2024:03:14 09:26:53",
      offsetTimeOriginal: "+00:00",
      make: "Canon",
      model: "EOS R5",
      lensModel: "RF 24-70mm F2.8 L IS USM",
      iso: "400",
      fNumber: "2.8",
      exposureTime: "1/250",
      focalLength: "50",
      focalLengthIn35mmFormat: "50",
      orientation: "1",
    });
    const withExifResponse = await uploadImage(
      app,
      cookie,
      new File([toArrayBuffer(withExif)], "trip.jpg", { type: "image/jpeg" }),
    );

    expect(withExifResponse.status).toBe(201);

    const withExifAsset = assetResponseSchema.parse(await withExifResponse.json());

    expect(withExifAsset.dateTaken).toBe("2024-03-14T09:26:53.000Z");
    expect(withExifAsset.cameraMake).toBe("Canon");
    expect(withExifAsset.cameraModel).toBe("EOS R5");
    expect(withExifAsset.lensModel).toBe("RF 24-70mm F2.8 L IS USM");
    expect(withExifAsset.isoSpeed).toBe(400);
    expect(withExifAsset.fNumber).toBeCloseTo(2.8, 1);
    expect(withExifAsset.exposureTimeSeconds).toBeCloseTo(1 / 250, 5);
    expect(withExifAsset.focalLengthMm).toBeCloseTo(50, 1);
    expect(withExifAsset.focalLength35mmMm).toBe(50);
    expect(withExifAsset.orientation).toBe(1);
    expect(withExifAsset.gpsLatitude).toBeNull();
    expect(withExifAsset.gpsLongitude).toBeNull();

    const withoutExif = await createPng();
    const withoutExifResponse = await uploadImage(
      app,
      cookie,
      new File([toArrayBuffer(withoutExif)], "plain.png", { type: "image/png" }),
    );

    expect(withoutExifResponse.status).toBe(201);

    const withoutExifAsset = assetResponseSchema.parse(await withoutExifResponse.json());

    expect(withoutExifAsset.dateTaken).toBeNull();
    expect(withoutExifAsset.cameraMake).toBeNull();
    expect(withoutExifAsset.isoSpeed).toBeNull();
    expect(withoutExifAsset.gpsLatitude).toBeNull();
  });

  it("rejects invalid uploads with documented errors", async () => {
    const app = await createTestAppWithStorage();
    const cookie = await registerAccount(app, {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    });
    const response = await uploadImage(
      app,
      cookie,
      new File([Buffer.from("not an image")], "notes.txt", { type: "text/plain" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "invalid_image",
      },
    });
  });

  it("keeps asset library routes scoped to the authenticated account", async () => {
    const app = await createTestAppWithStorage();
    const firstCookie = await registerAccount(app, {
      displayName: "First",
      email: "first@example.com",
    });
    const secondCookie = await registerAccount(app, {
      displayName: "Second",
      email: "second@example.com",
    });
    const image = await createPng();
    const uploadResponse = await uploadImage(
      app,
      firstCookie,
      new File([toArrayBuffer(image)], "first.png", { type: "image/png" }),
    );
    const uploaded = await uploadResponse.json();

    const secondListResponse = await app.request("/api/v1/assets", {
      headers: { cookie: secondCookie },
    });
    const secondDetailResponse = await app.request(`/api/v1/assets/${uploaded.id}`, {
      headers: { cookie: secondCookie },
    });
    const secondContentResponse = await app.request(`/api/v1/assets/${uploaded.id}/content`, {
      headers: { cookie: secondCookie },
    });

    expect(secondListResponse.status).toBe(200);
    expect((await secondListResponse.json()).assets).toEqual([]);
    expect(secondDetailResponse.status).toBe(404);
    expect(secondContentResponse.status).toBe(404);
  });

  it("creates, updates, duplicates, deletes, and reopens page documents", async () => {
    const app = createTestApp();
    const cookie = await registerAccount(app, {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    });
    const document = createPageDocument({
      layers: [createTextLayer({ id: "text_1", text: "First page" })],
    });

    const createResponse = await postJson(
      app,
      "/api/v1/pages",
      {
        title: "Summer cover",
        document,
      },
      cookie,
    );

    expect(createResponse.status).toBe(201);

    const created = pageResponseSchema.parse(await createResponse.json());
    const patchedDocument = createPageDocument({
      canvas: { width: 1800, height: 1800, backgroundColor: "#ffffff" },
      layers: [createTextLayer({ id: "text_2", text: "Updated caption", x: 320 })],
    });
    const patchResponse = await app.request(`/api/v1/pages/${created.id}`, {
      body: JSON.stringify({ title: "Updated cover", document: patchedDocument }),
      headers: { cookie, "content-type": "application/json" },
      method: "PATCH",
    });
    const listResponse = await app.request("/api/v1/pages", { headers: { cookie } });
    const detailResponse = await app.request(`/api/v1/pages/${created.id}`, {
      headers: { cookie },
    });
    const duplicateResponse = await postJson(
      app,
      `/api/v1/pages/${created.id}/duplicate`,
      { title: "Updated cover copy" },
      cookie,
    );
    const deleteResponse = await app.request(`/api/v1/pages/${created.id}`, {
      headers: { cookie },
      method: "DELETE",
    });
    const deletedDetailResponse = await app.request(`/api/v1/pages/${created.id}`, {
      headers: { cookie },
    });

    expect(patchResponse.status).toBe(200);
    expect(pageResponseSchema.parse(await patchResponse.json())).toMatchObject({
      title: "Updated cover",
      width: 1800,
      height: 1800,
      document: {
        canvas: { backgroundColor: "#ffffff" },
        layers: [{ id: "text_2", text: "Updated caption" }],
      },
    });
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).pages).toHaveLength(1);
    expect(detailResponse.status).toBe(200);
    expect(pageResponseSchema.parse(await detailResponse.json()).document.layers[0]?.id).toBe(
      "text_2",
    );
    expect(duplicateResponse.status).toBe(201);
    expect(pageResponseSchema.parse(await duplicateResponse.json()).title).toBe(
      "Updated cover copy",
    );
    expect(deleteResponse.status).toBe(204);
    expect(deletedDetailResponse.status).toBe(404);
  });

  it("keeps page routes and photo layer references scoped to the authenticated account", async () => {
    const app = await createTestAppWithStorage();
    const firstCookie = await registerAccount(app, {
      displayName: "First",
      email: "first-pages@example.com",
    });
    const secondCookie = await registerAccount(app, {
      displayName: "Second",
      email: "second-pages@example.com",
    });
    const image = await createPng();
    const uploadResponse = await uploadImage(
      app,
      firstCookie,
      new File([toArrayBuffer(image)], "first.png", { type: "image/png" }),
    );
    const uploaded = await uploadResponse.json();
    const firstPageResponse = await postJson(
      app,
      "/api/v1/pages",
      {
        title: "First page",
        document: createPageDocument({
          layers: [createPhotoLayer({ id: "photo_1", assetId: uploaded.id })],
        }),
      },
      firstCookie,
    );
    const firstPage = pageResponseSchema.parse(await firstPageResponse.json());

    const secondListResponse = await app.request("/api/v1/pages", {
      headers: { cookie: secondCookie },
    });
    const secondDetailResponse = await app.request(`/api/v1/pages/${firstPage.id}`, {
      headers: { cookie: secondCookie },
    });
    const crossAccountAssetResponse = await postJson(
      app,
      "/api/v1/pages",
      {
        title: "Cross account page",
        document: createPageDocument({
          layers: [createPhotoLayer({ id: "photo_2", assetId: uploaded.id })],
        }),
      },
      secondCookie,
    );

    expect(secondListResponse.status).toBe(200);
    expect((await secondListResponse.json()).pages).toEqual([]);
    expect(secondDetailResponse.status).toBe(404);
    expect(crossAccountAssetResponse.status).toBe(400);
    expect(await crossAccountAssetResponse.json()).toMatchObject({
      error: { code: "page_asset_not_found" },
    });
  });

  it("creates books, orders pages into spreads, and rejects cross-account pages", async () => {
    const app = createTestApp();
    const firstCookie = await registerAccount(app, {
      displayName: "First",
      email: "first-books@example.com",
    });
    const secondCookie = await registerAccount(app, {
      displayName: "Second",
      email: "second-books@example.com",
    });
    const pageResponses = await Promise.all(
      ["First", "Second", "Third"].map((title) =>
        postJson(app, "/api/v1/pages", { title }, firstCookie),
      ),
    );
    const pages = await Promise.all(
      pageResponses.map(async (response) => pageResponseSchema.parse(await response.json())),
    );
    const secondPageResponse = await postJson(
      app,
      "/api/v1/pages",
      { title: "Other account" },
      secondCookie,
    );
    const secondPage = pageResponseSchema.parse(await secondPageResponse.json());
    const createBookResponse = await postJson(
      app,
      "/api/v1/books",
      { title: "Family book", pageWidth: 2400, pageHeight: 2400 },
      firstCookie,
    );

    expect(createBookResponse.status).toBe(201);

    const createdBook = bookResponseSchema.parse(await createBookResponse.json());
    expect(createdBook).toMatchObject({
      pageCount: 2,
      spreadCount: 1,
      coverSpreadEnabled: true,
    });
    expect(createdBook.pages.map((bookPage) => bookPage.page.title)).toEqual([
      "Front cover",
      "Back cover",
    ]);
    expect(createdBook.spreads).toMatchObject([
      {
        kind: "facing",
        leftPageId: createdBook.pages[0]?.pageId,
        rightPageId: createdBook.pages[1]?.pageId,
      },
    ]);
    const orderedResponse = await app.request(`/api/v1/books/${createdBook.id}/pages`, {
      body: JSON.stringify({ pageIds: pages.map((page) => page.id) }),
      headers: { cookie: firstCookie, "content-type": "application/json" },
      method: "PUT",
    });
    const orderedBook = bookResponseSchema.parse(await orderedResponse.json());
    const detailResponse = await app.request(`/api/v1/books/${createdBook.id}`, {
      headers: { cookie: firstCookie },
    });
    const resizedResponse = await app.request(`/api/v1/books/${createdBook.id}`, {
      body: JSON.stringify({ pageWidth: 3300, pageHeight: 2550, coverSpreadEnabled: false }),
      headers: { cookie: firstCookie, "content-type": "application/json" },
      method: "PATCH",
    });
    const resizedBook = bookResponseSchema.parse(await resizedResponse.json());
    const secondDetailResponse = await app.request(`/api/v1/books/${createdBook.id}`, {
      headers: { cookie: secondCookie },
    });
    const crossAccountPageResponse = await app.request(`/api/v1/books/${createdBook.id}/pages`, {
      body: JSON.stringify({ pageIds: [pages[0]?.id, secondPage.id] }),
      headers: { cookie: firstCookie, "content-type": "application/json" },
      method: "PUT",
    });
    const crossAccountDeleteResponse = await app.request(`/api/v1/books/${createdBook.id}`, {
      headers: { cookie: secondCookie },
      method: "DELETE",
    });
    const deleteResponse = await app.request(`/api/v1/books/${createdBook.id}`, {
      headers: { cookie: firstCookie },
      method: "DELETE",
    });
    const deletedDetailResponse = await app.request(`/api/v1/books/${createdBook.id}`, {
      headers: { cookie: firstCookie },
    });
    const retainedPageResponse = await app.request(`/api/v1/pages/${pages[0]?.id}`, {
      headers: { cookie: firstCookie },
    });

    expect(orderedResponse.status).toBe(200);
    expect(createdBook).toMatchObject({ pageWidth: 2400, pageHeight: 2400 });
    expect(orderedBook.pages.map((bookPage) => bookPage.page.title)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
    expect(orderedBook.spreads).toMatchObject([
      { kind: "facing", leftPageId: pages[0]?.id, rightPageId: pages[2]?.id },
      { kind: "single", leftPageId: pages[1]?.id, rightPageId: null },
    ]);
    expect(detailResponse.status).toBe(200);
    expect(bookResponseSchema.parse(await detailResponse.json()).pageCount).toBe(3);
    expect(resizedResponse.status).toBe(200);
    expect(resizedBook).toMatchObject({
      coverSpreadEnabled: false,
      pageWidth: 3300,
      pageHeight: 2550,
    });
    expect(resizedBook.spreads).toMatchObject([
      { kind: "single", leftPageId: pages[0]?.id, rightPageId: null },
      { kind: "single", leftPageId: pages[1]?.id, rightPageId: null },
      { kind: "single", leftPageId: pages[2]?.id, rightPageId: null },
    ]);
    expect(secondDetailResponse.status).toBe(404);
    expect(crossAccountPageResponse.status).toBe(400);
    expect(crossAccountDeleteResponse.status).toBe(404);
    expect(deleteResponse.status).toBe(204);
    expect(deletedDetailResponse.status).toBe(404);
    expect(retainedPageResponse.status).toBe(200);
  });

  it("creates page and book exports and streams completed output", async () => {
    const app = await createTestAppWithStorage();
    const firstCookie = await registerAccount(app, {
      displayName: "First",
      email: "first-exports@example.com",
    });
    const secondCookie = await registerAccount(app, {
      displayName: "Second",
      email: "second-exports@example.com",
    });
    const firstPageResponse = await postJson(
      app,
      "/api/v1/pages",
      {
        title: "Exportable page",
        document: createPageDocument({
          layers: [createTextLayer({ id: "export_text", text: "Ready to print" })],
        }),
      },
      firstCookie,
    );
    const secondPageResponse = await postJson(
      app,
      "/api/v1/pages",
      { title: "Private page" },
      secondCookie,
    );
    const page = pageResponseSchema.parse(await firstPageResponse.json());
    const secondPage = pageResponseSchema.parse(await secondPageResponse.json());
    const pageExportResponse = await postJson(
      app,
      "/api/v1/exports",
      { pageId: page.id, format: "png", preset: "digital" },
      firstCookie,
    );
    const pageExport = exportJobResponseSchema.parse(await pageExportResponse.json());
    const contentResponse = await app.request(`/api/v1/exports/${pageExport.id}/content`, {
      headers: { cookie: firstCookie },
    });
    const secondContentResponse = await app.request(`/api/v1/exports/${pageExport.id}/content`, {
      headers: { cookie: secondCookie },
    });
    const crossAccountExportResponse = await postJson(
      app,
      "/api/v1/exports",
      { pageId: secondPage.id, format: "png", preset: "digital" },
      firstCookie,
    );
    const bookResponse = await postJson(
      app,
      "/api/v1/books",
      { title: "Export book" },
      firstCookie,
    );
    const book = bookResponseSchema.parse(await bookResponse.json());

    await app.request(`/api/v1/books/${book.id}/pages`, {
      body: JSON.stringify({ pageIds: [page.id] }),
      headers: { cookie: firstCookie, "content-type": "application/json" },
      method: "PUT",
    });

    const bookPngExportResponse = await postJson(
      app,
      "/api/v1/exports",
      { bookId: book.id, format: "png", preset: "print" },
      firstCookie,
    );
    const bookPngExport = exportJobResponseSchema.parse(await bookPngExportResponse.json());
    const bookPngContentResponse = await app.request(
      `/api/v1/exports/${bookPngExport.id}/content`,
      {
        headers: { cookie: firstCookie },
      },
    );
    const bookPdfExportResponse = await postJson(
      app,
      "/api/v1/exports",
      { bookId: book.id, format: "pdf", preset: "print" },
      firstCookie,
    );
    const bookPdfExport = exportJobResponseSchema.parse(await bookPdfExportResponse.json());
    const bookPdfContentResponse = await app.request(
      `/api/v1/exports/${bookPdfExport.id}/content`,
      {
        headers: { cookie: firstCookie },
      },
    );

    expect(pageExportResponse.status).toBe(201);
    expect(pageExport).toMatchObject({ status: "completed", targetKind: "page" });
    expect(pageExport.outputContentUrl).toBe(`/api/v1/exports/${pageExport.id}/content`);
    expect(contentResponse.status).toBe(200);
    expect(contentResponse.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await contentResponse.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect(secondContentResponse.status).toBe(404);
    expect(crossAccountExportResponse.status).toBe(404);
    expect(bookPngExportResponse.status).toBe(201);
    expect(bookPngExport).toMatchObject({ format: "png", preset: "print", targetKind: "book" });
    expect(bookPngContentResponse.status).toBe(200);
    expect(bookPngContentResponse.headers.get("content-type")).toBe("application/zip");
    expect(bookPngContentResponse.headers.get("content-disposition")).toContain(
      "export-book-png-pages.zip",
    );
    expect(Buffer.from(await bookPngContentResponse.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect(bookPdfExportResponse.status).toBe(201);
    expect(bookPdfExport).toMatchObject({ format: "pdf", preset: "print", targetKind: "book" });
    expect(bookPdfContentResponse.status).toBe(200);
    expect(bookPdfContentResponse.headers.get("content-type")).toBe("application/pdf");
    expect(
      Buffer.from(await bookPdfContentResponse.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
  });

  it("persists non-destructive photo edits without mutating original assets", async () => {
    const app = await createTestAppWithStorage();
    const cookie = await registerAccount(app, {
      displayName: "Ada Lovelace",
      email: "ada-edits@example.com",
    });
    const image = await createPng();
    const uploadResponse = await uploadImage(
      app,
      cookie,
      new File([toArrayBuffer(image)], "editable.png", { type: "image/png" }),
    );
    const uploaded = await uploadResponse.json();
    const editedPhoto = createPhotoLayer({
      id: "photo_edit_1",
      assetId: uploaded.id,
      crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8, aspectRatioPreset: "square" },
      photoTransform: {
        scale: 1.4,
        rotation: 12,
        flipX: true,
        flipY: false,
        offsetX: 0.15,
        offsetY: -0.1,
      },
      border: {
        width: 18,
        color: "#ffffff",
        radius: 28,
        style: "solid",
        framePreset: "mat",
      },
      mask: { shape: "diamond", inset: 0.02, feather: 4 },
      filter: { preset: "sepia", brightness: 1.05, contrast: 1.1, saturation: 0.8 },
      shadow: {
        enabled: true,
        color: "#202426",
        opacity: 0.22,
        offsetX: 0,
        offsetY: 20,
        blur: 36,
        spread: 0,
      },
    });
    const createResponse = await postJson(
      app,
      "/api/v1/pages",
      {
        title: "Edited photo",
        document: createPageDocument({ layers: [editedPhoto] }),
      },
      cookie,
    );
    const created = pageResponseSchema.parse(await createResponse.json());
    const detailResponse = await app.request(`/api/v1/pages/${created.id}`, {
      headers: { cookie },
    });
    const originalResponse = await app.request(`/api/v1/assets/${uploaded.id}/content`, {
      headers: { cookie },
    });
    const detail = pageResponseSchema.parse(await detailResponse.json());
    const layer = detail.document.layers[0];

    expect(createResponse.status).toBe(201);
    expect(detailResponse.status).toBe(200);
    expect(layer?.kind).toBe("photo");

    if (layer?.kind !== "photo") {
      throw new Error("Expected a photo layer");
    }

    expect(layer.assetId).toBe(uploaded.id);
    expect(layer.crop).toMatchObject({ aspectRatioPreset: "square", width: 0.8 });
    expect(layer.photoTransform).toMatchObject({ scale: 1.4, flipX: true });
    expect(layer.mask.shape).toBe("diamond");
    expect(originalResponse.status).toBe(200);
    expect(Buffer.from(await originalResponse.arrayBuffer())).toEqual(image);
  });

  it("saves custom washi tape designs to an account-scoped gallery", async () => {
    const app = await createTestAppWithStorage();
    const cookie = await registerAccount(app, {
      displayName: "Washi Owner",
      email: "washi-owner@example.com",
    });
    const otherCookie = await registerAccount(app, {
      displayName: "Washi Other",
      email: "washi-other@example.com",
    });
    const otherUpload = await uploadImage(
      app,
      otherCookie,
      new File([toArrayBuffer(await createPng())], "other.png", { type: "image/png" }),
    );
    const otherAsset = await otherUpload.json();
    const design = {
      outline: "scallop",
      pattern: { kind: "checker", primaryColor: "#fff4cc", secondaryColor: "#f2a65a" },
      tile: { scale: 1, scaleX: 0.5, scaleY: 0.5, rotation: 45, offsetX: 0, offsetY: 0 },
    };

    const createResponse = await postJson(
      app,
      "/api/v1/custom-washi-tapes",
      { name: "  Picnic  ", design },
      cookie,
    );
    const created = customWashiTapeResponseSchema.parse(await createResponse.json());

    expect(createResponse.status).toBe(201);
    expect(created.id).toMatch(/^custom_washi_tape_/);
    expect(created.name).toBe("Picnic");
    expect(created.design).toEqual(design);

    const missingPhotoResponse = await postJson(
      app,
      "/api/v1/custom-washi-tapes",
      {
        name: "No photo",
        design: { ...design, pattern: { ...design.pattern, kind: "customPhoto" } },
      },
      cookie,
    );
    const foreignPhotoResponse = await postJson(
      app,
      "/api/v1/custom-washi-tapes",
      {
        name: "Foreign photo",
        design: {
          ...design,
          pattern: { ...design.pattern, kind: "customPhoto", assetId: otherAsset.id },
        },
      },
      cookie,
    );

    expect(missingPhotoResponse.status).toBe(400);
    expect((await missingPhotoResponse.json()).error.code).toBe("washi_tape_photo_required");
    expect(foreignPhotoResponse.status).toBe(400);
    expect((await foreignPhotoResponse.json()).error.code).toBe("washi_tape_asset_not_found");

    const patchResponse = await app.request(`/api/v1/custom-washi-tapes/${created.id}`, {
      body: JSON.stringify({ name: "Picnic blanket", design: { ...design, outline: "wave" } }),
      headers: { cookie, "content-type": "application/json" },
      method: "PATCH",
    });
    const patched = customWashiTapeResponseSchema.parse(await patchResponse.json());

    expect(patchResponse.status).toBe(200);
    expect(patched.name).toBe("Picnic blanket");
    expect(patched.design.outline).toBe("wave");

    const ownerList = customWashiTapeListResponseSchema.parse(
      await (await app.request("/api/v1/custom-washi-tapes", { headers: { cookie } })).json(),
    );
    const otherListResponse = await app.request("/api/v1/custom-washi-tapes", {
      headers: { cookie: otherCookie },
    });
    const otherDeleteResponse = await app.request(`/api/v1/custom-washi-tapes/${created.id}`, {
      headers: { cookie: otherCookie },
      method: "DELETE",
    });

    expect(ownerList.washiTapes.map((washiTape) => washiTape.id)).toEqual([created.id]);
    expect((await otherListResponse.json()).washiTapes).toEqual([]);
    expect(otherDeleteResponse.status).toBe(404);

    const deleteResponse = await app.request(`/api/v1/custom-washi-tapes/${created.id}`, {
      headers: { cookie },
      method: "DELETE",
    });
    const listAfterDelete = await app.request("/api/v1/custom-washi-tapes", {
      headers: { cookie },
    });

    expect(deleteResponse.status).toBe(204);
    expect((await listAfterDelete.json()).washiTapes).toEqual([]);
  });

  it("uploads, serves, renames, and deletes account-scoped custom backgrounds", async () => {
    const app = await createTestAppWithStorage();
    const cookie = await registerAccount(app, {
      displayName: "Background Owner",
      email: "background-owner@example.com",
    });
    const otherCookie = await registerAccount(app, {
      displayName: "Background Other",
      email: "background-other@example.com",
    });
    const form = new FormData();

    form.set(
      "file",
      new File([toArrayBuffer(await createPng())], "beach.png", { type: "image/png" }),
    );
    form.set("name", "  Beach day  ");

    const uploadResponse = await app.request("/api/v1/custom-backgrounds", {
      body: form,
      headers: { cookie },
      method: "POST",
    });
    const created = customBackgroundResponseSchema.parse(await uploadResponse.json());

    expect(uploadResponse.status).toBe(201);
    expect(created).toMatchObject({
      backgroundId: `custom:${created.id}`,
      height: 16,
      mimeType: "image/jpeg",
      name: "Beach day",
      source: "upload",
      width: 24,
    });

    const contentResponse = await app.request(created.contentUrl, { headers: { cookie } });
    const thumbnailResponse = await app.request(created.thumbnailUrl, { headers: { cookie } });
    const otherContentResponse = await app.request(created.contentUrl, {
      headers: { cookie: otherCookie },
    });

    expect(contentResponse.status).toBe(200);
    expect(contentResponse.headers.get("content-type")).toBe("image/jpeg");
    expect((await sharp(Buffer.from(await contentResponse.arrayBuffer())).metadata()).format).toBe(
      "jpeg",
    );
    expect(thumbnailResponse.status).toBe(200);
    expect(otherContentResponse.status).toBe(404);

    const background = {
      backgroundId: created.backgroundId,
      height: 1080,
      scale: 1,
      width: 1080,
      x: 0,
      y: 0,
    };
    const ownPageResponse = await postJson(
      app,
      "/api/v1/pages",
      { title: "Beach", document: createPageDocument({ canvas: { background } }) },
      cookie,
    );
    const otherPageResponse = await postJson(
      app,
      "/api/v1/pages",
      { title: "Stolen", document: createPageDocument({ canvas: { background } }) },
      otherCookie,
    );

    expect(ownPageResponse.status).toBe(201);
    expect(otherPageResponse.status).toBe(400);
    expect(await otherPageResponse.json()).toMatchObject({
      error: { code: "page_asset_not_found" },
    });

    const renameResponse = await app.request(`/api/v1/custom-backgrounds/${created.id}`, {
      body: JSON.stringify({ name: "Shoreline" }),
      headers: { cookie, "content-type": "application/json" },
      method: "PATCH",
    });

    expect(renameResponse.status).toBe(200);
    expect((await renameResponse.json()).name).toBe("Shoreline");

    const otherListResponse = await app.request("/api/v1/custom-backgrounds", {
      headers: { cookie: otherCookie },
    });
    const otherDeleteResponse = await app.request(`/api/v1/custom-backgrounds/${created.id}`, {
      headers: { cookie: otherCookie },
      method: "DELETE",
    });

    expect((await otherListResponse.json()).backgrounds).toEqual([]);
    expect(otherDeleteResponse.status).toBe(404);

    const deleteResponse = await app.request(`/api/v1/custom-backgrounds/${created.id}`, {
      headers: { cookie },
      method: "DELETE",
    });
    const listAfterDelete = customBackgroundListResponseSchema.parse(
      await (await app.request("/api/v1/custom-backgrounds", { headers: { cookie } })).json(),
    );
    const contentAfterDelete = await app.request(created.contentUrl, { headers: { cookie } });

    expect(deleteResponse.status).toBe(204);
    expect(listAfterDelete.backgrounds).toEqual([]);
    expect(contentAfterDelete.status).toBe(404);
  });

  it("rejects non-image background uploads", async () => {
    const app = await createTestAppWithStorage();
    const cookie = await registerAccount(app, {
      displayName: "Background Uploader",
      email: "background-uploader@example.com",
    });
    const form = new FormData();

    form.set("file", new File(["not an image"], "notes.txt", { type: "text/plain" }));

    const response = await app.request("/api/v1/custom-backgrounds", {
      body: form,
      headers: { cookie },
      method: "POST",
    });

    expect(response.status).toBe(400);
  });

  it("serves built-in background textures without authentication", async () => {
    const app = createTestApp();
    const contentResponse = await app.request("/api/v1/backgrounds/builtin/kraft-paper/content");
    const thumbnailResponse = await app.request(
      "/api/v1/backgrounds/builtin/kraft-paper/thumbnail",
    );
    const missingResponse = await app.request("/api/v1/backgrounds/builtin/polka-dots/content");

    expect(contentResponse.status).toBe(200);
    expect(contentResponse.headers.get("content-type")).toBe("image/jpeg");
    expect(contentResponse.headers.get("cache-control")).toContain("immutable");
    expect(thumbnailResponse.status).toBe(200);
    expect(missingResponse.status).toBe(404);
  });
});
