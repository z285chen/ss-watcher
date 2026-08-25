import type { SswDesignPackageFile } from "../design/evidence-package";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const MAX_STORED_ZIP_ENTRIES = 128;
export const MAX_STORED_ZIP_ENTRY_BYTES = 30 * 1_024 * 1_024;
export const MAX_STORED_ZIP_TOTAL_BYTES = 256 * 1_024 * 1_024;

export type StoredZipEntry = Readonly<{
  path: string;
  bytes: Uint8Array;
}>;

export type ReadStoredZipOptions = Readonly<{
  maxEntries?: number;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
}>;

/** Creates a deterministic, uncompressed ZIP suitable for local evidence export. */
export function createStoredZip(
  files: readonly SswDesignPackageFile[],
  modifiedAt: Date,
): Uint8Array {
  if (files.length === 0 || files.length > 65_535) throw new Error("ZIP file count is invalid");
  const paths = new Set<string>();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const { date, time } = dosDateTime(modifiedAt);
  for (const file of files) {
    if (paths.has(file.path)) throw new Error("ZIP paths must be unique");
    paths.add(file.path);
    const name = encoder.encode(file.path);
    if (name.byteLength === 0 || name.byteLength > 65_535 || file.bytes.byteLength > 0xffff_ffff) throw new Error(`ZIP entry is too large: ${file.path}`);
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.byteLength + file.bytes.byteLength);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50); write16(localView, 4, 20); write16(localView, 6, 0x0800);
    write16(localView, 8, 0); write16(localView, 10, time); write16(localView, 12, date);
    write32(localView, 14, crc); write32(localView, 18, file.bytes.byteLength); write32(localView, 22, file.bytes.byteLength);
    write16(localView, 26, name.byteLength); write16(localView, 28, 0);
    local.set(name, 30); local.set(file.bytes, 30 + name.byteLength);
    locals.push(local);

    const directory = new Uint8Array(46 + name.byteLength);
    const directoryView = new DataView(directory.buffer);
    write32(directoryView, 0, 0x02014b50); write16(directoryView, 4, 20); write16(directoryView, 6, 20);
    write16(directoryView, 8, 0x0800); write16(directoryView, 10, 0); write16(directoryView, 12, time); write16(directoryView, 14, date);
    write32(directoryView, 16, crc); write32(directoryView, 20, file.bytes.byteLength); write32(directoryView, 24, file.bytes.byteLength);
    write16(directoryView, 28, name.byteLength); write16(directoryView, 30, 0); write16(directoryView, 32, 0); write16(directoryView, 34, 0); write16(directoryView, 36, 0);
    write32(directoryView, 38, 0); write32(directoryView, 42, offset); directory.set(name, 46);
    central.push(directory);
    offset += local.byteLength;
  }
  const centralSize = central.reduce((sum, entry) => sum + entry.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50); write16(endView, 4, 0); write16(endView, 6, 0);
  write16(endView, 8, files.length); write16(endView, 10, files.length);
  write32(endView, 12, centralSize); write32(endView, 16, offset); write16(endView, 20, 0);
  return concatenate([...locals, ...central, end]);
}

/**
 * Reads the canonical, uncompressed ZIP subset emitted by createStoredZip.
 *
 * The reader validates the container before returning any entry bytes: the
 * archive must have one terminal EOCD, one contiguous central directory and
 * contiguous local records whose security-relevant fields exactly match the
 * central directory. ZIP64, data descriptors, encryption and compression are
 * intentionally unsupported.
 */
