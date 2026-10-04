import { Buffer } from "node:buffer";

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function withSvgMetadata(png: Buffer) {
  const text = Buffer.from(
    'Description\0Exported from <svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
  );
  const chunk = Buffer.alloc(12 + text.length);
  chunk.writeUInt32BE(text.length, 0);
  chunk.write("tEXt", 4);
  text.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  // Keep a valid PNG with a text chunk immediately after IHDR.
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}
