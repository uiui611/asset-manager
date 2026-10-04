import "../../components/asset-palette";
import "../../components/tile-composer";
import { css, html, LitElement, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { app, storage } from "../../application/asset-service";
import { validateImport } from "../../application/media";
import { loadImage, tileRects } from "../../canvas/images";
import "../../components/asset-thumbnail";
import { icon } from "../../components/icon";
import { shared } from "../../components/styles";
import { isRaster, type StoredFile } from "../../domain/models";
import { advanceFrame } from "../../domain/sprites";

export class SpritesPage extends LitElement {
  static properties = {
    selected: { state: true },
    showComposer: { state: true },
    name: { state: true },
    width: { state: true },
    height: { state: true },
    cellWidth: { state: true },
    cellHeight: { state: true },
    left: { state: true },
    top: { state: true },
    spacing: { state: true },
    fps: { state: true },
    start: { state: true },
    end: { state: true },
    frame: { state: true },
    loop: { state: true },
    zoom: { state: true },
    playing: { state: true },
    loading: { state: true },
    error: { state: true },
    frames: { state: true },
  };
  static styles = [
    shared,
    css`
    .workspace{display:grid;grid-template-columns:200px minmax(0,1fr) 230px;gap:18px;align-items:start}.palette{display:flex;flex-direction:column;gap:8px;max-height:520px;overflow:auto}.palette button{justify-content:flex-start;text-align:left;padding:7px;min-width:0}.palette span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.selected{border-color:#769360;background:#e9f0e0}.preview{min-height:300px;max-height:55vh;overflow:auto;display:grid;place-items:center;padding:24px;border-radius:10px}.preview canvas{image-rendering:pixelated;max-width:none}.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.position{font-variant-numeric:tabular-nums;font-size:12px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.fields input{width:100%}.sheet{width:auto;max-width:100%;height:auto;max-height:400px;align-self:start;image-rendering:pixelated;cursor:crosshair}.sheet-note{font-size:11px;color:#7c8d70}.name{overflow-wrap:anywhere}.panel{min-width:0}@media(max-width:1150px){.workspace{grid-template-columns:170px minmax(0,1fr)}.settings{grid-column:1/-1}.settings .fields{grid-template-columns:repeat(4,1fr)}}@media(max-width:760px){.workspace{grid-template-columns:1fr}.palette{max-height:170px}.settings .fields{grid-template-columns:1fr 1fr}.preview{min-height:220px}}
  `,
  ];
  selected = "";
  showComposer = false;
  name = "";
  width = 0;
  height = 0;
  cellWidth = 32;
  cellHeight = 32;
  left = 0;
  top = 0;
  spacing = 0;
  fps = 8;
  start = 1;
  end = 1;
  frame = 0;
  loop = true;
  zoom = 4;
  playing = false;
  loading = false;
  error = "";
  frames: { x: number; y: number }[] = [];
  private image?: HTMLImageElement;
  private generation = 0;
  private animation = 0;
  private lastTime = 0;
  private change = () => this.requestUpdate();
  private visibility = () => {
    if (document.hidden) this.pause();
  };
  connectedCallback() {
    super.connectedCallback();
    app.addEventListener("change", this.change);
    document.addEventListener("visibilitychange", this.visibility);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.pause();
    this.generation++;
    this.image = undefined;
    app.removeEventListener("change", this.change);
    document.removeEventListener("visibilitychange", this.visibility);
  }
  protected updated() {
    this.draw();
  }
  private async select(file: StoredFile) {
    await this.load(() => app.blob(file), file.name, file.assetId);
  }
  private async importImage(file?: File) {
    if (!file) return;
    await this.load(
      async () => {
        const result = await validateImport(file);
        if (result.type !== "image" || result.blob.type === "image/svg+xml")
          throw new Error("PNG・JPEG・WebPなどの画像を選んでください。");
        return result.blob;
      },
      file.name,
      "",
    );
  }
  private async load(getBlob: () => Promise<Blob>, name: string, id: string) {
    const generation = ++this.generation;
    this.pause();
    this.loading = true;
    this.error = "";
    try {
      const image = await loadImage(await getBlob());
      if (!this.isConnected || generation !== this.generation) return;
      this.image = image;
      this.name = name;
      this.selected = id;
      this.width = image.naturalWidth;
      this.height = image.naturalHeight;
      this.cellWidth = Math.min(32, this.width);
      this.cellHeight = Math.min(32, this.height);
      this.left = 0;
      this.top = 0;
      this.spacing = 0;
      this.frame = 0;
      this.start = 1;
      this.rebuild(true);
    } catch (error) {
      if (generation === this.generation)
        this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }
  private rebuild(resetRange = false) {
    this.pause();
    this.error = "";
    if (!this.image) return;
    try {
      if (this.cellWidth > 4096 || this.cellHeight > 4096)
        throw new Error("コマの幅・高さは4096px以下にしてください。");
      this.frames = tileRects(this.width, this.height, {
        width: this.cellWidth,
        height: this.cellHeight,
        left: this.left,
        top: this.top,
        right: 0,
        bottom: 0,
        spacing: this.spacing,
        skipEmpty: false,
        prefix: "",
      });
      this.start = resetRange ? 1 : Math.min(this.start, this.frames.length);
      this.end = resetRange
        ? this.frames.length
        : Math.max(this.start, Math.min(this.end, this.frames.length));
      this.frame = Math.max(this.start - 1, Math.min(this.end - 1, this.frame));
    } catch (error) {
      this.frames = [];
      this.frame = 0;
      this.error = error instanceof Error ? error.message : String(error);
    }
  }
  private pause() {
    this.playing = false;
    cancelAnimationFrame(this.animation);
    this.animation = 0;
  }
  private stop() {
    this.pause();
    this.frame = this.start - 1;
  }
  private play() {
    if (!this.frames.length || this.loading) return;
    if (this.playing) {
      this.pause();
      return;
    }
    if (this.frame >= this.end - 1) this.frame = this.start - 1;
    this.playing = true;
    this.lastTime = performance.now();
    this.animation = requestAnimationFrame(this.tick);
  }
  private tick = (time: number) => {
    if (!this.playing || !this.isConnected) return;
    const interval = 1000 / this.fps,
      steps = Math.floor((time - this.lastTime) / interval);
    if (steps > 0) {
      this.lastTime += steps * interval;
      const next = advanceFrame(
        this.frame,
        steps,
        this.start - 1,
        this.end - 1,
        this.loop,
      );
      this.frame = next.frame;
      if (next.finished) {
        this.pause();
        return;
      }
    }
    this.animation = requestAnimationFrame(this.tick);
  };
  private step(direction: number) {
    this.pause();
    this.frame = Math.max(
      this.start - 1,
      Math.min(this.end - 1, this.frame + direction),
    );
  }
  private draw() {
    const canvas =
      this.renderRoot.querySelector<HTMLCanvasElement>("#sprite-frame");
    const sheet =
      this.renderRoot.querySelector<HTMLCanvasElement>("#sprite-sheet");
    if (!canvas || !sheet || !this.image) return;
    const rect = this.frames[this.frame];
    canvas.width = rect ? this.cellWidth : 1;
    canvas.height = rect ? this.cellHeight : 1;
    const ctx = canvas.getContext("2d");
    if (ctx && rect) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        this.image,
        rect.x,
        rect.y,
        this.cellWidth,
        this.cellHeight,
        0,
        0,
        this.cellWidth,
        this.cellHeight,
      );
    }
    const ratio = Math.min(1, 640 / this.width, 400 / this.height);
    sheet.width = Math.max(1, Math.round(this.width * ratio));
    sheet.height = Math.max(1, Math.round(this.height * ratio));
    const preview = sheet.getContext("2d");
    if (!preview) return;
    preview.imageSmoothingEnabled = false;
    preview.drawImage(this.image, 0, 0, sheet.width, sheet.height);
    if (rect) {
      preview.strokeStyle = "#dc4d36";
      preview.lineWidth = 2;
      preview.strokeRect(
        rect.x * ratio + 1,
        rect.y * ratio + 1,
        Math.max(1, this.cellWidth * ratio - 2),
        Math.max(1, this.cellHeight * ratio - 2),
      );
    }
  }
  private selectFrame(event: MouseEvent) {
    if (!this.frames.length) return;
    const bounds = (
      event.currentTarget as HTMLCanvasElement
    ).getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * this.width,
      y = ((event.clientY - bounds.top) / bounds.height) * this.height;
    const index = this.frames.findIndex(
      (r) =>
        x >= r.x &&
        x < r.x + this.cellWidth &&
        y >= r.y &&
        y < r.y + this.cellHeight,
    );
    if (index >= this.start - 1 && index < this.end) {
      this.pause();
      this.frame = index;
    }
  }
  render() {
    const images = app.files.filter(isRaster);
    return html`
    <div class="page-head"><div><div class="eyebrow">BRING EACH FRAME TO LIFE</div><h1>スプライトシート再生</h1><p>画像をコマに区切って、動きを確かめよう。</p></div><button ?disabled=${app.busy || !storage.connected} @click=${() => (this.showComposer = true)}>タイル合成</button><button @click=${() => this.renderRoot.querySelector<HTMLInputElement>("#sprite-import")?.click()}>${icon("upload", 16)}インポート</button><input id="sprite-import" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" @change=${(
      e: Event,
    ) => {
      const input = e.target as HTMLInputElement;
      void this.importImage(input.files?.[0]);
      input.value = "";
    }}></div>
    <div class="workspace"><aside class="panel stack"><h3>素材パレット</h3><asset-palette .selected=${this.selected} @pick-asset=${(e: CustomEvent<StoredFile>) => this.select(e.detail)}></asset-palette>${!images.length ? html`<p class="muted">素材ライブラリに画像を登録するか、端末からインポートしてください。</p>` : nothing}<p class="sheet-note">インポートした画像は再生確認だけに使い、サーバーへ登録しません。</p></aside>
    <section class="stack"><div class="panel stack"><h3 class="name">${this.name || "画像を選択してください"}</h3>${this.loading ? html`<p role="status">画像を読み込み中…</p>` : nothing}${this.error ? html`<p class="notice error" role="alert">${this.error}</p>` : nothing}<div class="preview checker">${this.image ? html`<canvas id="sprite-frame" aria-label="再生中のコマ" style=${`width:${this.cellWidth * this.zoom}px;height:${this.cellHeight * this.zoom}px`}></canvas>` : html`<p class="muted">左上から横方向の順に再生します。</p>`}</div><div class="controls"><button aria-label=${this.playing ? "一時停止" : "再生"} title=${this.playing ? "一時停止" : "再生"} ?disabled=${!this.frames.length || this.loading} @click=${() => this.play()}>${icon(this.playing ? "pause" : "play")}</button><button aria-label="停止" title="停止" ?disabled=${!this.frames.length} @click=${() => this.stop()}>${icon("stop")}</button><button aria-label="前のコマ" title="前のコマ" ?disabled=${!this.frames.length || this.frame <= this.start - 1} @click=${() => this.step(-1)}>${icon("previous")}</button><button aria-label="次のコマ" title="次のコマ" ?disabled=${!this.frames.length || this.frame >= this.end - 1} @click=${() => this.step(1)}>${icon("next")}</button><span class="position">${this.frames.length ? this.frame + 1 : 0} / ${this.frames.length} コマ</span><label>表示倍率<select aria-label="表示倍率" .value=${String(this.zoom)} @change=${(e: Event) => (this.zoom = Number((e.target as HTMLSelectElement).value))}>${[0.5, 1, 2, 4, 8].map((z) => html`<option value=${z} .selected=${this.zoom === z}>${z * 100}%</option>`)}</select></label></div><input type="range" aria-label="現在のコマ" min=${this.start} max=${this.end} step="1" .value=${live(String(this.frame + 1))} ?disabled=${!this.frames.length} @input=${(
      e: Event,
    ) => {
      this.pause();
      this.frame = Number((e.target as HTMLInputElement).value) - 1;
    }}></div>${this.image ? html`<div class="panel stack"><h3>シート全体 · ${this.width} × ${this.height} px</h3><canvas id="sprite-sheet" class="sheet checker" aria-label="スプライトシート全体" @click=${this.selectFrame}></canvas><p class="sheet-note">赤枠が現在のコマです。画像内をクリックしてコマを選べます。</p></div>` : nothing}</section>
    <aside class="panel stack settings"><h3>コマの設定</h3><div class="fields">${(
      [
        ["cellWidth", "コマの幅"],
        ["cellHeight", "コマの高さ"],
        ["left", "左余白"],
        ["top", "上余白"],
        ["spacing", "コマの間隔"],
      ] as const
    ).map(
      ([key, label]) =>
        html`<label>${label}<input aria-label=${label} type="number" min=${key.startsWith("cell") ? 1 : 0} max="4096" step="1" .value=${String(this[key])} @change=${(
          e: Event,
        ) => {
          const n = Number((e.target as HTMLInputElement).value);
          if (
            Number.isInteger(n) &&
            n >= (key.startsWith("cell") ? 1 : 0) &&
            n <= 4096
          ) {
            this[key] = n;
            this.rebuild(true);
          } else this.requestUpdate();
        }}></label>`,
    )}</div><p class="sheet-note">右端・下端に収まらない部分は再生しません。最大10,000コマ。</p><h3>再生設定</h3><div class="fields"><label>FPS<input aria-label="FPS" type="number" min="1" max="60" .value=${String(this.fps)} @change=${(
      e: Event,
    ) => {
      const n = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(n) && n >= 1 && n <= 60) {
        this.fps = n;
        this.lastTime = performance.now();
      } else this.requestUpdate();
    }}></label>${(["start", "end"] as const).map(
      (key) =>
        html`<label>${key === "start" ? "開始コマ" : "終了コマ"}<input aria-label=${key === "start" ? "開始コマ" : "終了コマ"} type="number" min="1" max=${this.frames.length || 1} .value=${String(this[key])} ?disabled=${!this.frames.length} @change=${(
          e: Event,
        ) => {
          const n = Number((e.target as HTMLInputElement).value);
          if (Number.isInteger(n) && n >= 1 && n <= this.frames.length) {
            this[key] = n;
            if (key === "start") this.end = Math.max(n, this.end);
            else this.start = Math.min(n, this.start);
            this.stop();
          } else this.requestUpdate();
        }}></label>`,
    )}</div><label class="check"><input aria-label="ループ再生" type="checkbox" .checked=${this.loop} @change=${(e: Event) => (this.loop = (e.target as HTMLInputElement).checked)}>ループ再生</label></aside></div>${
      this.showComposer
        ? html`<tile-composer .initial=${this.selected ? [this.selected] : []} @close-composer=${() => (this.showComposer = false)} @composed-tiles=${(
            e: CustomEvent<string>,
          ) => {
            this.showComposer = false;
            const file = app.files.find((f) => f.assetId === e.detail);
            if (file) void this.select(file);
          }}></tile-composer>`
        : nothing
    }`;
  }
}
customElements.define("sprites-page", SpritesPage);