export function readStoredZip(
  input: Uint8Array,
  options: ReadStoredZipOptions = {},
): readonly StoredZipEntry[] {
  const bytes = Uint8Array.from(input);
  const maxEntries = boundedLimit(options.maxEntries, MAX_STORED_ZIP_ENTRIES);
  const maxEntryBytes = boundedLimit(options.maxEntryBytes, MAX_STORED_ZIP_ENTRY_BYTES);
  const maxTotalBytes = boundedLimit(options.maxTotalBytes, MAX_STORED_ZIP_TOTAL_BYTES);
  if (bytes.byteLength < 22) throw new Error("ZIP container is truncated");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = bytes.byteLength - 22;
  if (read32(view, endOffset) !== 0x06054b50) {
    throw new Error("ZIP end record is missing or not terminal");
  }
  if (
    read16(view, endOffset + 4) !== 0 ||
    read16(view, endOffset + 6) !== 0 ||
    read16(view, endOffset + 20) !== 0
  ) {
    throw new Error("ZIP multi-disk archives and comments are unsupported");
  }
  const entriesOnDisk = read16(view, endOffset + 8);
  const entryCount = read16(view, endOffset + 10);
  if (entriesOnDisk !== entryCount || entryCount < 1 || entryCount > maxEntries) {
    throw new Error("ZIP entry count is invalid or exceeds the limit");
  }
  const centralSize = read32(view, endOffset + 12);
  const centralOffset = read32(view, endOffset + 16);
  if (centralOffset + centralSize !== endOffset || centralOffset > endOffset) {
    throw new Error("ZIP central directory bounds are invalid");
  }

  type CentralEntry = Readonly<{
    path: string;
    name: Uint8Array;
    versionNeeded: number;
    flags: number;
    method: number;
    time: number;
    date: number;
    crc: number;
    compressedSize: number;
    uncompressedSize: number;
    localOffset: number;
  }>;
  const centralEntries: CentralEntry[] = [];
  const paths = new Set<string>();
  let centralCursor = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    requireRange(bytes, centralCursor, 46, "ZIP central directory is truncated");
    if (read32(view, centralCursor) !== 0x02014b50) {
      throw new Error("ZIP central directory signature is invalid");
    }
    const versionNeeded = read16(view, centralCursor + 6);
    const flags = read16(view, centralCursor + 8);
    const method = read16(view, centralCursor + 10);
    const time = read16(view, centralCursor + 12);
    const date = read16(view, centralCursor + 14);
    const crc = read32(view, centralCursor + 16);
    const compressedSize = read32(view, centralCursor + 20);
    const uncompressedSize = read32(view, centralCursor + 24);
    const nameLength = read16(view, centralCursor + 28);
    const extraLength = read16(view, centralCursor + 30);
    const commentLength = read16(view, centralCursor + 32);
    const diskStart = read16(view, centralCursor + 34);
    const localOffset = read32(view, centralCursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    requireRange(bytes, centralCursor, recordLength, "ZIP central directory is truncated");
    if (centralCursor + recordLength > endOffset) {
      throw new Error("ZIP central directory exceeds its declared bounds");
    }
    if (versionNeeded !== 20) throw new Error("ZIP version is unsupported");
    if (flags !== 0x0800) throw new Error("ZIP flags are unsupported");
    if (method !== 0) throw new Error("ZIP compression method is unsupported");
    if (diskStart !== 0 || extraLength !== 0 || commentLength !== 0) {
      throw new Error("ZIP extra fields, comments and multi-disk entries are unsupported");
    }
    if (compressedSize !== uncompressedSize) {
      throw new Error("Stored ZIP entry size fields are inconsistent");
    }
    if (uncompressedSize > maxEntryBytes) {
      throw new Error("ZIP entry exceeds the uncompressed byte limit");
    }
    totalBytes += uncompressedSize;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxTotalBytes) {
      throw new Error("ZIP total uncompressed bytes exceed the limit");
    }
    const name = bytes.slice(centralCursor + 46, centralCursor + 46 + nameLength);
    const path = decodePath(name);
    if (paths.has(path)) throw new Error("ZIP entry paths must be unique");
    paths.add(path);
    centralEntries.push({
      path, name, versionNeeded, flags, method, time, date, crc,
      compressedSize, uncompressedSize, localOffset,
    });
    centralCursor += recordLength;
  }
  if (centralCursor !== endOffset) {
    throw new Error("ZIP central directory size or entry count is inconsistent");
  }

  const localRecords = centralEntries.map((entry) => {
    const offset = entry.localOffset;
    requireRange(bytes, offset, 30, "ZIP local header is truncated");
    if (offset >= centralOffset || read32(view, offset) !== 0x04034b50) {
      throw new Error("ZIP local header offset or signature is invalid");
    }
    const versionNeeded = read16(view, offset + 4);
    const flags = read16(view, offset + 6);
    const method = read16(view, offset + 8);
    const time = read16(view, offset + 10);
    const date = read16(view, offset + 12);
    const crc = read32(view, offset + 14);
    const compressedSize = read32(view, offset + 18);
    const uncompressedSize = read32(view, offset + 22);
    const nameLength = read16(view, offset + 26);
    const extraLength = read16(view, offset + 28);
    const headerLength = 30 + nameLength + extraLength;
    requireRange(bytes, offset, headerLength, "ZIP local header is truncated");
    if (extraLength !== 0) throw new Error("ZIP local extra fields are unsupported");
    const localName = bytes.subarray(offset + 30, offset + 30 + nameLength);
    if (
      versionNeeded !== entry.versionNeeded || flags !== entry.flags || method !== entry.method || time !== entry.time || date !== entry.date ||
      crc !== entry.crc || compressedSize !== entry.compressedSize ||
      uncompressedSize !== entry.uncompressedSize || !equalBytes(localName, entry.name)
    ) {
      throw new Error(`ZIP local and central headers disagree: ${entry.path}`);
    }
    const dataStart = offset + headerLength;
    const dataEnd = dataStart + compressedSize;
    requireRange(bytes, dataStart, compressedSize, "ZIP entry data is truncated");
    if (dataEnd > centralOffset) throw new Error("ZIP entry overlaps the central directory");
    const data = bytes.subarray(dataStart, dataEnd);
    if (crc32(data) !== crc) throw new Error(`ZIP CRC mismatch: ${entry.path}`);
    return { entry, offset, dataEnd, data };
  });

  const orderedLocals = [...localRecords].sort((left, right) => left.offset - right.offset);
  let expectedOffset = 0;
  for (const local of orderedLocals) {
    if (local.offset !== expectedOffset) {
      throw new Error("ZIP local records are overlapping, duplicated, or non-contiguous");
    }
    expectedOffset = local.dataEnd;
  }
  if (expectedOffset !== centralOffset) {
    throw new Error("ZIP local record region contains unregistered bytes");
  }
  return localRecords.map(({ entry, data }) => ({ path: entry.path, bytes: Uint8Array.from(data) }));
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function dosDateTime(value: Date): { date: number; time: number } {
  if (!Number.isFinite(value.getTime())) throw new Error("ZIP modifiedAt is invalid");
  const year = Math.min(2107, Math.max(1980, value.getUTCFullYear()));
  return {
    date: ((year - 1980) << 9) | ((value.getUTCMonth() + 1) << 5) | value.getUTCDate(),
    time: (value.getUTCHours() << 11) | (value.getUTCMinutes() << 5) | Math.floor(value.getUTCSeconds() / 2),
  };
}
function concatenate(chunks: readonly Uint8Array[]): Uint8Array { const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0); const result = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; } return result; }
function read16(view: DataView, offset: number): number { return view.getUint16(offset, true); }
function read32(view: DataView, offset: number): number { return view.getUint32(offset, true); }
function write16(view: DataView, offset: number, value: number): void { view.setUint16(offset, value, true); }
function write32(view: DataView, offset: number, value: number): void { view.setUint32(offset, value, true); }
function boundedLimit(value: number | undefined, fallback: number): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("ZIP read limit is invalid");
  return limit;
}
function requireRange(bytes: Uint8Array, offset: number, length: number, message: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > bytes.byteLength - length) {
    throw new Error(message);
  }
}
function decodePath(name: Uint8Array): string {
  let path: string;
  try { path = decoder.decode(name); } catch { throw new Error("ZIP entry path is not valid UTF-8"); }
  if (
    path.length === 0 || path.includes("\0") || path.includes("\\") || path.startsWith("/") ||
    /^[a-zA-Z]:/u.test(path) || path.endsWith("/") ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("ZIP entry path is unsafe");
  }
  return path;
}
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}
