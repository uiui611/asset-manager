import type { StoredFile } from "./models";
export const isLibraryFile = (_file: StoredFile) => true;
export function editorKind(
  file: StoredFile,
): "map" | "character" | "sound" | undefined {
  if (file.type !== "json") return;
  return (["map", "character", "sound"] as const).find((k) =>
    file.tagIds.includes(`editor-${k}`),
  );
}
export function projectPage(file: StoredFile) {
  const kind = editorKind(file);
  return kind === "map"
    ? "maps"
    : kind === "character"
      ? "characters"
      : kind === "sound"
        ? "sounds"
        : undefined;
}
export function projectLabel(file: StoredFile) {
  const kind = editorKind(file);
  return kind
    ? { map: "マップ", character: "キャラクター", sound: "効果音" }[kind]
    : "JSON";
}
