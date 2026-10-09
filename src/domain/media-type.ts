// Inspect binary signatures before considering XML. Raster metadata can contain
// arbitrary text (including SVG), so a substring search is not a format check.
export function rasterMime(bytes: Uint8Array): string | undefined {
  const match = (signature: number[], offset = 0) =>
    signature.every((value, index) => bytes[offset + index] === value);
  if (match([137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (match([255, 216, 255])) return "image/jpeg";
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 2) === "BM") return "image/bmp";
  if (match([0, 0, 1, 0])) return "image/x-icon";
  if (ascii(4, 8) === "ftyp") {
    for (let offset = 8; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
      if (offset === 12) continue;
      if (["avif", "avis"].includes(ascii(offset, offset + 4))) return "image/avif";
    }
  }
}
export function hasSvgRoot(head: string): boolean {
  // Only XML whose first element is SVG qualifies. Never scan embedded raster
  // metadata for markup. DOMParser still validates the complete SVG afterwards.
  const prolog = /^\s*(?:<\?xml\s[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE\s[\s\S]*?>\s*)*/i;
  return /^<svg(?:\s|>)/i.test(head.replace(prolog, ""));
}
export async function imageMime(blob: Blob, fallback = blob.type): Promise<string | undefined> {
  const head = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  const raster = rasterMime(head);
  if (raster) return raster;
  if (hasSvgRoot(new TextDecoder().decode(head))) return "image/svg+xml";
  // Unknown image types still need the browser decoder to accept their content.
  return fallback.startsWith("image/") ? fallback : undefined;
}
