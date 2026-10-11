export function tileSheetLayout(sizes: { width: number; height: number }[], columns: number) {
  if (!sizes.length) throw new Error("合成する画像を選択してください。");
  if (sizes.length > 256) throw new Error("一度に合成できる画像は256枚までです。");
  if (!Number.isInteger(columns) || columns < 1 || columns > 256)
    throw new Error("列数は1〜256の整数で指定してください。");
  const first = sizes[0];
  if (sizes.some((s) => s.width !== first.width || s.height !== first.height))
    throw new Error("画像サイズが一致しません。同じ幅・高さの画像だけを選択してください。");
  const width = first.width * columns,
    height = first.height * Math.ceil(sizes.length / columns);
  if (width > 4096 || height > 4096 || width * height > 16_777_216)
    throw new Error("合成画像は4096 × 4096px以下にしてください。");
  return {
    width,
    height,
    tileWidth: first.width,
    tileHeight: first.height,
    columns,
  };
}
