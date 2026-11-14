import { createHash } from "node:crypto";

import exifr from "exifr";
import sharp from "sharp";

import { createSharpInputBuffer, isHeicImage, isHeifImage, isTiffImage } from "./image-decoding.js";
import type { Repositories } from "./persistence/repositories.js";
import type { AssetRecord, AssetVariantRecord } from "./persistence/schema.js";
import type { StorageArea, StoredObject } from "./storage/disk.js";

type WritableAssetArea = Extract<
  StorageArea,
  "exports" | "uploads" | "variants" | "stickers" | "backgrounds"
>;

export type AssetStorage = {
  write: (
    area: WritableAssetArea,
    data: Buffer,
    options?: { extension?: string },
  ) => Promise<StoredObject>;
  read: (key: string) => Promise<Buffer>;
  remove: (key: string) => Promise<void>;
};

type UploadFile = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  name?: string;
  size?: number;
};

type SupportedImageFormat = "heic" | "heif" | "jpeg" | "png" | "tiff" | "webp";

const maxUploadByteSize = 20 * 1024 * 1024;
const maxImageDimension = 20_000;
const previewMaxDimension = 2400;
const thumbnailMaxDimension = 360;

export const browserNativeImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const heifMimeTypes = new Set(["image/heic", "image/heif"]);

const supportedImageTypes: Record<SupportedImageFormat, { mimeType: string; extension: string }> = {
  heic: { mimeType: "image/heic", extension: ".heic" },
  heif: { mimeType: "image/heif", extension: ".heif" },
  jpeg: { mimeType: "image/jpeg", extension: ".jpg" },
  png: { mimeType: "image/png", extension: ".png" },
  tiff: { mimeType: "image/tiff", extension: ".tiff" },
  webp: { mimeType: "image/webp", extension: ".webp" },
};

export class AssetUploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 413 = 400,
  ) {
    super(message);
    this.name = "AssetUploadError";
  }
}

const isUploadFile = (value: unknown): value is UploadFile =>
  typeof value === "object" &&
  value !== null &&
  "arrayBuffer" in value &&
  typeof value.arrayBuffer === "function";

const checksumSha256 = (buffer: Buffer): string =>
  createHash("sha256").update(buffer).digest("hex");

const cleanFilename = (filename: string | undefined, extension: string): string => {
  const basename = filename?.split(/[\\/]/).pop()?.trim();

  if (!basename) {
    return `upload${extension}`;
  }

  return basename.slice(0, 255);
};

const readUploadBuffer = async (file: unknown): Promise<Buffer> => {
  if (Array.isArray(file) || !isUploadFile(file)) {
    throw new AssetUploadError("missing_upload", "Upload must include an image file");
  }

  if (typeof file.size === "number" && file.size > maxUploadByteSize) {
    throw new AssetUploadError("image_too_large", "Uploaded image must be 20 MB or smaller", 413);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (buffer.byteLength === 0) {
    throw new AssetUploadError("empty_upload", "Uploaded image cannot be empty");
  }

  if (buffer.byteLength > maxUploadByteSize) {
    throw new AssetUploadError("image_too_large", "Uploaded image must be 20 MB or smaller", 413);
  }

  return buffer;
};

const readImageMetadata = async (buffer: Buffer) => {
  const isHeif = isHeifImage(buffer);
  let sharpInputBuffer: Buffer;

  try {
    sharpInputBuffer = isHeif ? await createSharpInputBuffer(buffer) : buffer;
  } catch {
    throw new AssetUploadError("invalid_image", "Uploaded file is not a valid image");
  }

  let metadata: sharp.Metadata;

  try {
    metadata = await sharp(sharpInputBuffer, { failOn: "warning" }).metadata();
  } catch {
    throw new AssetUploadError("invalid_image", "Uploaded file is not a valid image");
  }

  const format = metadata.format as
    | Exclude<SupportedImageFormat, "heic" | "heif">
    | "heif"
    | undefined;
  const imageType = isHeif
    ? isHeicImage(buffer)
      ? supportedImageTypes.heic
      : supportedImageTypes.heif
    : format === "tiff" || (format === undefined && isTiffImage(buffer))
      ? supportedImageTypes.tiff
      : format && format !== "heif"
        ? supportedImageTypes[format]
        : undefined;

  if (!imageType) {
    throw new AssetUploadError(
      "unsupported_image_type",
      "Uploaded image must be JPEG, PNG, WebP, HEIC, HEIF, TIFF, or DNG/RAW",
    );
  }

  if (!metadata.width || !metadata.height) {
    throw new AssetUploadError(
      "invalid_image_dimensions",
      "Uploaded image dimensions could not be read",
    );
  }

  if (metadata.width > maxImageDimension || metadata.height > maxImageDimension) {
    throw new AssetUploadError(
      "image_dimensions_too_large",
      "Uploaded image dimensions are too large",
    );
  }

  return {
    extension: imageType.extension,
    height: metadata.height,
    mimeType: imageType.mimeType,
    sharpInputBuffer,
    width: metadata.width,
  };
};

const createThumbnail = async (buffer: Buffer) => {
  const result = await sharp(buffer, { failOn: "warning" })
    .rotate()
    .resize({
      fit: "inside",
      height: thumbnailMaxDimension,
      withoutEnlargement: true,
      width: thumbnailMaxDimension,
    })
    .jpeg({ mozjpeg: true, quality: 82 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: result.data,
    byteSize: result.data.byteLength,
    checksumSha256: checksumSha256(result.data),
    height: result.info.height,
    mimeType: "image/jpeg",
    width: result.info.width,
  };
};

const createBrowserPreview = async (buffer: Buffer, options: { preserveAlpha: boolean }) => {
  const sharpInputBuffer = await createSharpInputBuffer(buffer);
  const metadata = await sharp(sharpInputBuffer, { failOn: "warning" }).metadata();
  const hasAlpha = options.preserveAlpha && metadata.hasAlpha;
  const image = sharp(sharpInputBuffer, { failOn: "warning" }).rotate().resize({
    fit: "inside",
    height: previewMaxDimension,
    withoutEnlargement: true,
    width: previewMaxDimension,
  });
  const result = hasAlpha
    ? await image.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    : await image.jpeg({ mozjpeg: true, quality: 90 }).toBuffer({ resolveWithObject: true });

  return {
    buffer: result.data,
    byteSize: result.data.byteLength,
    checksumSha256: checksumSha256(result.data),
    height: result.info.height,
    mimeType: hasAlpha ? "image/png" : "image/jpeg",
    width: result.info.width,
  };
};

const exifDateTimeRegex = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export type ExtractedExifMetadata = {
  dateTaken: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  isoSpeed: number | null;
  fNumber: number | null;
  exposureTimeSeconds: number | null;
  focalLengthMm: number | null;
  focalLength35mmMm: number | null;
  orientation: number | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsAltitudeMeters: number | null;
};

const emptyExifMetadata: ExtractedExifMetadata = {
  dateTaken: null,
  cameraMake: null,
  cameraModel: null,
  lensModel: null,
  isoSpeed: null,
  fNumber: null,
  exposureTimeSeconds: null,
  focalLengthMm: null,
  focalLength35mmMm: null,
  orientation: null,
  gpsLatitude: null,
  gpsLongitude: null,
  gpsAltitudeMeters: null,
};

const trimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  let end = value.length;

  while (end > 0 && value.charCodeAt(end - 1) === 0) {
    end -= 1;
  }

  const trimmed = value.slice(0, end).trim();

  return trimmed.length > 0 ? trimmed : null;
};

const finiteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
};

