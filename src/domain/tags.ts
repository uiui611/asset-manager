export const automaticTagIds = ["image", "audio", "json"];

export function tagName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("タグ名を入力してください。");
  if (new TextEncoder().encode(trimmed).length > 100)
    throw new Error("タグ名は1〜100バイトで入力してください。");
  return trimmed;
}
