import { loadImage } from "../canvas/images";
import { drawCharacter } from "../canvas/renderers";
import { validateWriteSize } from "../domain/metadata";
import type {
  CharacterComposition,
  CharacterLayer,
  StoredFile,
} from "../domain/models";
import { validateProject } from "../schemas/projects";
import { app, storage } from "./asset-service";
import { hashBlob } from "./media";
export interface BakedLayer {
  layer: CharacterLayer;
  file: StoredFile;
  blob: Blob;
  image: HTMLImageElement;
  sha256: string;
  name: string;
}
export async function prepareCharacterLayers(
  project: CharacterComposition,
  onProgress: (done: number, total: number) => void,
): Promise<BakedLayer[]> {
  validateProject("character", project);
  if (!project.layers.length) throw new Error("切り出すレイヤーがありません。");
  const ids = project.layers.map((l) => l.assetId);
  if (new Set(ids).size !== ids.length)
    throw new Error(
      "同じ元素材を複数レイヤーで使用しています。上書き先が重複するため切り出せません。",
    );
  const files = project.layers.map((layer) => {
    const file = app.files.find((f) => f.assetId === layer.assetId);
    if (file?.type !== "image" || file.mimeType === "image/svg+xml")
      throw new Error(
        "見つからない素材、または切り出しできない素材があります。参照を修正してください。",
      );
    return file;
  });
  const prepared: BakedLayer[] = [];
  for (let i = 0; i < project.layers.length; i++) {
    const layer = project.layers[i],
      file = files[i],
      metadata = await storage.getMetadata(file.fileId);
    if (metadata.version !== file.version)
      throw new Error(
        `${file.name} は更新されています。一覧を更新してから再実行してください。`,
      );
    const image = await loadImage(await app.blob(file)),
      canvas = document.createElement("canvas");
    drawCharacter(
      canvas,
      { ...project, layers: [{ ...layer, visible: true }] },
      () => image,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNGを作成できません。"))),
        "image/png",
      ),
    );
    const entry = {
      layer,
      file,
      blob,
      image: await loadImage(blob),
      sha256: await hashBlob(blob),
      name: `${file.name.replace(/\.[^.]+$/, "")}.png`,
    };
    prepared.push(entry);
    validateWriteSize(prepared.map((x) => x.blob.size));
    onProgress(i + 1, project.layers.length);
  }
  return prepared;
}
export async function overwriteBakedLayer(item: BakedLayer) {
  try {
    return await storage.updateContent(
      item.file.fileId,
      item.blob,
      item.file.version,
      { name: item.name },
    );
  } catch (error) {
    // A lost response can follow a successful write. Recover only an exact content match.
    const current = await storage
      .getMetadata(item.file.fileId)
      .catch(() => undefined);
    if (current?.sha256 === item.sha256 && current.name === item.name)
      return current;
    throw error;
  }
}
