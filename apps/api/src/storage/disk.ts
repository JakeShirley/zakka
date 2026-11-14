import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export const storageAreas = [
  "uploads",
  "variants",
  "previews",
  "exports",
  "stickers",
  "backgrounds",
] as const;

export type StorageArea = (typeof storageAreas)[number];

export type StoredObject = {
  key: string;
  byteSize: number;
};

export class UnsafeStorageKeyError extends Error {
  constructor(key: string) {
    super(`Unsafe storage key: ${key}`);
    this.name = "UnsafeStorageKeyError";
  }
}

const storageAreaSet = new Set<string>(storageAreas);

const sanitizeExtension = (extension: string | undefined): string => {
  if (!extension) {
    return "";
  }

  const normalized = extension.startsWith(".") ? extension : `.${extension}`;

  if (!/^\.[a-z0-9]{1,16}$/i.test(normalized)) {
    return "";
  }

  return normalized.toLowerCase();
};

export class DiskStorage {
  readonly rootDir: string;

  constructor(options: { rootDir: string }) {
    this.rootDir = resolve(options.rootDir);
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });

    for (const area of storageAreas) {
      await mkdir(resolve(this.rootDir, area), { recursive: true });
    }
  }

  async write(
    area: StorageArea,
    data: Buffer | Uint8Array | string,
    options: { extension?: string } = {},
  ): Promise<StoredObject> {
    const key = this.createKey(area, options.extension);
    const destination = this.resolveKey(key);

    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, data);

    const metadata = await stat(destination);

    return {
      key,
      byteSize: metadata.size,
    };
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  private createKey(area: StorageArea, extension: string | undefined): string {
    const id = crypto.randomUUID();
    const prefix = id.slice(0, 2).toLowerCase();

    return `${area}/${prefix}/${id}${sanitizeExtension(extension)}`;
  }

  private resolveKey(key: string): string {
    const parts = key.split("/");

    if (
      key.length === 0 ||
      key.includes("\\") ||
      key.startsWith("/") ||
      parts.some((part) => part.length === 0 || part === "." || part === "..") ||
      !storageAreaSet.has(parts[0] ?? "") ||
      !/^[a-z0-9][a-z0-9/_\-.]*$/i.test(key)
    ) {
      throw new UnsafeStorageKeyError(key);
    }

    const absolutePath = resolve(this.rootDir, key);

    if (absolutePath !== this.rootDir && !absolutePath.startsWith(`${this.rootDir}${sep}`)) {
      throw new UnsafeStorageKeyError(key);
    }

    return absolutePath;
  }
}

export const createDiskStorage = (options: { rootDir: string }): DiskStorage =>
  new DiskStorage(options);
