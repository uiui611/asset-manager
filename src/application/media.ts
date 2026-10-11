import { type SplitOptions, sanitizeSvg, splitImage } from "../canvas/images";
import { imageMime } from "../domain/media-type";
export function workerJob<T>(
  type: "hash" | "split",
  blob: Blob,
  options?: SplitOptions,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/media.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.result);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("画像処理ワーカーでエラーが発生しました。"));
    };
    worker.postMessage({ type, blob, options });
  });
}
export const hashBlob = (blob: Blob) => workerJob<string>("hash", blob);
export async function split(blob: Blob, options: SplitOptions) {
  if (blob.type === "image/svg+xml") throw new Error("SVGはタイル分割できません。");
  return typeof OffscreenCanvas !== "undefined"
    ? workerJob<{ name: string; blob: Blob }[]>("split", blob, options)
    : splitImage(blob, options);
}
export async function validateImport(
  file: File,
): Promise<{ blob: Blob; type: "image" | "audio" | "json" }> {
  if (file.name.toLowerCase().endsWith(".json")) {
    if (file.size > 50_000_000) throw new Error("JSONは50 MB以下にしてください。");
    JSON.parse(await file.text());
    return {
      blob: new Blob([file], { type: "application/json" }),
      type: "json",
    };
  }
  const mime = await imageMime(file);
  if (mime === "image/svg+xml") {
    const blob = sanitizeSvg(await file.text());
    await validateImage(blob);
    return { blob, type: "image" };
  }
  if (mime) {
    const blob = file.type === mime ? file : new Blob([file], { type: mime });
    await validateImage(blob);
    return { blob, type: "image" };
  }
  if (file.type.startsWith("audio/")) {
    const audio = new Audio();
    if (!audio.canPlayType(file.type))
      throw new Error(`${file.name}: このブラウザで対応していない音声形式です。`);
    const url = URL.createObjectURL(file);
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("音声の読み込みがタイムアウトしました。")),
          15000,
        );
        audio.onloadedmetadata = () => {
          clearTimeout(timeout);
          resolve();
        };
        audio.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("音声データが不正です。"));
        };
        audio.src = url;
      });
    } finally {
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    }
    return { blob: file, type: "audio" };
  }
  throw new Error(`${file.name}: 画像・音声・JSONファイルを選んでください。`);
}
async function validateImage(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (img.naturalWidth * img.naturalHeight > 67_108_864)
      throw new Error("画像は6,700万画素以下にしてください。");
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const jsonBlob = (data: unknown) =>
  new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
