export function pngDimensions(bytes: Uint8Array): Readonly<{ width: number; height: number }> {
  if (
    bytes.byteLength < 24 ||
    bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71 ||
    bytes[4] !== 13 || bytes[5] !== 10 || bytes[6] !== 26 || bytes[7] !== 10 ||
    bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82
  ) throw new Error("Screenshot PNG header is invalid");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0 || width > 32_000 || height > 32_000) {
    throw new Error("Screenshot PNG dimensions are invalid");
  }
  return { width, height };
}
