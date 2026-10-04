import type { CharacterComposition, MapProject } from "../domain/models";
export type ImageResolver = (id: string) => CanvasImageSource | undefined;
export function drawMap(
  canvas: HTMLCanvasElement,
  project: MapProject,
  resolve: ImageResolver,
  grid = true,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = project.width * project.tileWidth;
  canvas.height = project.height * project.tileHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  for (const layer of project.layers) {
    if (!layer.visible) continue;
    ctx.globalAlpha = layer.opacity;
    for (let index = 0; index < layer.cells.length; index++) {
      const tile = layer.cells[index];
      if (tile < 0) continue;
      const ref = layer.tileset || project.tilesets[tile];
      const img = ref ? resolve(ref.assetId) : undefined;
      const x = (index % project.width) * project.tileWidth,
        y = Math.floor(index / project.width) * project.tileHeight;
      let drawn = false;
      if (img && layer.tileset) {
        const source = img as HTMLImageElement;
        const w = source.naturalWidth || Number(source.width),
          h = source.naturalHeight || Number(source.height);
        const tw = layer.tileset.tileWidth,
          th = layer.tileset.tileHeight,
          cols = Math.floor(w / tw);
        if (cols > 0 && tile < cols * Math.floor(h / th)) {
          ctx.drawImage(
            img,
            (tile % cols) * tw,
            Math.floor(tile / cols) * th,
            tw,
            th,
            x,
            y,
            project.tileWidth,
            project.tileHeight,
          );
          drawn = true;
        }
      } else if (img) {
        ctx.drawImage(img, x, y, project.tileWidth, project.tileHeight);
        drawn = true;
      }
      if (!drawn) {
        ctx.fillStyle = "#d88f93";
        ctx.fillRect(x, y, project.tileWidth, project.tileHeight);
        ctx.fillStyle = "#fff";
        ctx.fillText("?", x + 5, y + 14);
      }
    }
  }
  ctx.globalAlpha = 1;
  if (grid) {
    ctx.strokeStyle = "#344e3822";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= canvas.width; x += project.tileWidth) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
    }
    for (let y = 0; y <= canvas.height; y += project.tileHeight) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
    }
    ctx.stroke();
  }
}
export function drawCharacter(
  canvas: HTMLCanvasElement,
  project: CharacterComposition,
  resolve: ImageResolver,
) {
  canvas.width = project.canvas.width;
  canvas.height = project.canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  for (const layer of [...project.layers].sort((a, b) => a.zIndex - b.zIndex)) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.translate(layer.x, layer.y);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.scale(layer.scaleX, layer.scaleY);
    const image = resolve(layer.assetId);
    if (image) ctx.drawImage(image, 0, 0);
    else {
      ctx.fillStyle = "#d88f93";
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "#fff";
      ctx.fillText("素材なし", 5, 30);
    }
    ctx.restore();
  }
}