const finiteInteger = (value: unknown): number | null => {
  const num = finiteNumber(value);

  return num === null ? null : Math.round(num);
};

const buildDateTakenIso = (exif: Record<string, unknown>): string | null => {
  const raw = trimmedString(exif.DateTimeOriginal) ?? trimmedString(exif.CreateDate);

  if (!raw) {
    return null;
  }

  const match = exifDateTimeRegex.exec(raw);

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  const offset =
    trimmedString(exif.OffsetTimeOriginal) ?? trimmedString(exif.OffsetTimeDigitized) ?? "Z";
  const candidate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);

  if (Number.isNaN(candidate.getTime())) {
    return null;
  }

  return candidate.toISOString();
};

const extractExifMetadata = async (buffer: Buffer): Promise<ExtractedExifMetadata> => {
  let exif: Record<string, unknown> | undefined;

  try {
    exif = (await exifr.parse(buffer, {
      pick: [
        "DateTimeOriginal",
        "CreateDate",
        "OffsetTimeOriginal",
        "OffsetTimeDigitized",
        "Make",
        "Model",
        "LensModel",
        "ISO",
        "FNumber",
        "ExposureTime",
        "FocalLength",
        "FocalLengthIn35mmFormat",
        "Orientation",
        "GPSLatitude",
        "GPSLongitude",
        "GPSLatitudeRef",
        "GPSLongitudeRef",
        "GPSAltitude",
        "GPSAltitudeRef",
      ],
      reviveValues: false,
      translateValues: false,
    })) as Record<string, unknown> | undefined;
  } catch {
    return { ...emptyExifMetadata };
  }

  if (!exif) {
    return { ...emptyExifMetadata };
  }

  let gpsLatitude: number | null = null;
  let gpsLongitude: number | null = null;
  let gpsAltitude: number | null = null;

  try {
    const gps = (await exifr.gps(buffer)) as { latitude?: number; longitude?: number } | undefined;

    gpsLatitude = finiteNumber(gps?.latitude);
    gpsLongitude = finiteNumber(gps?.longitude);
  } catch {
    // GPS missing or unreadable; leave defaults.
  }

  const rawAltitude = finiteNumber(exif.GPSAltitude);

  if (rawAltitude !== null) {
    const altitudeRef = finiteInteger(exif.GPSAltitudeRef);
    gpsAltitude = altitudeRef === 1 ? -rawAltitude : rawAltitude;
  }

  return {
    dateTaken: buildDateTakenIso(exif),
    cameraMake: trimmedString(exif.Make),
    cameraModel: trimmedString(exif.Model),
    lensModel: trimmedString(exif.LensModel),
    isoSpeed: finiteInteger(exif.ISO),
    fNumber: finiteNumber(exif.FNumber),
    exposureTimeSeconds: finiteNumber(exif.ExposureTime),
    focalLengthMm: finiteNumber(exif.FocalLength),
    focalLength35mmMm: finiteInteger(exif.FocalLengthIn35mmFormat),
    orientation: finiteInteger(exif.Orientation),
    gpsLatitude,
    gpsLongitude,
    gpsAltitudeMeters: gpsAltitude,
  };
};

