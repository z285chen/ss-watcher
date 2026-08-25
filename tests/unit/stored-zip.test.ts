import { describe, expect, it } from "vitest";

import { createStoredZip, crc32, readStoredZip } from "../../src/core/export/stored-zip";

describe("stored ZIP export", () => {
  it("writes deterministic local, central, and end records", () => {
    const files = [
      { path: "manifest.json", mediaType: "application/json", bytes: new TextEncoder().encode("{}\n") },
      { path: "screenshots/a.png", mediaType: "image/png", bytes: Uint8Array.from([137, 80, 78, 71]) },
    ];
    const first = createStoredZip(files, new Date("2026-08-12T10:00:00.000Z"));
    const second = createStoredZip(files, new Date("2026-08-12T10:00:00.000Z"));
    expect(first).toEqual(second);
    const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(findSignature(first, 0x02014b50)).toBeGreaterThan(0);
    expect(findSignature(first, 0x06054b50)).toBe(first.byteLength - 22);
  });

  it("matches the standard CRC-32 check vector", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("strictly reads the canonical stored ZIP subset", () => {
    const files = zipFiles("manifest.json", "screenshots/a.png");
    const zip = createStoredZip(files, new Date("2026-08-12T10:00:00.000Z"));
    expect(readStoredZip(zip)).toEqual(files.map(({ path, bytes }) => ({ path, bytes })));
  });

  it.each([
    "/absolute.json",
    "../escape.json",
    "safe/../../escape.json",
    "safe\\escape.json",
    "C:/escape.json",
    "nul\0name.json",
  ])("rejects unsafe entry path %j before returning bytes", (path) => {
    const zip = createStoredZip(zipFiles(path), new Date("2026-08-12T10:00:00.000Z"));
    expect(() => readStoredZip(zip)).toThrow("path is unsafe");
  });

  it("rejects duplicate decoded paths", () => {
    const zip = createStoredZip(zipFiles("a", "b"), new Date("2026-08-12T10:00:00.000Z"));
    const mutated = zip.slice();
    const secondCentral = findSignature(mutated, 0x02014b50, 1);
    mutated[secondCentral + 46] = "a".charCodeAt(0);
    expect(() => readStoredZip(mutated)).toThrow("paths must be unique");
  });

  it("rejects local/central disagreement, CRC errors, truncation, and compression", () => {
    const zip = createStoredZip(zipFiles("manifest.json"), new Date("2026-08-12T10:00:00.000Z"));

    const disagreement = zip.slice();
    const central = findSignature(disagreement, 0x02014b50);
    disagreement[central + 46] = "M".charCodeAt(0);
    expect(() => readStoredZip(disagreement)).toThrow("headers disagree");

    const corrupt = zip.slice();
    const localNameLength = new DataView(corrupt.buffer).getUint16(26, true);
    const dataOffset = 30 + localNameLength;
    corrupt[dataOffset] = (corrupt[dataOffset] ?? 0) ^ 0xff;
    expect(() => readStoredZip(corrupt)).toThrow("CRC mismatch");

    expect(() => readStoredZip(zip.slice(0, -1))).toThrow();

    const compressed = zip.slice();
    new DataView(compressed.buffer).setUint16(8, 8, true);
    new DataView(compressed.buffer).setUint16(central + 10, 8, true);
    expect(() => readStoredZip(compressed)).toThrow("compression method");
  });

  it("enforces entry count, per-entry, and aggregate uncompressed limits", () => {
    const zip = createStoredZip(zipFiles("a", "b"), new Date("2026-08-12T10:00:00.000Z"));
    expect(() => readStoredZip(zip, { maxEntries: 1 })).toThrow("entry count");
    expect(() => readStoredZip(zip, { maxEntryBytes: 3 })).toThrow("entry exceeds");
    expect(() => readStoredZip(zip, { maxTotalBytes: 7 })).toThrow("total uncompressed");
  });
});

function zipFiles(...paths: string[]) {
  return paths.map((path) => ({
    path,
    mediaType: "application/octet-stream",
    bytes: new TextEncoder().encode("data"),
  }));
}

function findSignature(bytes: Uint8Array, signature: number, occurrence = 0): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let seen = 0;
  for (let index = 0; index <= bytes.byteLength - 4; index += 1) {
    if (view.getUint32(index, true) === signature && seen++ === occurrence) return index;
  }
  return -1;
}
