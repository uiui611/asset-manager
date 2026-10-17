import { css, html, LitElement } from "lit";
import { app, storage } from "../application/asset-service";
import { hashBlob, importRasterImage } from "../application/media";
import { loadImage } from "../canvas/images";
import { type StoredFile, uid } from "../domain/models";
import { tileSheetLayout } from "../domain/tile-sheet";
import { DialogController } from "./dialog-controller";
import { shared } from "./styles";
import "./asset-palette";
import "./operation-progress";
export class TileComposer extends LitElement {
  static properties = {
    initial: { attribute: false },
    selected: { state: true },
    columns: { state: true },
    name: { state: true },
    removeSources: { state: true },
    preview: { state: true },
    error: { state: true },
    loading: { state: true },
    dimensions: { state: true },
    importing: { state: true },
    importError: { state: true },
  };
  static styles = [
    shared,
    css`
      .dialog {
        width: min(960px, 94vw);
      }
      .layout {
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr);
        gap: 20px;
      }
      .chosen {
        max-height: 180px;
        overflow: auto;
      }
      .chosen .row {
        font-size: 11px;
        margin-bottom: 6px;
      }
      .chosen span {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .preview {
        height: 230px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: auto;
      }
      .preview img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        image-rendering: pixelated;
      }
      .notice {
        font-size: 12px;
      }
      .imports {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        margin-bottom: 14px;
        border: 1px dashed #9eb593;
        border-radius: 8px;
      }
      .imports p {
        font-size: 11px;
        color: #7c8d70;
      }
      .local-images {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 200px;
        overflow: auto;
      }
      .local-images button {
        justify-content: flex-start;
        min-width: 0;
        padding: 6px;
      }
      .local-images img {
        width: 36px;
        height: 36px;
        object-fit: contain;
        image-rendering: pixelated;
      }
      .local-images span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .local-images [aria-pressed="true"] {
        border-color: #789769;
        background: #edf3e4;
      }
      @media (max-width: 700px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];
  initial: string[] = [];
  selected: string[] = [];
  columns = 1;
  name = "";
  removeSources = false;
  preview = "";
  error = "";
  loading = false;
  dimensions = "";
  importing = false;
  importError = "";
  private localSources = new Map<string, { name: string; blob: Blob; preview: string }>();
  private blob?: Blob;
  private sourceVersions = new Map<string, string>();
  private generation = 0;
  private outputId?: string;
  private uploadId?: string;
  constructor() {
    super();
    new DialogController(this);
  }
  private change = () => {
    if (this.uploadId && app.files.some((file) => file.assetId === this.uploadId))
      this.outputId = this.uploadId;
    this.requestUpdate();
  };
  connectedCallback() {
    super.connectedCallback();
    app.addEventListener("change", this.change);
  }
  protected firstUpdated() {
    this.selected = [...this.initial];
    this.columns = Math.max(1, Math.ceil(Math.sqrt(this.selected.length)));
    void this.build();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.generation++;
    URL.revokeObjectURL(this.preview);
    for (const source of this.localSources.values()) URL.revokeObjectURL(source.preview);
    this.localSources.clear();
    app.removeEventListener("change", this.change);
  }
  private close() {
    if (!app.busy)
      this.dispatchEvent(new CustomEvent("close-composer", { bubbles: true, composed: true }));
  }
  private pick(file: StoredFile) {
    this.toggle(file.assetId);
  }
  private toggle(id: string) {
    if (app.busy || this.importing) return;
    this.selected = this.selected.includes(id)
      ? this.selected.filter((selected) => selected !== id)
      : [...this.selected, id];
    if (this.selected.every((selected) => this.localSources.has(selected)))
      this.removeSources = false;
    void this.build();
  }
  private async importImages(files: File[]) {
    if (app.busy || this.importing || !files.length) return;
    this.importError = "";
    if (this.localSources.size + files.length > 256 || this.selected.length + files.length > 256) {
      this.importError = "一度に合成できる画像は256枚までです。";
      return;
    }
    this.importing = true;
    const cancellation = app.cancellationToken;
    try {
      const sources: { id: string; name: string; blob: Blob }[] = [];
      for (const file of files) {
        const blob = await importRasterImage(file);
        if (!this.isConnected || cancellation !== app.cancellationToken) return;
        sources.push({ id: uid(), name: file.name, blob });
      }
      for (const source of sources)
        this.localSources.set(source.id, { ...source, preview: URL.createObjectURL(source.blob) });
      this.selected = [...this.selected, ...sources.map((source) => source.id)];
      void this.build();
    } catch (error) {
      if (this.isConnected && cancellation === app.cancellationToken)
        this.importError = error instanceof Error ? error.message : String(error);
    } finally {
      this.importing = false;
    }
  }
  private dragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = app.busy || this.importing ? "none" : "copy";
  }
  private dropImages(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    void this.importImages([...(event.dataTransfer?.files || [])]);
  }
  private move(index: number, delta: number) {
    const next = index + delta;
    if (app.busy || this.importing || next < 0 || next >= this.selected.length) return;
    const selected = [...this.selected];
    [selected[index], selected[next]] = [selected[next], selected[index]];
    this.selected = selected;
    void this.build();
  }
  private async build() {
    const generation = ++this.generation;
    this.loading = true;
    this.error = "";
    this.blob = undefined;
    this.outputId = undefined;
    this.uploadId = undefined;
    URL.revokeObjectURL(this.preview);
    this.preview = "";
    this.dimensions = "";
    const versions = new Map<string, string>();
    try {
      if (!this.selected.length) return;
      if (this.selected.length > 256) throw new Error("一度に合成できる画像は256枚までです。");
      const images: HTMLImageElement[] = [];
      for (const id of this.selected) {
        const local = this.localSources.get(id);
        const file = app.files.find((f) => f.assetId === id);
        let blob = local?.blob;
        if (!blob) {
          if (!file) throw new Error("選択した素材が見つかりません。");
          versions.set(id, file.version);
          blob = await app.blob(file);
        }
        const image = await loadImage(blob);
        if (!images.length)
          tileSheetLayout(
            Array.from({ length: this.selected.length }, () => ({
              width: image.naturalWidth,
              height: image.naturalHeight,
            })),
            this.columns,
          );
        images.push(image);
        if (generation !== this.generation || !this.isConnected) return;
      }
      const layout = tileSheetLayout(
        images.map((image) => ({
          width: image.naturalWidth,
          height: image.naturalHeight,
        })),
        this.columns,
      );
      const canvas = document.createElement("canvas");
      canvas.width = layout.width;
      canvas.height = layout.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("画像を合成できません。");
      ctx.imageSmoothingEnabled = false;
      images.forEach((image, i) => {
        ctx.drawImage(
          image,
          (i % layout.columns) * layout.tileWidth,
          Math.floor(i / layout.columns) * layout.tileHeight,
        );
      });
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("PNGの生成に失敗しました。"))),
          "image/png",
        ),
      );
      if (generation !== this.generation || !this.isConnected) return;
      this.blob = blob;
      this.sourceVersions = versions;
      this.preview = URL.createObjectURL(blob);
      this.dimensions = `${layout.width} × ${layout.height} px · ${layout.tileWidth} × ${layout.tileHeight} px / コマ`;
    } catch (error) {
      if (generation === this.generation)
        this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }
  private async save() {
    if (
      !this.blob ||
      !this.name.trim() ||
      app.busy ||
      this.loading ||
      this.importing ||
      !storage.connected
    )
      return;
    const blob = this.blob,
      name = `${this.name.trim().replace(/\.png$/i, "")}.png`;
    const storedIds = this.selected.filter((id) => !this.localSources.has(id));
    const sources = storedIds
      .map((id) => app.files.find((f) => f.assetId === id))
      .filter((f): f is StoredFile => !!f);
    if (
      sources.length !== storedIds.length ||
      sources.some((f) => this.sourceVersions.get(f.assetId) !== f.version)
    ) {
      this.error = "元素材が変更されました。画像を選び直してプレビューを更新してください。";
      return;
    }
    const remove = this.removeSources;
    const cancellation = app.cancellationToken;
    const result = await app.run(async () => {
      if (!this.outputId) {
        this.uploadId ||= uid();
        const id = this.uploadId;
        const sha256 = await hashBlob(blob);
        if (!this.isConnected || cancellation !== app.cancellationToken) return false;
        const complete = await app.startOperation("upload", [
          {
            id,
            name,
            blob,
            metadata: {
              assetId: id,
              name,
              type: "image",
              mimeType: "image/png",
              tagIds: ["image"],
              description: "",
              sha256,
            },
          },
        ]);
        if (!complete || !this.isConnected || cancellation !== app.cancellationToken) return false;
        this.outputId = id;
      }
      // Destructive work starts only after the composite is durably saved.
      if (!this.isConnected || cancellation !== app.cancellationToken) return false;
      if (remove && sources.length) {
        const complete = await app.startOperation(
          "bulk-trash",
          sources.map((f) => ({
            id: f.assetId,
            fileId: f.fileId,
            name: f.name,
            metadata: { version: f.version },
          })),
        );
        if (!complete) return false;
      }
      return true;
    });
    if (result)
      this.dispatchEvent(
        new CustomEvent("composed-tiles", {
          detail: this.outputId,
          bubbles: true,
          composed: true,
        }),
      );
  }
  render() {
    return html`<div
      class="overlay"
      @dragenter=${(event: DragEvent) => {
        if (event.dataTransfer?.types.includes("Files")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      @dragover=${this.dragOver}
      @drop=${this.dropImages}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Escape") this.close();
      }}
    >
      <section class="dialog" role="dialog" aria-modal="true" aria-label="タイル合成">
        <div class="row spread">
          <h2>タイル合成</h2>
          <button aria-label="閉じる" ?disabled=${app.busy} @click=${() => this.close()}>×</button>
        </div>
        <p>同じサイズの画像を、選択した順に左上から並べます。端末の画像もインポートできます。</p>
        <operation-progress></operation-progress
        >${app.busy && !app.transfers.length ? html`<p role="status">合成画像を保存中…</p>` : ""}${app.error ? html`<p class="notice error" role="alert">${app.error}</p>` : ""}
        <div class="layout">
          <div ?inert=${app.busy || this.importing}>
            <div class="imports">
              <button
                @click=${() => this.renderRoot.querySelector<HTMLInputElement>("#tile-import")?.click()}
              >
                インポート
              </button>
              <input
                id="tile-import"
                class="sr-only"
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                @change=${(event: Event) => {
                  const input = event.target as HTMLInputElement;
                  void this.importImages([...(input.files || [])]);
                  input.value = "";
                }}
              />
              <p class="sheet-note">
                画像をこのダイアログにドロップしても追加できます。インポートした画像はブラウザー内で使用し、合成結果だけを保存します。
              </p>
              <div class="local-images">
                ${[...this.localSources].map(
                  ([id, source]) =>
                    html`<button
                      aria-label=${`${source.name}（インポート）`}
                      aria-pressed=${this.selected.includes(id)}
                      @click=${() => this.toggle(id)}
                    >
                      <img src=${source.preview} alt="" /><span>${source.name}</span>
                    </button>`,
                )}
              </div>
            </div>
            <asset-palette
              multiple
              .selection=${this.selected}
              @pick-asset=${(e: CustomEvent<StoredFile>) => this.pick(e.detail)}
            ></asset-palette>
          </div>
          <div class="stack">
            ${this.importing ? html`<p role="status">画像をインポート中…</p>` : ""}
            ${this.importError ? html`<p class="notice error" role="alert">${this.importError}</p>` : ""}
            <div class="row">
              <label
                >列数<input
                  aria-label="合成の列数"
                  type="number"
                  min="1"
                  max="256"
                  .value=${String(this.columns)}
                  ?disabled=${app.busy || this.importing}
                  @change=${(e: Event) => {
                    this.columns = Number((e.target as HTMLInputElement).value);
                    void this.build();
                  }} /></label
              ><label
                >画像名<input
                  aria-label="合成画像名"
                  placeholder="名前なし"
                  .value=${this.name}
                  ?disabled=${app.busy}
                  @input=${(e: Event) => (this.name = (e.target as HTMLInputElement).value)}
              /></label>
            </div>
            <div class="chosen">
              ${this.selected.map((id, i) => html`<div class="row"><span>${i + 1}. ${this.localSources.get(id)?.name || app.files.find((f) => f.assetId === id)?.name || "削除済み"}</span><button aria-label=${`${i + 1}番目を前へ`} ?disabled=${app.busy || this.importing || i === 0} @click=${() => this.move(i, -1)}>↑</button><button aria-label=${`${i + 1}番目を後ろへ`} ?disabled=${app.busy || this.importing || i === this.selected.length - 1} @click=${() => this.move(i, 1)}>↓</button><button aria-label=${`${i + 1}番目を選択解除`} ?disabled=${app.busy || this.importing} @click=${() => this.toggle(id)}>×</button></div>`)}
            </div>
            ${this.error ? html`<p class="notice error" role="alert">${this.error}</p>` : ""}
            <div class="preview checker">
              ${this.preview ? html`<img src=${this.preview} alt="タイル合成プレビュー" />` : html`<span>${this.loading ? "合成プレビューを生成中…" : "画像を選択してください"}</span>`}
            </div>
            <span class="muted">${this.dimensions}</span
            ><label class="check"
              ><input
                type="checkbox"
                aria-label="保存後に元素材を削除"
                .checked=${this.removeSources}
                ?disabled=${app.busy || !this.selected.some((id) => !this.localSources.has(id))}
                @change=${(e: Event) => (this.removeSources = (e.target as HTMLInputElement).checked)}
              />保存後に元素材を削除</label
            >${this.removeSources ? html`<p class="notice">合成画像の保存成功後、選択した保存済みの元素材を削除します。端末の画像は削除しません。既存マップやキャラクターからの参照は欠落します。</p>` : ""}${this.outputId ? html`<p class="notice">合成画像は保存済みです。未完了の削除は操作パネルから明示的に再試行できます。</p>` : ""}
            ${!storage.connected ? html`<p class="notice">ストレージに接続すると合成画像を保存できます。</p>` : ""}
          </div>
        </div>
        <footer>
          <button ?disabled=${app.busy} @click=${() => this.close()}>キャンセル</button
          ><button
            class="primary"
            ?disabled=${app.busy || !!this.outputId || this.loading || this.importing || !storage.connected || !this.blob || !this.name.trim()}
            @click=${() => this.save()}
          >
            合成画像を保存
          </button>
        </footer>
      </section>
    </div>`;
  }
}
customElements.define("tile-composer", TileComposer);
