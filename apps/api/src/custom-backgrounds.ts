import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { getBuiltInBackground, toCustomBackgroundId } from "@zakka/editor-core";
import sharp from "sharp";

import type { AssetStorage } from "./assets.js";
import { createSharpInputBuffer } from "./image-decoding.js";
import type { Repositories } from "./persistence/repositories.js";
import type { CustomBackgroundRecord, CustomBackgroundSource } from "./persistence/schema.js";

type UploadFile = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  name?: string;
  size?: number;
  type?: string;
};

const maxUploadByteSize = 25 * 1024 * 1024;
// Long edge cap: a 12x12in spread at 300dpi is 7200px wide.
const maxLongEdge = 7200;
const thumbnailLongEdge = 480;

const supportedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/svg+xml",
]);

export class CustomBackgroundUploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 413 = 400,
  ) {
    super(message);
    this.name = "CustomBackgroundUploadError";
  }
}

const isUploadFile = (value: unknown): value is UploadFile =>
  typeof value === "object" &&
  value !== null &&
  "arrayBuffer" in value &&
  typeof (value as { arrayBuffer: unknown }).arrayBuffer === "function";

const backgroundNameFromFilename = (filename: string | undefined): string => {
  const basename = filename?.split(/[\\/]/).pop()?.trim() ?? "";
  const dotIndex = basename.lastIndexOf(".");
  const name = (dotIndex > 0 ? basename.slice(0, dotIndex) : basename).slice(0, 120);
  return name.length > 0 ? name : "Background";
};

export type CreateCustomBackgroundInput = {
  accountId: string;
  buffer: Buffer;
  name: string;
  source: CustomBackgroundSource;
  externalId?: string | null;
  repositories: Repositories;
  storage: AssetStorage;
};

/**
 * Normalizes an image into an opaque JPEG (EXIF-rotated, long edge capped) plus a
 * thumbnail, then stores it as a custom background. Identical bytes return the
 * existing background instead of a duplicate.
 */
export const createCustomBackground = async (
  input: CreateCustomBackgroundInput,
): Promise<CustomBackgroundRecord> => {
  if (input.externalId) {
    const linked = input.repositories.customBackgrounds.findByExternalId(
      input.accountId,
      input.source,
      input.externalId,
    );
    if (linked) return linked;
  }

  let normalized: { data: Buffer; info: sharp.OutputInfo };
  let thumbnail: Buffer;

  try {
    const pipeline = sharp(await createSharpInputBuffer(input.buffer), {
      density: 300,
      limitInputPixels: 268_402_689,
    })
      .rotate()
      .resize({
        width: maxLongEdge,
        height: maxLongEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" });
    normalized = await pipeline
      .clone()
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    thumbnail = await pipeline
      .clone()
      .resize({ width: thumbnailLongEdge, height: thumbnailLongEdge, fit: "inside" })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    throw new CustomBackgroundUploadError(
      "invalid_background_image",
      "Background image could not be decoded",
    );
  }

  const checksum = createHash("sha256").update(normalized.data).digest("hex");
  const existing = input.repositories.customBackgrounds.findByChecksum(input.accountId, checksum);

  if (existing && !input.externalId) {
    return existing;
  }

  const stored = await input.storage.write("backgrounds", normalized.data, { extension: ".jpg" });
  const storedThumbnail = await input.storage.write("backgrounds", thumbnail, {
    extension: ".jpg",
  });

  // A concurrent import may have saved the same external background while this one was
  // processing; reuse it so the unique external ID index is never violated.
  const linkedMeanwhile = input.externalId
    ? input.repositories.customBackgrounds.findByExternalId(
        input.accountId,
        input.source,
        input.externalId,
      )
    : null;

  if (linkedMeanwhile) {
    await Promise.allSettled([
      input.storage.remove(stored.key),
      input.storage.remove(storedThumbnail.key),
    ]);
    return linkedMeanwhile;
  }

  return input.repositories.customBackgrounds.create({
    accountId: input.accountId,
    name: input.name.trim().slice(0, 120) || "Background",
    storageKey: stored.key,
    thumbnailStorageKey: storedThumbnail.key,
    mimeType: "image/jpeg",
    byteSize: stored.byteSize,
    width: normalized.info.width,
    height: normalized.info.height,
    checksumSha256: checksum,
    source: input.source,
    externalId: input.externalId ?? null,
  });
};

export const createCustomBackgroundFromUpload = async (input: {
  accountId: string;
  file: unknown;
  name?: string | undefined;
  repositories: Repositories;
  storage: AssetStorage;
}): Promise<CustomBackgroundRecord> => {
  if (!isUploadFile(input.file)) {
    throw new CustomBackgroundUploadError("missing_upload", "Upload must include an image file");
  }

  const mimeType = typeof input.file.type === "string" ? input.file.type.toLowerCase() : "";

  if (!supportedMimeTypes.has(mimeType)) {
    throw new CustomBackgroundUploadError(
      "unsupported_background_type",
      "Background uploads must be PNG, JPEG, WebP, GIF, SVG, HEIC, or HEIF",
    );
  }

  const tooLarge = () =>
    new CustomBackgroundUploadError(
      "background_too_large",
      "Uploaded background must be 25 MB or smaller",
      413,
    );

  if (typeof input.file.size === "number" && input.file.size > maxUploadByteSize) {
    throw tooLarge();
  }

  const buffer = Buffer.from(await input.file.arrayBuffer());

  if (buffer.byteLength === 0) {
    throw new CustomBackgroundUploadError("empty_upload", "Uploaded background cannot be empty");
  }
  if (buffer.byteLength > maxUploadByteSize) {
    throw tooLarge();
  }

  return createCustomBackground({
    accountId: input.accountId,
    buffer,
    name: input.name?.trim() || backgroundNameFromFilename(input.file.name),
    source: "upload",
    repositories: input.repositories,
    storage: input.storage,
  });
};

export const deleteCustomBackground = async (input: {
  accountId: string;
  backgroundId: string;
  repositories: Repositories;
  storage: AssetStorage;
}): Promise<"deleted" | "in_use" | "not_found"> => {
  if (
    !input.repositories.customBackgrounds.findByIdForAccount(input.accountId, input.backgroundId)
  ) {
    return "not_found";
  }

  const pageBackgroundId = JSON.stringify(toCustomBackgroundId(input.backgroundId));
  const inUse = input.repositories.pages
    .listForAccount(input.accountId)
    .some((page) => page.documentJson.includes(pageBackgroundId));

  if (inUse) return "in_use";

  const deleted = input.repositories.customBackgrounds.delete(input);

  if (!deleted) return "not_found";

  await Promise.allSettled([
    input.storage.remove(deleted.storageKey),
    input.storage.remove(deleted.thumbnailStorageKey),
  ]);

  return "deleted";
};

const editorCoreRequire = createRequire(import.meta.url);

/** Reads a vendored built-in texture (or its thumbnail) shipped with editor-core. */
export const readBuiltInBackgroundTexture = async (
  slug: string,
  variant: "content" | "thumbnail",
): Promise<Buffer | null> => {
  const background = getBuiltInBackground(`zakka:${slug}`);

  if (!background || background.kind !== "texture") return null;

  const file = variant === "content" ? background.file : background.thumbnailFile;
  return readFile(editorCoreRequire.resolve(`@zakka/editor-core/backgrounds/${file}`));
};
