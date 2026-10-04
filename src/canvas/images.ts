import { imageMime } from "../domain/media-type";
export interface SplitOptions {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  spacing: number;
  skipEmpty: boolean;
  prefix: string;
}
export function tileRects(
  imageWidth: number,
  imageHeight: number,
  o: SplitOptions,
) {
  for (const n of [
    o.width,
    o.height,
    o.top,
    o.right,
    o.bottom,
    o.left,
    o.spacing,
  ])
    if (!Number.isInteger(n) || n < 0)
      throw new Error("タイル設定は0以上の整数で入力してください。");
  if (!o.width || !o.height)
    throw new Error("タイルの幅と高さは1以上にしてください。");
  const rects: { x: number; y: number }[] = [];
  for (
    let y = o.top;
    y + o.height <= imageHeight - o.bottom;
    y += o.height + o.spacing
  )
    for (
      let x = o.left;
      x + o.width <= imageWidth - o.right;
      x += o.width + o.spacing
    ) {
      rects.push({ x, y });
      if (rects.length > 10000)
        throw new Error("1回の分割は10,000タイル以下にしてください。");
    }
  if (!rects.length) throw new Error("画像内に収まるタイルがありません。");
  return rects;
}
export async function splitImage(
  blob: Blob,
  options: SplitOptions,
): Promise<{ name: string; blob: Blob }[]> {
  const image = await createImageBitmap(blob);
  try {
    const rects = tileRects(image.width, image.height, options);
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(options.width, options.height)
        : Object.assign(document.createElement("canvas"), {
            width: options.width,
            height: options.height,
          });
    const ctx = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("Canvasを使用できません。");
    const files = [];
    for (let i = 0; i < rects.length; i++) {
      const { x, y } = rects[i];
      ctx.clearRect(0, 0, options.width, options.height);
      ctx.drawImage(
        image,
        x,
        y,
        options.width,
        options.height,
        0,
        0,
        options.width,
        options.height,
      );
      if (
        options.skipEmpty &&
        !ctx
          .getImageData(0, 0, options.width, options.height)
          .data.some((v, i) => i % 4 === 3 && v > 0)
      )
        continue;
      const part =
        canvas instanceof HTMLCanvasSafe()
          ? await new Promise<Blob>((resolve, reject) =>
              (canvas as HTMLCanvasElement).toBlob(
                (b) =>
                  b ? resolve(b) : reject(new Error("PNG生成に失敗しました。")),
                "image/png",
              ),
            )
          : await (canvas as OffscreenCanvas).convertToBlob({
              type: "image/png",
            });
      files.push({
        name: `${options.prefix}_${String(i + 1).padStart(4, "0")}.png`,
        blob: part,
      });
    }
    return files;
  } finally {
    image.close();
  }
}
function HTMLCanvasSafe(): typeof HTMLCanvasElement {
  return typeof HTMLCanvasElement === "undefined"
    ? (class {} as typeof HTMLCanvasElement)
    : HTMLCanvasElement;
}
export function sanitizeSvg(source: string): Blob {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "svg"
  )
    throw new Error("SVGの形式が不正です。");
  const allowed = new Set([
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "defs",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "title",
    "desc",
  ]);
  const attrs = new Set([
    "xmlns",
    "viewBox",
    "width",
    "height",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-linecap",
    "stroke-linejoin",
    "opacity",
    "transform",
    "id",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "font-size",
    "text-anchor",
    "clip-path",
    "mask",
  ]);
  for (const el of [...doc.querySelectorAll("*")]) {
    if (!allowed.has(el.localName)) {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes])
      if (
        !attrs.has(attr.name) ||
        /javascript:|data:|https?:|\/\/|@import|expression\s*\(/i.test(
          attr.value,
        ) ||
        (/url\s*\(/i.test(attr.value) && !/^url\(#[\w-]+\)$/.test(attr.value))
      )
        el.removeAttribute(attr.name);
  }
  return new Blob(
    [new XMLSerializer().serializeToString(doc.documentElement)],
    { type: "image/svg+xml" },
  );
}
export async function loadImage(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function thumbnail(blob: Blob) {
  const mime = await imageMime(blob);
  const safe =
    mime === "image/svg+xml"
      ? sanitizeSvg(await blob.text())
      : blob.type === mime
        ? blob
        : new Blob([blob], { type: mime });
  const img = await loadImage(safe);
  const ratio = Math.min(
    1,
    256 / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("サムネイルを生成できません。")),
      "image/png",
    ),
  );
}
