import {
  overwriteBakedLayer,
  prepareCharacterLayers,
} from "../../application/character-bake";
import { confirmAction } from "../../components/confirm-action";
import "../../components/asset-palette";
import { css, html, LitElement } from "lit";
import { currentProject } from "../../app/router";
import { app, storage } from "../../application/asset-service";
import {
  askName,
  confirmDiscard,
  editing,
  fingerprint,
} from "../../application/edit-session";
import { download, hashBlob, jsonBlob } from "../../application/media";
import { loadImage } from "../../canvas/images";
import { drawCharacter, drawMap } from "../../canvas/renderers";
import { icon } from "../../components/icon";
import { shared } from "../../components/styles";
import "../../components/asset-thumbnail";
import { editorKind } from "../../domain/library";
import { referenceIds } from "../../domain/metadata";
import {
  type CharacterComposition,
  type CharacterLayer,
  isRaster,
  type MapProject,
  now,
  type StoredFile,
  uid,
} from "../../domain/models";
import { validateProject } from "../../schemas/projects";

type EditorProject = MapProject | CharacterComposition;
const makeMap = (): MapProject => ({
  schemaVersion: 1,
  id: uid(),
  name: "",
  width: 16,
  height: 12,
  tileWidth: 32,
  tileHeight: 32,
  layers: [
    {
      id: uid(),
      name: "背景",
      visible: true,
      opacity: 1,
      locked: false,
      cells: Array(192).fill(-1),
      tileset: { assetId: "", tileWidth: 32, tileHeight: 32 },
    },
  ],
  tilesets: [],
  updatedAt: now(),
});
const makeCharacter = (): CharacterComposition => ({
  schemaVersion: 1,
  id: uid(),
  name: "",
  canvas: { width: 512, height: 512 },
  layers: [],
  updatedAt: now(),
});
export class EditorPage extends LitElement {
  static properties = {
    kind: { type: String },
    project: { state: true },
    layerId: { state: true },
    assetId: { state: true },
    tileIndex: { state: true },
    eraser: { state: true },
    grid: { state: true },
    saved: { state: true },
    projects: { state: true },
    showNew: { state: true },
    zoom: { state: true },
    aspectLocked: { state: true },
    baking: { state: true },
    bakeStatus: { state: true },
  };
  static styles = [
    shared,
    css`
    .workspace{display:grid;grid-template-columns:185px minmax(0,1fr) 220px;gap:14px;align-items:start}.tools{padding:16px;background:#fcfdfa;border:1px solid #e0e7d9;border-radius:11px;min-width:0}.tools h3{margin-bottom:13px}.tools label{margin-bottom:12px}.stage{border:1px solid #dce4d5;border-radius:10px;overflow:hidden;background:#edf1e6;min-width:0}.stage-head{padding:10px 13px;background:#fcfdfa;border-bottom:1px solid #dce4d5;display:flex;align-items:center;justify-content:space-between;gap:5px;font-size:10px}.stage-body{min-height:430px;max-height:70vh;overflow:auto;padding:25px;display:grid;place-items:start center}.stage canvas{display:block;box-shadow:0 3px 15px #34432812;touch-action:none;background:#fff;max-width:none}.stage-foot{font-size:10px;color:#8a9980;padding:9px 14px;border-top:1px solid #dce4d5;display:flex;justify-content:space-between}.layer{border:1px solid #e0e8d9;padding:9px;border-radius:7px;margin-bottom:7px;cursor:pointer;background:white}.layer.active{background:#edf3e4;border-color:#a8be95}.layer .row{gap:5px}.layer input[type=text]{padding:3px 5px;width:100%;font-size:11px}.layer button{padding:3px}.layer label{margin:0;font-size:10px}.palette{display:flex;flex-direction:column;gap:7px;max-height:400px;overflow:auto}.palette button{justify-content:flex-start;padding:7px;font-size:10px;min-width:0;text-align:left}.palette button.active{border-color:#92aa7c;background:#edf3e4}.palette img{width:30px;height:30px;object-fit:contain;image-rendering:pixelated}.palette span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mini-actions{display:flex;gap:6px;margin-bottom:15px;flex-wrap:wrap}.mini-actions button{font-size:10px;padding:7px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fields input{width:100%}.fields label{font-size:10px}.project-name{font-size:16px;font-weight:600;width:100%;margin-bottom:14px}.project-menu{max-width:250px}.missing{font-size:10px;color:#b05c54;margin-top:7px}.draft-label{font-size:10px;color:#8b9c7a}.empty-canvas{font-size:11px;padding:12px;color:#8b9a7b}.stage-tools{display:flex;gap:5px}.stage-tools button{font-size:10px;padding:4px 8px}.selected-tool{background:#e1ead6;border-color:#b2c99d}
    @media(max-width:1200px){.workspace{grid-template-columns:150px minmax(0,1fr)}.inspector{grid-column:1/-1}.inspector .layer-list{display:flex;gap:8px;flex-wrap:wrap}.inspector .layer{min-width:150px}.stage-body{padding:15px}.fields{grid-template-columns:repeat(4,1fr)}}@media(max-width:760px){.workspace{grid-template-columns:1fr}.stage-body{min-height:300px}.palette{max-height:130px;flex-direction:row;flex-wrap:wrap}.palette button{max-width:150px}.tools{padding:12px}.fields{grid-template-columns:1fr 1fr}.project-menu{max-width:100%}}
  `,
  ];
  kind: "map" | "character" = "map";
  project: EditorProject = makeMap();
  layerId = "";
  assetId = "";
  tileIndex = 0;
  eraser = false;
  grid = true;
  saved = "未保存";
  projects: { id: string; name: string; dirty: boolean }[] = [];
  showNew = false;
  zoom = 1;
  private images = new Map<string, HTMLImageElement>();
  private imageVersions = new Map<string, string>();
  private history: EditorProject[] = [];
  private redoHistory: EditorProject[] = [];
  private painting = false;
  private drag?: {
    pointerId: number;
    layer: CharacterLayer;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    ratioX: number;
    ratioY: number;
    started: boolean;
  };
  private startDrag(event: PointerEvent) {
    if (event.button !== 0 || app.busy || !("canvas" in this.project)) return;
    const layer = this.project.layers.find((l) => l.id === this.layerId);
    if (!layer?.visible) return;
    const canvas = event.currentTarget as HTMLCanvasElement,
      rect = canvas.getBoundingClientRect();
    this.drag = {
      pointerId: event.pointerId,
      layer,
      clientX: event.clientX,
      clientY: event.clientY,
      x: layer.x,
      y: layer.y,
      ratioX: canvas.width / rect.width,
      ratioY: canvas.height / rect.height,
      started: false,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus();
    event.preventDefault();
  }
  private moveDrag(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId || app.busy) return;
    const x = drag.x + Math.round((event.clientX - drag.clientX) * drag.ratioX),
      y = drag.y + Math.round((event.clientY - drag.clientY) * drag.ratioY);
    if (x === drag.layer.x && y === drag.layer.y) return;
    if (!drag.started) {
      this.snapshot();
      drag.started = true;
    }
    drag.layer.x = x;
    drag.layer.y = y;
    this.changed();
  }
  private endPointer() {
    this.painting = false;
    this.drag = undefined;
  }
  private wheelListener = {
    handleEvent: (event: WheelEvent) => this.wheelZoom(event),
    passive: false,
  };
  private wheelZoom = (event: WheelEvent) => {
    if (this.kind !== "character" || app.busy || this.drag || !event.deltaY)
      return;
    event.preventDefault();
    const delta =
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
    this.zoom = Math.min(
      16,
      Math.max(
        0.05,
        this.zoom * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002),
      ),
    );
  };
  private loadedKind = "";
  aspectLocked = true;
  baking = false;
  bakeStatus = "";
  private locked = () => this.baking;
  private baseline = "";
  private version?: string;
  private dirty = () => this.baseline !== fingerprint(this.project);
  private keydown = (event: KeyboardEvent) => {
    if (
      app.busy ||
      this.drag ||
      document.querySelector("dialog[open]") ||
      event
        .composedPath()
        .some(
          (el) =>
            el instanceof HTMLElement &&
            (el.matches("input,textarea,select") || el.isContentEditable),
        )
    )
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      this.undo(event.shiftKey);
      return;
    }
    if (this.kind !== "character" || "tilesets" in this.project) return;
    const layer = this.project.layers.find((l) => l.id === this.layerId);
    if (
      !layer ||
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "+",
        "=",
        "-",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    this.edit(() => {
      const step = event.shiftKey ? 10 : 1;
      if (event.key === "ArrowLeft") layer.x -= step;
      if (event.key === "ArrowRight") layer.x += step;
      if (event.key === "ArrowUp") layer.y -= step;
      if (event.key === "ArrowDown") layer.y += step;
      if (["+", "=", "-"].includes(event.key)) {
        const factor = event.key === "-" ? 1 / 1.1 : 1.1;
        const bounded = Math.max(
          0.01 / Math.min(layer.scaleX, layer.scaleY),
          Math.min(factor, 100 / Math.max(layer.scaleX, layer.scaleY)),
        );
        layer.scaleX *= bounded;
        layer.scaleY *= bounded;
      }
    });
  };
  private renderSequence = 0;
  private change = () => {
    this.requestUpdate();
    void this.refreshProjects();
    void this.loadImages();
  };
  connectedCallback() {
    super.connectedCallback();
    app.addEventListener("change", this.change);
    editing.dirty = this.dirty;
    editing.locked = this.locked;
    window.addEventListener("keydown", this.keydown);
  }
  protected firstUpdated() {
    const id = currentProject();
    if (id) void this.openFromLibrary(id);
  }
  private async openFromLibrary(id: string) {
    try {
      await app.refresh();
      await app.whenIdle();
      if (this.isConnected) await this.open(id);
    } catch (error) {
      app.error = String(error);
      app.changed();
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    app.removeEventListener("change", this.change);
    if (editing.dirty === this.dirty) editing.dirty = () => false;
    if (editing.locked === this.locked) editing.locked = () => false;
    window.removeEventListener("keydown", this.keydown);

    this.endPointer();
    this.renderSequence++;
  }
  protected willUpdate(changes: Map<string, unknown>) {
    if (changes.has("kind") && this.loadedKind !== this.kind) {
      this.loadedKind = this.kind;
      this.project = this.kind === "map" ? makeMap() : makeCharacter();
      this.layerId = this.project.layers[0]?.id || "";
      this.history = [];
      this.redoHistory = [];
      this.saved = "未保存";
      this.baseline = fingerprint(this.project);
      this.version = undefined;
      void this.refreshProjects();
    }
  }
  protected updated() {
    this.draw();
  }
  private async refreshProjects() {
    this.projects = app.files
      .filter((f) => editorKind(f) === this.kind)
      .map((f) => ({
        id: f.assetId,
        name: f.name.replace(/\.json$/, ""),
        dirty: false,
      }));
  }
  private async loadImages() {
    const seq = ++this.renderSequence;
    const needed = new Set(
      [...referenceIds(this.project), this.assetId].filter(Boolean),
    );
    for (const id of needed) {
      const file = app.files.find((f) => f.assetId === id);
      if (!file || !isRaster(file)) {
        this.images.delete(id);
        this.imageVersions.delete(id);
        continue;
      }
      if (this.images.has(id) && this.imageVersions.get(id) === file.version)
        continue;
      this.images.delete(id);
      if (file && isRaster(file) && storage.connected)
        try {
          const blob = await app.blob(file);
          if (blob.type === "image/svg+xml") continue;
          const image = await loadImage(blob);
          if (seq !== this.renderSequence || !this.isConnected) return;
          this.images.set(id, image);
          this.imageVersions.set(id, file.version);
        } catch {
          /* Missing references are rendered as explicit placeholders. */
        }
    }
    this.draw();
  }
  private draw() {
    const canvas =
      this.renderRoot.querySelector<HTMLCanvasElement>("#editor-canvas");
    if (!canvas) return;
    if ("tilesets" in this.project)
      drawMap(canvas, this.project, (id) => this.images.get(id), this.grid);
    else drawCharacter(canvas, this.project, (id) => this.images.get(id));
    this.drawTileset();
  }
  private pickSequence = 0;
  private async pickAsset(file: StoredFile) {
    const sequence = ++this.pickSequence;
    this.assetId = file.assetId;
    this.eraser = false;
    if ("tilesets" in this.project) {
      const project = this.project,
        layer = project.layers.find((l) => l.id === this.layerId);
      if (!layer || layer.locked) return;
      try {
        const image = await loadImage(await app.blob(file));
        if (
          sequence !== this.pickSequence ||
          this.project !== project ||
          !this.isConnected
        )
          return;
        this.images.set(file.assetId, image);
        this.imageVersions.set(file.assetId, file.version);
        this.edit(() => {
          layer.tileset = {
            assetId: file.assetId,
            tileWidth: Math.min(
              layer.tileset?.tileWidth || project.tileWidth,
              image.naturalWidth,
            ),
            tileHeight: Math.min(
              layer.tileset?.tileHeight || project.tileHeight,
              image.naturalHeight,
            ),
          };
        });
        this.tileIndex = 0;
      } catch (error) {
        app.error = String(error);
        app.changed();
      }
    } else await this.loadImages();
  }
  private tilesetControls() {
    if (!("tilesets" in this.project)) return "";
    const layer = this.project.layers.find((l) => l.id === this.layerId),
      sheet = layer?.tileset;
    if (!sheet?.assetId)
      return html`<p class="muted">このレイヤーで使うタイル画像セットを選択してください。</p>`;
    return html`<div class="fields" style="margin-top:12px">${(
      ["tileWidth", "tileHeight"] as const
    ).map(
      (key, i) =>
        html`<label>${i ? "コマ高さ" : "コマ幅"}<input aria-label=${i ? "タイルセットのコマ高さ" : "タイルセットのコマ幅"} type="number" min="1" max="4096" .value=${String(sheet[key])} ?disabled=${layer?.locked} @change=${(
          e: Event,
        ) => {
          const n = Number((e.target as HTMLInputElement).value);
          if (Number.isInteger(n) && n >= 1 && n <= 4096) {
            this.edit(() => (sheet[key] = n));
            this.tileIndex = 0;
          }
        }}></label>`,
    )}</div><p>描画するタイル: ${this.tileIndex + 1}</p><canvas id="tileset-canvas" aria-label="タイルセットのコマ選択" style="width:100%;height:auto;image-rendering:pixelated;cursor:crosshair" @click=${(
      e: MouseEvent,
    ) => {
      const canvas = e.currentTarget as HTMLCanvasElement,
        r = canvas.getBoundingClientRect(),
        cols = Math.floor(canvas.width / sheet.tileWidth),
        rows = Math.floor(canvas.height / sheet.tileHeight),
        x = Math.floor(
          (((e.clientX - r.left) / r.width) * canvas.width) / sheet.tileWidth,
        ),
        y = Math.floor(
          (((e.clientY - r.top) / r.height) * canvas.height) / sheet.tileHeight,
        );
      if (x >= 0 && x < cols && y >= 0 && y < rows)
        this.tileIndex = y * cols + x;
    }}></canvas>`;
  }
  private drawTileset() {
    if (!("tilesets" in this.project)) return;
    const sheet = this.project.layers.find(
        (l) => l.id === this.layerId,
      )?.tileset,
      canvas =
        this.renderRoot.querySelector<HTMLCanvasElement>("#tileset-canvas");
    if (!sheet || !canvas) return;
    const image = this.images.get(sheet.assetId),
      ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = image?.naturalWidth || 32;
    canvas.height = image?.naturalHeight || 32;
    if (!image) return;
    ctx.drawImage(image, 0, 0);
    const cols = Math.floor(canvas.width / sheet.tileWidth),
      rows = Math.floor(canvas.height / sheet.tileHeight);
    if (this.tileIndex >= cols * rows) this.tileIndex = 0;
    ctx.strokeStyle = "#ffffff88";
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      ctx.moveTo(x * sheet.tileWidth, 0);
      ctx.lineTo(x * sheet.tileWidth, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * sheet.tileHeight);
      ctx.lineTo(canvas.width, y * sheet.tileHeight);
      ctx.stroke();
    }
    if (cols) {
      ctx.strokeStyle = "#ff6c00";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        (this.tileIndex % cols) * sheet.tileWidth + 1,
        Math.floor(this.tileIndex / cols) * sheet.tileHeight + 1,
        sheet.tileWidth - 2,
        sheet.tileHeight - 2,
      );
    }
  }
  private snapshot() {
    this.history.push(structuredClone(this.project));
    if (this.history.length > 40) this.history.shift();
    this.redoHistory = [];
  }
  private changed() {
    this.project = { ...this.project, updatedAt: now() };
    this.saved = this.dirty()
      ? "未保存の変更"
      : this.version
        ? "保存済み"
        : "未保存";
    this.requestUpdate();
    this.draw();
  }
  private edit(action: () => void) {
    if (this.baking) return;
    this.snapshot();
    action();
    this.changed();
  }
  private undo(redo = false) {
    if (this.baking) return;
    const from = redo ? this.redoHistory : this.history;
    const to = redo ? this.history : this.redoHistory;
    const previous = from.pop();
    if (previous) {
      to.push(structuredClone(this.project));
      this.project = { ...previous, id: this.project.id };
      this.layerId = this.project.layers.some((l) => l.id === this.layerId)
        ? this.layerId
        : this.project.layers[0]?.id || "";
      this.changed();
      void this.loadImages();
    }
  }
  private async open(id: string) {
    if (app.busy) return;
    if (!id) return;
    if (!(await confirmDiscard())) return;
    const file = app.files.find((f) => f.assetId === id);
    if (!file) return;
    const project = await app.run(() => app.openProject(file));
    if (project) {
      validateProject(this.kind, project);
      this.project = project as EditorProject;
      this.layerId = this.project.layers[0]?.id || "";
      this.history = [];
      this.redoHistory = [];
      this.saved = "保存済み";
      this.baseline = fingerprint(this.project);
      this.version = file.version;
      this.fitCanvas();
      void this.loadImages();
    }
  }
  private async newProject() {
    if (app.busy) return;
    if (!(await confirmDiscard())) return;
    this.project = this.kind === "map" ? makeMap() : makeCharacter();
    this.layerId = this.project.layers[0]?.id || "";
    this.history = [];
    this.redoHistory = [];
    this.saved = "未保存";
    this.baseline = fingerprint(this.project);
    this.version = undefined;
    this.assetId = "";
    this.zoom = 1;
    this.showNew = this.kind === "map";
    void this.refreshProjects();
  }
  private paint(e: PointerEvent) {
    if (!("tilesets" in this.project)) return;
    const layer = this.project.layers.find((l) => l.id === this.layerId);
    if (
      !layer ||
      layer.locked ||
      !layer.visible ||
      (!this.eraser && !layer.tileset?.assetId)
    )
      return;
    const canvas = e.currentTarget as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * this.project.width),
      y = Math.floor(((e.clientY - r.top) / r.height) * this.project.height);
    if (x < 0 || y < 0 || x >= this.project.width || y >= this.project.height)
      return;
    layer.cells[y * this.project.width + x] = this.eraser ? -1 : this.tileIndex;
    this.changed();
  }
  private addLayer() {
    this.edit(() => {
      if ("tilesets" in this.project) {
        const layer = {
          id: uid(),
          name: `レイヤー ${this.project.layers.length + 1}`,
          visible: true,
          opacity: 1,
          locked: false,
          cells: Array(this.project.width * this.project.height).fill(-1),
          tileset: {
            assetId: "",
            tileWidth: this.project.tileWidth,
            tileHeight: this.project.tileHeight,
          },
        };
        this.project.layers.push(layer);
        this.layerId = layer.id;
      } else {
        if (!this.assetId) return;
        const layer = {
          id: uid(),
          assetId: this.assetId,
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: 1,
          visible: true,
          zIndex: this.project.layers.length,
        };
        this.project.layers.push(layer);
        this.layerId = layer.id;
      }
    });
    void this.loadImages();
  }
  private removeLayer() {
    this.edit(() => {
      if ("tilesets" in this.project) {
        if (this.project.layers.length <= 1) return;
        this.project.layers = this.project.layers.filter(
          (l) => l.id !== this.layerId,
        );
      } else
        this.project.layers = this.project.layers.filter(
          (l) => l.id !== this.layerId,
        );
      this.layerId = this.project.layers[0]?.id || "";
    });
  }
  private moveLayer(direction: number) {
    this.edit(() => {
      const layers = this.project.layers;
      const index = layers.findIndex((l) => l.id === this.layerId);
      const next = index + direction;
      if (next < 0 || next >= layers.length) return;
      [layers[index], layers[next]] = [layers[next], layers[index]];
      if (!("tilesets" in this.project))
        this.project.layers.forEach((l, i) => {
          l.zIndex = i;
        });
    });
  }
  private async save(asCopy = false) {
    if (app.busy) return;
    const name =
      asCopy || !this.project.name.trim()
        ? await askName(asCopy ? this.project.name : "")
        : this.project.name.trim();
    if (!name) return;
    const originalName = this.project.name;
    const snapshot = structuredClone(this.project);
    snapshot.name = name;
    if (asCopy) snapshot.id = uid();
    const result = await app.run(async () => {
      if ("canvas" in snapshot) {
        await this.loadImages();
        const canvas = document.createElement("canvas");
        drawCharacter(canvas, snapshot, (id) => this.images.get(id));
        const preview = document.createElement("canvas");
        const scale = Math.min(1, 192 / Math.max(canvas.width, canvas.height));
        preview.width = Math.max(1, Math.round(canvas.width * scale));
        preview.height = Math.max(1, Math.round(canvas.height * scale));
        preview
          .getContext("2d")
          ?.drawImage(canvas, 0, 0, preview.width, preview.height);
        snapshot.previewImage = preview.toDataURL("image/png");
      }
      return app.saveProject(
        this.kind,
        snapshot,
        asCopy ? undefined : this.version,
      );
    });
    if (result) {
      this.version = result.version;
      this.project = {
        ...this.project,
        id: snapshot.id,
        name:
          this.project.name === originalName
            ? snapshot.name
            : this.project.name,
      };
      this.baseline = fingerprint(snapshot);
      this.saved = this.dirty() ? "未保存の変更" : "保存済み";
    }
  }
  private async useBase() {
    if ("tilesets" in this.project || !this.assetId) return;
    await this.loadImages();
    const image = this.images.get(this.assetId);
    if (!image) return;
    if (image.naturalWidth > 4096 || image.naturalHeight > 4096) {
      app.error = "ベース画像は4096 × 4096 px以下にしてください。";
      app.changed();
      return;
    }
    this.addLayer();
    if ("canvas" in this.project)
      this.project.canvas = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
    this.fitCanvas();
    this.changed();
  }
  private fitCanvas() {
    if (!("canvas" in this.project)) return;
    const available =
      this.renderRoot.querySelector(".stage-body")?.clientWidth || 600;
    this.zoom = Math.min(
      16,
      Math.max(0.05, (available - 50) / this.project.canvas.width),
      500 / this.project.canvas.height,
    );
  }
  private async exportJson() {
    const name = this.project.name.trim() || (await askName("", true));
    if (name) download(jsonBlob({ ...this.project, name }), `${name}.json`);
  }
  private async bakeLayers() {
    if (this.baking || app.busy || !("canvas" in this.project)) return;
    this.baking = true;
    try {
      const name = this.project.name.trim() || (await askName());
      if (!name) return;
      if (
        !(await confirmAction(
          "元素材を切り出して上書き",
          `${this.project.layers.length}レイヤーをキャンバスサイズのPNGに切り出します。非表示レイヤーも対象です。\n位置・倍率・回転・透明度を画像に反映し、JSONも保存します。元素材を使うほかの編集データにも影響します。\n元の画像とこの操作以前のUndo履歴は戻せません。PNG以外の素材名は.pngになります。`,
          "上書きして保存",
        ))
      )
        return;
      this.endPointer();
      this.bakeStatus = "切り出しを準備中…";
      const snapshot = structuredClone(this.project) as CharacterComposition;
      snapshot.name = name;
      const cancellation = app.cancellationToken;
      await app.run(async () => {
        if (this.version) {
          const current = await storage.getMetadata(snapshot.id);
          if (current.version !== this.version)
            throw new Error(
              "このJSONは別の操作で更新されています。開き直してから実行してください。",
            );
        }
        const items = await prepareCharacterLayers(snapshot, (done, total) => {
          if (cancellation !== app.cancellationToken)
            throw new Error("切り出し保存を中断しました。");
          this.bakeStatus = `切り出しを準備中 · ${done} / ${total} 件`;
        });
        this.history = [];
        this.redoHistory = [];
        let done = 0,
          failure: unknown;
        const queue = [...items];
        const progress = {
          id: uid(),
          label: "元素材の上書き",
          done: 0,
          total: items.length,
        };
        app.transfers = [...app.transfers, progress];
        app.changed();
        try {
          await Promise.all(
            Array.from({ length: Math.min(2, items.length) }, async () => {
              while (
                queue.length &&
                !failure &&
                cancellation === app.cancellationToken
              ) {
                const item = queue.shift();
                if (!item) return;
                try {
                  const file = await overwriteBakedLayer(item);
                  Object.assign(item.layer, {
                    x: 0,
                    y: 0,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 1,
                  });
                  this.images.set(file.assetId, item.image);
                  this.imageVersions.set(file.assetId, file.version);
                  this.project = structuredClone(snapshot);
                  this.changed();
                  done++;
                  await app.putFile(file);
                  progress.done = done;
                  this.bakeStatus = `元素材を上書き中 · ${done} / ${items.length} 件`;
                  app.changed();
                } catch (error) {
                  failure = error;
                }
              }
            }),
          );
          if (done) {
            this.project = structuredClone(snapshot);
            this.changed();
            snapshot.updatedAt = this.project.updatedAt;
            const canvas = document.createElement("canvas");
            drawCharacter(canvas, snapshot, (id) => this.images.get(id));
            const preview = document.createElement("canvas"),
              scale = Math.min(1, 192 / Math.max(canvas.width, canvas.height));
            preview.width = Math.max(1, Math.round(canvas.width * scale));
            preview.height = Math.max(1, Math.round(canvas.height * scale));
            preview
              .getContext("2d")
              ?.drawImage(canvas, 0, 0, preview.width, preview.height);
            snapshot.previewImage = preview.toDataURL("image/png");
            this.bakeStatus = "編集用JSONを保存中…";
            try {
              const saved = await app.saveProject(
                "character",
                snapshot,
                this.version,
              );
              this.version = saved.version;
              this.project = snapshot;
              this.baseline = fingerprint(snapshot);
              this.saved = "保存済み";
            } catch (error) {
              throw new Error(
                `元素材を${done}件上書きしましたが、JSONを保存できませんでした。画面を閉じず「保存する」または「別名で保存する」で保存してください。${String(error)}`,
              );
            }
          }
          if (queue.length && !failure)
            failure = new Error("切り出し保存を中断しました。");
          if (failure)
            throw new Error(
              `${done} / ${items.length} 件を上書きしました。未完了のレイヤーは元の設定を保持しています。${String(failure)}`,
            );
          this.bakeStatus = `${done}件の元素材とJSONを保存しました。`;
        } finally {
          app.transfers = app.transfers.filter((p) => p.id !== progress.id);
          app.changed();
        }
      });
    } finally {
      this.baking = false;
      if (app.error)
        this.bakeStatus =
          "切り出し保存を完了できませんでした。上のエラーを確認してください。";
      this.requestUpdate();
    }
  }
  private async exportPng() {
    if ("tilesets" in this.project) return;
    const name = this.project.name.trim() || (await askName());
    if (!name) return;
    await app.run(async () => {
      app.requireConnected();
      await this.loadImages();

      const canvas = document.createElement("canvas");
      drawCharacter(canvas, this.project as CharacterComposition, (id) =>
        this.images.get(id),
      );
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("PNGを生成できません。"))),
          "image/png",
        ),
      );
      const id = uid();
      await app.startOperation(
        "upload",
        [
          {
            id,
            name: `${name}.png`,
            blob,
            metadata: {
              assetId: id,
              type: "image",
              tagIds: [],
              sha256: await hashBlob(blob),
            },
          },
        ],
        [this.project.id],
      );
    });
  }
  private async importJson(file?: File) {
    if (app.busy) return;
    if (!file || !(await confirmDiscard())) return;
    await app.run(async () => {
      if (file.size > 20_000_000)
        throw new Error("編集用JSONJSONは20 MB以下にしてください。");
      const project = JSON.parse(await file.text());
      validateProject(this.kind, project);
      if (
        "tilesets" in project &&
        project.width *
          project.tileWidth *
          project.height *
          project.tileHeight >
          16_777_216
      )
        throw new Error("描画サイズが大きすぎます。");
      project.id = uid();
      this.version = undefined;
      this.project = project as EditorProject;
      this.layerId = this.project.layers[0]?.id || "";
      this.history = [];
      this.changed();
      await this.loadImages();
    });
  }
  render() {
    const p = this.project;
    const map = "tilesets" in p ? p : undefined;
    const character = "canvas" in p ? p : undefined;
    const selectedLayer = p.layers.find((l) => l.id === this.layerId);
    const rasters = app.files.filter((f) => isRaster(f));
    const missing = referenceIds(p).filter(
      (id) => !app.files.some((f) => f.assetId === id),
    );
    const width = map
      ? map.width * map.tileWidth
      : character?.canvas.width || 512;
    const height = map
      ? map.height * map.tileHeight
      : character?.canvas.height || 512;
    return html`<div class="page-head"><div><div class="eyebrow" style="margin-bottom:7px">${map ? "MAKE ROOM FOR ADVENTURE" : "BRING YOUR CHARACTERS TO LIFE"}</div><h1>${map ? "マップエディター" : "キャラクター合成"}</h1><p>${map ? "タイルを並べて、冒険の舞台を描こう。" : "レイヤーを重ねて、表情と個性をつくろう。"}</p></div><div class="row"><button ?disabled=${app.busy} @click=${() => this.newProject()}>${icon("plus", 15)}新規作成</button><button class="primary" ?disabled=${app.busy || !storage.connected} @click=${() => this.save()}>${icon("cloud", 16)}保存する</button><button ?disabled=${app.busy || !storage.connected} @click=${() => this.save(true)}>別名で保存する</button></div></div>
    <div class="toolbar" ?inert=${this.baking}><select aria-label="開く" class="project-menu" @change=${(
      e: Event,
    ) => {
      void this.open((e.target as HTMLSelectElement).value);
      (e.target as HTMLSelectElement).value = "";
    }}><option value="">開く…</option>${this.projects.map((project) => html`<option value=${project.id}>${project.name}${project.dirty ? " · 下書き" : ""}</option>`)}</select><button class="small" @click=${() => this.renderRoot.querySelector<HTMLInputElement>("#json-import")?.click()}>インポート</button><input id="json-import" class="sr-only" type="file" accept=".json,application/json" @change=${(
      e: Event,
    ) => {
      const input = e.target as HTMLInputElement;
      void this.importJson(input.files?.[0]);
      input.value = "";
    }}><button class="small" title="端末へダウンロード" @click=${() => this.exportJson()}>${icon("download", 13)}エクスポート</button>${character ? html`<button class="small" ?disabled=${app.busy || !storage.connected || !character.layers.length} @click=${() => this.exportPng()}>合成PNGをストレージへ</button><button class="small" ?disabled=${app.busy || !storage.connected || !character.layers.length} @click=${() => this.bakeLayers()}>元素材を切り出して上書き</button>` : ""}<span class="draft-label" role="status">${this.saved}</span></div>
    ${missing.length ? html`<div class="notice error" style="margin-bottom:16px">${missing.length}件の素材が見つかりません。${map ? "編集と保存を続けられます。各レイヤーの素材パレットで差し替えできます。" : "レイヤーの素材を差し替えるか削除してください。"}</div>` : ""}
    ${this.bakeStatus ? html`<p class="notice" role="status">${this.bakeStatus}</p>` : ""}<div class="workspace" ?inert=${this.baking}><aside class="tools"><h3>${icon("image", 15)} 素材パレット</h3><asset-palette .selected=${map?.layers.find((l) => l.id === this.layerId)?.tileset?.assetId || this.assetId} @pick-asset=${(e: CustomEvent<StoredFile>) => this.pickAsset(e.detail)}></asset-palette>${map ? this.tilesetControls() : ""}${character ? html`<button style="margin-top:14px;width:100%" class="small" ?disabled=${!this.assetId} @click=${() => (character.layers.length ? this.addLayer() : this.useBase())}>${icon("plus", 13)}${character.layers.length ? "レイヤーに追加" : "ベース画像にする"}</button>` : ""}<p class="muted" style="font-size:10px;margin-top:16px">SVGは合成に使用できません。</p></aside>
    <section class="stage"><div class="stage-head"><span>${map ? "ORTHOGONAL MAP" : "COMPOSITION"} · ${width} × ${height}</span><div class="stage-tools"><button aria-label="元に戻す" ?disabled=${!this.history.length} @click=${() => this.undo()}>↶</button><button aria-label="やり直す" ?disabled=${!this.redoHistory.length} @click=${() => this.undo(true)}>↷</button>${map ? html`<button class=${this.eraser ? "selected-tool" : ""} @click=${() => (this.eraser = !this.eraser)}>消しゴム</button><button class=${this.grid ? "selected-tool" : ""} @click=${() => (this.grid = !this.grid)}>グリッド</button>` : ""}<select aria-label="表示倍率" .value=${String(this.zoom)} @change=${(e: Event) => (this.zoom = Number((e.target as HTMLSelectElement).value))} style="padding:2px;font-size:10px">${[...new Set([0.25, 0.5, 1, 2, this.zoom])].sort((a, b) => a - b).map((z) => html`<option value=${z} .selected=${z === this.zoom}>${Math.round(z * 100)}%</option>`)}</select></div></div><div class="stage-body checker" @wheel=${this.wheelListener}><canvas tabindex="0" id="editor-canvas" aria-label=${map ? "マップ描画キャンバス" : "キャラクター合成プレビュー"} style=${`width:${width * this.zoom}px;height:${height * this.zoom}px;cursor:${character ? "move" : "crosshair"}`} @pointerdown=${(
      e: PointerEvent,
    ) => {
      if (app.busy || e.button !== 0) return;
      if (character) this.startDrag(e);
      if (map) {
        this.snapshot();
        this.painting = true;
        (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
        this.paint(e);
      }
    }} @pointermove=${(e: PointerEvent) => {
      if (this.painting) this.paint(e);
      this.moveDrag(e);
    }} @pointerup=${() => this.endPointer()} @pointercancel=${() => this.endPointer()} @lostpointercapture=${() => this.endPointer()}></canvas></div><div class="stage-foot"><span>${map ? `${map.width} × ${map.height} セル · ${map.tileWidth} px タイル` : `${character?.layers.length} レイヤー`}</span><span>${map ? "素材を選んでドラッグで描画" : "ドラッグ・矢印: 移動 · ホイール: 表示倍率 · ＋／−: レイヤー倍率"}</span></div></section>
    <aside class="tools inspector"><input class="project-name" placeholder="名前なし" aria-label="編集用JSON名" .value=${p.name} @input=${(
      e: Event,
    ) =>
      this.edit(() => {
        p.name = (e.target as HTMLInputElement).value;
      })}><div class="row spread" style="margin-bottom:12px"><h3 style="margin:0">${icon("layers", 15)} レイヤー</h3>${map ? html`<button class="small quiet" aria-label="レイヤーを追加" @click=${() => this.addLayer()}>${icon("plus", 15)}</button>` : ""}</div><div class="layer-list">${[
      ...p.layers,
    ]
      .reverse()
      .map(
        (layer) =>
          html`<div class="layer ${layer.id === this.layerId ? "active" : ""}"><div class="row"><input type="checkbox" aria-label="レイヤー表示" .checked=${layer.visible} @change=${(
            e: Event,
          ) =>
            this.edit(() => {
              layer.visible = (e.target as HTMLInputElement).checked;
            })}><button class="quiet small" style="flex:1;overflow:hidden;justify-content:flex-start" @click=${() => {
            this.layerId = layer.id;
            this.tileIndex = 0;
          }}>${"name" in layer ? layer.name : app.files.find((f) => f.assetId === layer.assetId)?.name || "素材が見つかりません"}</button></div></div>`,
      )}</div><div class="mini-actions"><button aria-label="レイヤーを上へ" @click=${() => this.moveLayer(1)}>↑</button><button aria-label="レイヤーを下へ" @click=${() => this.moveLayer(-1)}>↓</button><button class="danger" ?disabled=${!selectedLayer || (!!map && map.layers.length <= 1)} @click=${() => this.removeLayer()}>削除</button></div>
    ${
      selectedLayer
        ? html`${
            "name" in selectedLayer
              ? html`<label>レイヤー名<input .value=${selectedLayer.name} @change=${(
                  e: Event,
                ) =>
                  this.edit(() => {
                    selectedLayer.name = (e.target as HTMLInputElement).value;
                  })}></label><label class="check"><input type="checkbox" .checked=${selectedLayer.locked} @change=${(
                  e: Event,
                ) =>
                  this.edit(() => {
                    selectedLayer.locked = (
                      e.target as HTMLInputElement
                    ).checked;
                  })}>編集をロック</label>`
              : html`<label>参照する素材<select .value=${selectedLayer.assetId} @change=${(
                  e: Event,
                ) => {
                  this.edit(() => {
                    selectedLayer.assetId = (
                      e.target as HTMLSelectElement
                    ).value;
                  });
                  void this.loadImages();
                }}><option value="">素材を選択</option>${rasters.map((f) => html`<option value=${f.assetId} .selected=${f.assetId === selectedLayer.assetId}>${f.name}</option>`)}</select></label><label class="check"><input type="checkbox" .checked=${this.aspectLocked} @change=${(e: Event) => (this.aspectLocked = (e.target as HTMLInputElement).checked)}>縦横比を維持</label><div class="fields">${(
                  [
                    ["x", "X座標"],
                    ["y", "Y座標"],
                    ["scaleX", "横倍率"],
                    ["scaleY", "縦倍率"],
                    ["rotation", "回転 (°)"],
                  ] as const
                ).map(
                  ([key, label]) =>
                    html`<label>${label}<input type="number" step=${key.startsWith("scale") ? 0.1 : 1} .value=${String((selectedLayer as CharacterLayer)[key])} @change=${(
                      e: Event,
                    ) => {
                      const value = Number(
                        (e.target as HTMLInputElement).value,
                      );
                      if (
                        Number.isFinite(value) &&
                        (!key.startsWith("scale") ||
                          (value >= 0.01 && value <= 100))
                      )
                        this.edit(() => {
                          const layer = selectedLayer as CharacterLayer;
                          if (
                            this.aspectLocked &&
                            (key === "scaleX" || key === "scaleY")
                          ) {
                            const other =
                              key === "scaleX" ? "scaleY" : "scaleX";
                            const next = (layer[other] * value) / layer[key];
                            if (next < 0.01 || next > 100) return;
                            layer[other] = next;
                          }
                          layer[key] = value;
                        });
                    }}></label>`,
                )}</div>`
          }<label>不透明度 ${Math.round(selectedLayer.opacity * 100)}%<input type="range" min="0" max="1" step="0.05" .value=${String(selectedLayer.opacity)} @change=${(
            e: Event,
          ) =>
            this.edit(() => {
              selectedLayer.opacity = Number(
                (e.target as HTMLInputElement).value,
              );
            })}></label>`
        : html`<p class="muted" style="font-size:11px">画像を選び、レイヤーに追加してください。</p>`
    }
    <hr class="divider"><button class="quiet small" style="margin-top:12px" @click=${() => (this.showNew = !this.showNew)}>キャンバス設定 ${this.showNew ? "−" : "＋"}</button>${
      this.showNew
        ? html`<div class="fields" style="margin-top:12px">${(
            map
              ? [
                  ["width", "横セル数"],
                  ["height", "縦セル数"],
                  ["tileWidth", "タイル幅"],
                  ["tileHeight", "タイル高さ"],
                ]
              : [
                  ["width", "幅 px"],
                  ["height", "高さ px"],
                ]
          ).map(
            ([key, label]) =>
              html`<label>${label}<input type="number" min="1" max=${map ? 128 : 4096} .value=${String(map ? map[key as "width"] : character?.canvas[key as "width"])} @change=${(
                e: Event,
              ) => {
                const n = Number((e.target as HTMLInputElement).value);
                if (!Number.isInteger(n) || n < 1 || n > (map ? 128 : 4096))
                  return;
                if (map) {
                  const proposed = { ...map, [key]: n };
                  if (
                    proposed.width *
                      proposed.height *
                      proposed.tileWidth *
                      proposed.tileHeight >
                    16_777_216
                  ) {
                    app.error =
                      "キャンバスは合計16,777,216画素以下にしてください。";
                    app.changed();
                    return;
                  }
                }
                this.edit(() => {
                  if (map) {
                    const oldWidth = map.width,
                      oldHeight = map.height;
                    map[key as "width"] = n;
                    for (const layer of map.layers) {
                      const old = layer.cells;
                      layer.cells = Array.from(
                        { length: map.width * map.height },
                        (_, i) => {
                          const x = i % map.width,
                            y = Math.floor(i / map.width);
                          return x < oldWidth && y < oldHeight
                            ? old[y * oldWidth + x]
                            : -1;
                        },
                      );
                    }
                  } else if (character) character.canvas[key as "width"] = n;
                });
              }}></label>`,
          )}</div>`
        : ""
    }</aside></div>
    ${
      map?.tilesets.length
        ? html`<div class="panel stack" style="margin-top:16px"><h3>マップの素材参照</h3>${map.tilesets.map(
            (ref, index) =>
              html`<div class="row"><span class="muted" style="font-size:11px;min-width:55px">#${index + 1}</span><select aria-label=${`素材参照 ${index + 1}`} .value=${ref.assetId} @change=${(
                e: Event,
              ) => {
                this.edit(() => {
                  ref.assetId = (e.target as HTMLSelectElement).value;
                });
                void this.loadImages();
              }}><option value="">素材が見つかりません</option>${rasters.map((f) => html`<option value=${f.assetId} .selected=${f.assetId === ref.assetId}>${f.name}</option>`)}</select><button class="small" @click=${() =>
                this.edit(() => {
                  for (const layer of map.layers.filter((l) => !l.tileset))
                    layer.cells = layer.cells.map((c) =>
                      c === index ? -1 : c > index ? c - 1 : c,
                    );
                  map.tilesets.splice(index, 1);
                })}>参照解除</button></div>`,
          )}</div>`
        : ""
    }`;
  }
}
customElements.define("editor-page", EditorPage);
