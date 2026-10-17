import { loadImage } from "../canvas/images";
import { drawCharacter } from "../canvas/renderers";
import { validateWriteSize } from "../domain/metadata";
import type { CharacterComposition, CharacterLayer, Operation, StoredFile } from "../domain/models";
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
  checkActive: () => void = () => {},
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
  const signal = storage.writeSignal;
  for (let i = 0; i < project.layers.length; i++) {
    checkActive();
    const layer = project.layers[i],
      file = files[i],
      metadata = await storage.getMetadata(file.fileId, signal);
    checkActive();
    if (metadata.version !== file.version)
      throw new Error(`${file.name} は更新されています。一覧を更新してから再実行してください。`);
    const image = await loadImage(await app.blob(file)),
      canvas = document.createElement("canvas");
    checkActive();
    drawCharacter(canvas, { ...project, layers: [{ ...layer, visible: true }] }, () => image);
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
    checkActive();
    prepared.push(entry);
    validateWriteSize(prepared.map((x) => x.blob.size));
    onProgress(i + 1, project.layers.length);
  }
  return prepared;
}
export async function overwriteBakedLayer(
  item: BakedLayer,
  onCreated: (operation: Operation) => void,
) {
  return app.startOperation(
    "content-update",
    [
      {
        id: item.file.assetId,
        fileId: item.file.fileId,
        name: item.name,
        expectedVersion: item.file.version,
        blob: item.blob,
        metadata: {
          ...item.file,
          name: item.name,
          mimeType: "image/png",
          size: item.blob.size,
          sha256: item.sha256,
        },
      },
    ],
    [],
    onCreated,
  );
}
