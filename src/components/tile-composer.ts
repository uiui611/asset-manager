import { css, html, LitElement } from "lit";
import { app, storage } from "../application/asset-service";
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
  private blob?: Blob;
  private sourceVersions = new Map<string, string>();
  private generation = 0;
  private outputId?: string;
  constructor() {
    super();
    new DialogController(this);
  }
  private change = () => this.requestUpdate();
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
    app.removeEventListener("change", this.change);
  }
  private close() {
    if (!app.busy)
      this.dispatchEvent(new CustomEvent("close-composer", { bubbles: true, composed: true }));
  }
  private pick(file: StoredFile) {
    if (app.busy) return;
    this.selected = this.selected.includes(file.assetId)
      ? this.selected.filter((id) => id !== file.assetId)
      : [...this.selected, file.assetId];
    void this.build();
  }
  private move(index: number, delta: number) {
    const next = index + delta;
    if (next < 0 || next >= this.selected.length) return;
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
    URL.revokeObjectURL(this.preview);
    this.preview = "";
    this.dimensions = "";
    const versions = new Map<string, string>();
    try {
      if (!this.selected.length) return;
      if (this.selected.length > 256) throw new Error("一度に合成できる画像は256枚までです。");
      const images: HTMLImageElement[] = [];
      for (const id of this.selected) {
        const file = app.files.find((f) => f.assetId === id);
        if (!file) throw new Error("選択した素材が見つかりません。");
        versions.set(id, file.version);
        const image = await loadImage(await app.blob(file));
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
    if (!this.blob || !this.name.trim() || app.busy) return;
    const blob = this.blob,
      name = `${this.name.trim().replace(/\.png$/i, "")}.png`;
    const sources = this.selected
      .map((id) => app.files.find((f) => f.assetId === id))
      .filter((f): f is StoredFile => !!f);
    if (
      sources.length !== this.selected.length ||
      sources.some((f) => this.sourceVersions.get(f.assetId) !== f.version)
    ) {
      this.error = "元素材が変更されました。画像を選び直してプレビューを更新してください。";
      return;
    }
    const remove = this.removeSources;
    const result = await app.run(async () => {
      if (!this.outputId) {
        const id = uid();
        const saved = await storage.createFile({
          content: blob,
          metadata: {
            assetId: id,
            name,
            type: "image",
            tagIds: ["image"],
            description: "",
          },
        });
        await app.putFile(saved);
        this.outputId = saved.assetId;
      }
      // Destructive work starts only after the composite is durably saved.
      if (remove) {
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
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Escape") this.close();
      }}
    >
      <section class="dialog" role="dialog" aria-modal="true" aria-label="タイル合成">
        <div class="row spread">
          <h2>タイル合成</h2>
          <button aria-label="閉じる" ?disabled=${app.busy} @click=${() => this.close()}>×</button>
        </div>
        <p>同じサイズの保存済み画像を、選択した順に左上から並べます。</p>
        <operation-progress></operation-progress
        >${app.busy && !app.transfers.length ? html`<p role="status">合成画像を保存中…</p>` : ""}${app.error ? html`<p class="notice error" role="alert">${app.error}</p>` : ""}
        <div class="layout">
          <div ?inert=${app.busy}>
            <asset-palette
              multiple
              .selection=${this.selected}
              @pick-asset=${(e: CustomEvent<StoredFile>) => this.pick(e.detail)}
            ></asset-palette>
          </div>
          <div class="stack">
            <div class="row">
              <label
                >列数<input
                  aria-label="合成の列数"
                  type="number"
                  min="1"
                  max="256"
                  .value=${String(this.columns)}
                  ?disabled=${app.busy}
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
              ${this.selected.map((id, i) => html`<div class="row"><span>${i + 1}. ${app.files.find((f) => f.assetId === id)?.name || "削除済み"}</span><button aria-label=${`${i + 1}番目を前へ`} ?disabled=${app.busy || i === 0} @click=${() => this.move(i, -1)}>↑</button><button aria-label=${`${i + 1}番目を後ろへ`} ?disabled=${app.busy || i === this.selected.length - 1} @click=${() => this.move(i, 1)}>↓</button></div>`)}
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
                ?disabled=${app.busy}
                @change=${(e: Event) => (this.removeSources = (e.target as HTMLInputElement).checked)}
              />保存後に元素材を削除</label
            >${this.removeSources ? html`<p class="notice">合成画像の保存成功後、選択した元素材を削除します。既存マップやキャラクターからの参照は欠落します。</p>` : ""}${this.outputId ? html`<p class="notice">合成画像は保存済みです。削除に失敗した場合は、設定の中断した操作から再試行できます。</p>` : ""}
          </div>
        </div>
        <footer>
          <button ?disabled=${app.busy} @click=${() => this.close()}>キャンセル</button
          ><button
            class="primary"
            ?disabled=${app.busy || !!this.outputId || this.loading || !this.blob || !this.name.trim()}
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