export const ensureBrowserPreviewVariant = async (input: {
  accountId: string;
  asset: AssetRecord;
  repositories: Repositories;
  storage: AssetStorage;
}): Promise<AssetVariantRecord> => {
  const existing = input.repositories.assets.findVariantByKindForAccount(
    input.accountId,
    input.asset.id,
    "preview",
  );

  if (existing) {
    return existing;
  }

  const buffer = await input.storage.read(input.asset.originalStorageKey);
  const preview = await createBrowserPreview(buffer, {
    preserveAlpha: !heifMimeTypes.has(input.asset.mimeType),
  });
  const previewStored = await input.storage.write("variants", preview.buffer, {
    extension: preview.mimeType === "image/png" ? ".png" : ".jpg",
  });

  try {
    return input.repositories.assets.createVariant({
      accountId: input.accountId,
      assetId: input.asset.id,
      byteSize: previewStored.byteSize,
      checksumSha256: preview.checksumSha256,
      height: preview.height,
      kind: "preview",
      mimeType: preview.mimeType,
      storageKey: previewStored.key,
      width: preview.width,
    });
  } catch (error) {
    await input.storage.remove(previewStored.key);
    throw error;
  }
};

export const createAssetFromUpload = async (input: {
  accountId: string;
  file: unknown;
  repositories: Repositories;
  storage: AssetStorage;
}): Promise<{ asset: AssetRecord; variants: AssetVariantRecord[] }> => {
  const buffer = await readUploadBuffer(input.file);
  const metadata = await readImageMetadata(buffer);
  const exifMetadata = await extractExifMetadata(buffer);
  const thumbnail = await createThumbnail(metadata.sharpInputBuffer);
  const preview = await createBrowserPreview(metadata.sharpInputBuffer, {
    preserveAlpha: !heifMimeTypes.has(metadata.mimeType),
  });
  const originalStored = await input.storage.write("uploads", buffer, {
    extension: metadata.extension,
  });
  const thumbnailStored = await input.storage.write("variants", thumbnail.buffer, {
    extension: ".jpg",
  });
  const previewStored = await input.storage.write("variants", preview.buffer, {
    extension: preview.mimeType === "image/png" ? ".png" : ".jpg",
  });

  try {
    const asset = input.repositories.assets.createOriginal({
      accountId: input.accountId,
      byteSize: originalStored.byteSize,
      checksumSha256: checksumSha256(buffer),
      dateTaken: exifMetadata.dateTaken,
      cameraMake: exifMetadata.cameraMake,
      cameraModel: exifMetadata.cameraModel,
      lensModel: exifMetadata.lensModel,
      isoSpeed: exifMetadata.isoSpeed,
      fNumber: exifMetadata.fNumber,
      exposureTimeSeconds: exifMetadata.exposureTimeSeconds,
      focalLengthMm: exifMetadata.focalLengthMm,
      focalLength35mmMm: exifMetadata.focalLength35mmMm,
      orientation: exifMetadata.orientation,
      gpsLatitude: exifMetadata.gpsLatitude,
      gpsLongitude: exifMetadata.gpsLongitude,
      gpsAltitudeMeters: exifMetadata.gpsAltitudeMeters,
      height: metadata.height,
      mimeType: metadata.mimeType,
      originalFilename: cleanFilename(
        isUploadFile(input.file) ? input.file.name : undefined,
        metadata.extension,
      ),
      originalStorageKey: originalStored.key,
      width: metadata.width,
    });
    const thumbnailVariant = input.repositories.assets.createVariant({
      accountId: input.accountId,
      assetId: asset.id,
      byteSize: thumbnailStored.byteSize,
      checksumSha256: thumbnail.checksumSha256,
      height: thumbnail.height,
      kind: "thumbnail",
      mimeType: thumbnail.mimeType,
      storageKey: thumbnailStored.key,
      width: thumbnail.width,
    });
    const previewVariant = input.repositories.assets.createVariant({
      accountId: input.accountId,
      assetId: asset.id,
      byteSize: previewStored.byteSize,
      checksumSha256: preview.checksumSha256,
      height: preview.height,
      kind: "preview",
      mimeType: preview.mimeType,
      storageKey: previewStored.key,
      width: preview.width,
    });

    return { asset, variants: [thumbnailVariant, previewVariant] };
  } catch (error) {
    await Promise.allSettled([
      input.storage.remove(originalStored.key),
      input.storage.remove(thumbnailStored.key),
      input.storage.remove(previewStored.key),
    ]);
    throw error;
  }
};
