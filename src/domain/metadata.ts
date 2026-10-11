import type { StoredFile } from "./models";
export const MAX_WRITE_BYTES = 1_000_000_000;
export function validateWriteSize(sizes: number[]) {
  if (
    sizes.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    sizes.reduce((a, b) => a + b, 0) > MAX_WRITE_BYTES
  )
    throw new Error("1回の操作で保存できる合計サイズは1 GB以下です。");
}
export function encodeProperties(file: Partial<StoredFile>): Record<string, string> {
  if ((file.tagIds?.length || 0) > 50) throw new Error("タグは50個までです。");
  return {};
}
export function referenceIds(project: import("./models").Project): string[] {
  if ("tilesets" in project)
    return [
      ...new Set(
        [
          ...project.tilesets.map((x) => x.assetId),
          ...project.layers.map((l) => l.tileset?.assetId || ""),
        ].filter(Boolean),
      ),
    ];
  if ("layers" in project) return project.layers.map((x) => x.assetId);
  return [];
}
