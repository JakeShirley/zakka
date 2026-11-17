import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";

/**
 * A file to place in a ZIP archive. `size` and `modifiedAt` are captured up front so the archive's
 * exact length can be computed before any bytes are streamed.
 */
export type ZipEntry = { name: string; path: string; size: number; modifiedAt: Date };

const uint32Max = 0xffffffff;
const uint16Max = 0xffff;
const zip64Version = 45;
const defaultVersion = 20;
// Bit 3: sizes and CRC follow the data in a descriptor. Bit 11: names are UTF-8.
const generalPurposeFlags = 0x0808;

const dosDateTime = (date: Date) => {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);

  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

const needsZip64Data = (entry: ZipEntry) => entry.size >= uint32Max;

const localHeader = (entry: ZipEntry, name: Buffer): Buffer => {
  const zip64 = needsZip64Data(entry);
  const extraLength = zip64 ? 20 : 0;
  const header = Buffer.alloc(30 + name.length + extraLength);
  const { time, date } = dosDateTime(entry.modifiedAt);

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(zip64 ? zip64Version : defaultVersion, 4);
  header.writeUInt16LE(generalPurposeFlags, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  // CRC and sizes are zero here and written to the data descriptor instead.
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(zip64 ? uint32Max : 0, 18);
  header.writeUInt32LE(zip64 ? uint32Max : 0, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(extraLength, 28);
  name.copy(header, 30);

  if (zip64) {
    const extra = 30 + name.length;

    header.writeUInt16LE(0x0001, extra);
    header.writeUInt16LE(16, extra + 2);
    header.writeBigUInt64LE(0n, extra + 4);
    header.writeBigUInt64LE(0n, extra + 12);
  }

  return header;
};

const dataDescriptorLength = (entry: ZipEntry) => (needsZip64Data(entry) ? 24 : 16);

const dataDescriptor = (entry: ZipEntry, crc: number): Buffer => {
  const descriptor = Buffer.alloc(dataDescriptorLength(entry));

  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc, 4);

  if (needsZip64Data(entry)) {
    descriptor.writeBigUInt64LE(BigInt(entry.size), 8);
    descriptor.writeBigUInt64LE(BigInt(entry.size), 16);
  } else {
    descriptor.writeUInt32LE(entry.size, 8);
    descriptor.writeUInt32LE(entry.size, 12);
  }

  return descriptor;
};

const centralHeader = (entry: ZipEntry, name: Buffer, crc: number, offset: number): Buffer => {
  const sizeOverflow = needsZip64Data(entry);
  const offsetOverflow = offset >= uint32Max;
  const extraLength =
    sizeOverflow || offsetOverflow ? 4 + (sizeOverflow ? 16 : 0) + (offsetOverflow ? 8 : 0) : 0;
  const header = Buffer.alloc(46 + name.length + extraLength);
  const { time, date } = dosDateTime(entry.modifiedAt);
  const version = extraLength > 0 ? zip64Version : defaultVersion;

  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(version, 4);
  header.writeUInt16LE(version, 6);
  header.writeUInt16LE(generalPurposeFlags, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(sizeOverflow ? uint32Max : entry.size, 20);
  header.writeUInt32LE(sizeOverflow ? uint32Max : entry.size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(extraLength, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offsetOverflow ? uint32Max : offset, 42);
  name.copy(header, 46);

  if (extraLength > 0) {
    let position = 46 + name.length;

    header.writeUInt16LE(0x0001, position);
    header.writeUInt16LE(extraLength - 4, position + 2);
    position += 4;

    if (sizeOverflow) {
      header.writeBigUInt64LE(BigInt(entry.size), position);
      header.writeBigUInt64LE(BigInt(entry.size), position + 8);
      position += 16;
    }

    if (offsetOverflow) {
      header.writeBigUInt64LE(BigInt(offset), position);
    }
  }

  return header;
};

const end = (entryCount: number, centralSize: number, centralOffset: number): Buffer => {
  const zip64 = entryCount >= uint16Max || centralSize >= uint32Max || centralOffset >= uint32Max;
  const parts: Buffer[] = [];

  if (zip64) {
    const record = Buffer.alloc(56);

    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(zip64Version, 12);
    record.writeUInt16LE(zip64Version, 14);
    record.writeUInt32LE(0, 16);
    record.writeUInt32LE(0, 20);
    record.writeBigUInt64LE(BigInt(entryCount), 24);
    record.writeBigUInt64LE(BigInt(entryCount), 32);
    record.writeBigUInt64LE(BigInt(centralSize), 40);
    record.writeBigUInt64LE(BigInt(centralOffset), 48);

    const locator = Buffer.alloc(20);

    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(centralOffset + centralSize), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(record, locator);
  }

  const record = Buffer.alloc(22);

  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(Math.min(entryCount, uint16Max), 8);
  record.writeUInt16LE(Math.min(entryCount, uint16Max), 10);
  record.writeUInt32LE(Math.min(centralSize, uint32Max), 12);
  record.writeUInt32LE(Math.min(centralOffset, uint32Max), 16);
  record.writeUInt16LE(0, 20);
  parts.push(record);

  return Buffer.concat(parts);
};

const encodeNames = (entries: readonly ZipEntry[]) =>
  entries.map((entry) => Buffer.from(entry.name, "utf8"));

/** The exact byte length of the archive `createZipStream` produces for these entries. */
export const zipLength = (entries: readonly ZipEntry[]): number => {
  const names = encodeNames(entries);
  let offset = 0;
  let centralSize = 0;

  entries.forEach((entry, index) => {
    const name = names[index] as Buffer;

    centralSize += centralHeader(entry, name, 0, offset).length;
    offset += localHeader(entry, name).length + entry.size + dataDescriptorLength(entry);
  });

  return offset + centralSize + end(entries.length, centralSize, offset).length;
};

/**
 * Streams an uncompressed ("stored") ZIP of the given files, using ZIP64 records when an entry or
 * the archive outgrows the classic 4 GiB limits. Photos and videos are already compressed, so
 * storing them keeps the download fast without making it meaningfully larger.
 */
export const createZipStream = (entries: readonly ZipEntry[]): Readable =>
  Readable.from(
    (async function* () {
      const names = encodeNames(entries);
      const central: Buffer[] = [];
      let offset = 0;

      for (const [index, entry] of entries.entries()) {
        const name = names[index] as Buffer;
        const header = localHeader(entry, name);
        let crc = 0;
        let size = 0;

        yield header;

        for await (const chunk of createReadStream(entry.path)) {
          const data = chunk as Buffer;

          crc = crc32(data, crc);
          size += data.length;
          yield data;
        }

        if (size !== entry.size) {
          throw new Error(`${entry.name} changed while the archive was being downloaded`);
        }

        yield dataDescriptor(entry, crc);
        central.push(centralHeader(entry, name, crc, offset));
        offset += header.length + entry.size + dataDescriptorLength(entry);
      }

      const centralDirectory = Buffer.concat(central);

      yield centralDirectory;
      yield end(entries.length, centralDirectory.length, offset);
    })(),
    { objectMode: false },
  );

/** Lists every file under `rootDir`, sorted, with archive names prefixed by `prefix`. */
export const collectZipEntries = async (rootDir: string, prefix: string): Promise<ZipEntry[]> => {
  const entries: ZipEntry[] = [];

  const visit = async (directory: string, relative: string) => {
    const children = await readdir(directory, { withFileTypes: true });

    children.sort((left, right) => left.name.localeCompare(right.name));

    for (const child of children) {
      const path = join(directory, child.name);
      const name = `${relative}${child.name}`;

      if (child.isDirectory()) {
        await visit(path, `${name}/`);
      } else if (child.isFile()) {
        const info = await stat(path);

        entries.push({ name, path, size: info.size, modifiedAt: info.mtime });
      }
    }
  };

  await visit(rootDir, prefix);

  return entries;
};
