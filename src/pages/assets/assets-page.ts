import "../../components/tile-composer";
import "../../components/operation-progress";
import "../../components/audio-row";
import { css, html, LitElement, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { navigate } from "../../app/router";
import { app, storage } from "../../application/asset-service";
import { download, hashBlob, split } from "../../application/media";
import { loadImage, type SplitOptions } from "../../canvas/images";
import { DialogController } from "../../components/dialog-controller";
import { icon } from "../../components/icon";
import { shared } from "../../components/styles";
import { isLibraryFile, projectLabel, projectPage } from "../../domain/library";
import { type JournalItem, type StoredFile, uid } from "../../domain/models";
import { AssetSearch } from "../../domain/search";
import "../../components/asset-card";
import { formatSize } from "../../components/asset-card";
export class AssetsPage extends LitElement {
  constructor() {
    super();
    new DialogController(this);
  }
  static properties = {
    query: { state: true },
    type: { state: true },
    tag: { state: true },
    sort: { state: true },
    selected: { state: true },
    detail: { state: true },
    preview: { state: true },
    modal: { state: true },
    showComposer: { state: true },
    draftName: { state: true },
    draftDescription: { state: true },
    draftTags: { state: true },
    pending: { state: true },
    duplicates: { state: true },
    refs: { state: true },
    scrollTop: { state: true },
    columns: { state: true },
    splitOptions: { state: true },
    dimensions: { state: true },
    splitFiles: { state: true },
    dragging: { state: true },
    audioScroll: { state: true },
  };
  static styles = [
    shared,
    css`
      .library-dropzone {
        position: relative;
        min-height: 65vh;
      }
      .drop-indicator {
        position: absolute;
        inset: 0;
        z-index: 5;
        pointer-events: none;
        border: 3px dashed #60845c;
        border-radius: 12px;
        background: #e9f1e1ee;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        font-weight: 600;
        color: #42613d;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        margin: 25px 0;
      }
      .stat {
        background: #fdfefa;
        border: 1px solid #e2e8dc;
        border-radius: 10px;
        display: flex;
        align-items: center;
        gap: 15px;
        padding: 19px 21px;
      }
      .stat-icon {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        display: grid;
        place-items: center;
        background: #edf2e5;
        color: #85966d;
      }
      .stat:nth-child(2) .stat-icon {
        background: #eeeefa;
        color: #9692ad;
      }
      .stat:nth-child(3) .stat-icon {
        background: #f6f0e6;
        color: #b6a27a;
      }
      .stat strong {
        font-size: 23px;
        font-weight: 600;
        line-height: 1.2;
        display: block;
      }
      .stat span {
        font-size: 10px;
        color: #929d88;
      }
      .tabs {
        display: flex;
        gap: 23px;
        border-bottom: 1px solid #e0e6d9;
        margin-bottom: 21px;
      }
      .tabs button {
        border: 0;
        background: none;
        padding: 11px 0;
        border-radius: 0;
        font-size: 12px;
        color: #89947f;
        position: relative;
      }
      .tabs button.active {
        color: #42613d;
        font-weight: 650;
      }
      .tabs button.active:after {
        position: absolute;
        content: "";
        bottom: -1px;
        height: 2px;
        background: #668752;
        left: 0;
        right: 0;
      }
      .search {
        display: flex;
        flex-direction: row;
        gap: 9px;
        align-items: center;
        background: white;
        border: 1px solid #e0e6dc;
        padding: 0 13px;
        border-radius: 7px;
        flex: 1;
        color: #9aa38f;
      }
      .search input {
        border: 0;
        min-width: 80px;
        width: 100%;
        font-size: 11px;
        padding: 10px 0;
      }
      .toolbar select {
        font-size: 11px;
        max-width: 160px;
      }
      .results {
        font-size: 10px;
        color: #96a18c;
        margin: 0 0 14px;
      }
      .viewport {
        height: min(64vh, 760px);
        min-height: 300px;
        overflow: auto;
        position: relative;
        scrollbar-width: thin;
        scrollbar-color: #d4ddcc transparent;
      }
      .virtual {
        position: relative;
        min-height: 100%;
      }
      .cards {
        position: absolute;
        left: 0;
        right: 0;
        display: grid;
        gap: 18px;
        padding: 0 3px 8px 0;
      }
      .empty {
        border: 1px dashed #ccd8c2;
        border-radius: 12px;
        background: #f9fbf5;
      }
      .empty.dragging {
        border-color: #60845c;
        background: #e9f1e1;
      }
      .upload-note {
        font-size: 10px;
        color: #95a18d;
      }
      .selectionbar {
        background: #eaf1e1;
        border: 1px solid #d6e2c9;
        padding: 10px 14px;
        border-radius: 9px;
        display: flex;
        gap: 12px;
        align-items: center;
        margin-bottom: 16px;
        font-size: 11px;
        flex-wrap: wrap;
      }
      .selectionbar span {
        margin-right: auto;
      }
      .preview-large {
        height: 260px;
        display: flex;
        justify-content: center;
        align-items: center;
        border-radius: 9px;
        overflow: hidden;
      }
      .preview-large img {
        max-width: 100%;
        max-height: 100%;
        image-rendering: pixelated;
      }
      .preview-large audio {
        max-width: 100%;
      }
      .detail-layout {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 23px;
      }
      .filemeta {
        font-size: 11px;
        line-height: 2.2;
        overflow-wrap: anywhere;
      }
      .banner {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: 22px 0;
        padding: 18px 23px;
        background: #edf3e4;
        border: 1px solid #dce7d0;
        border-radius: 11px;
      }
      .banner p {
        font-size: 11px;
        color: #869578;
        margin-top: 4px;
      }
      .banner h3 {
        font-size: 13px;
      }
      .banner .motif {
        color: #97ab7d;
        transform: rotate(-10deg);
      }
      .warning-list {
        max-height: 160px;
        overflow: auto;
        font-size: 12px;
        color: #776845;
      }
      .split-preview {
        position: relative;
        overflow: auto;
        max-height: 300px;
        background: #eaf0e3;
        min-height: 50px;
      }
      .split-preview img {
        display: block;
        image-rendering: pixelated;
      }
      .split-preview canvas {
        position: absolute;
        top: 0;
        left: 0;
        pointer-events: none;
      }
      .tile-list {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .tile-list img {
        max-width: 70px;
        max-height: 70px;
      }
      @media (max-width: 1000px) {
        .stat {
          padding: 15px;
          gap: 10px;
        }
        .stats {
          gap: 10px;
        }
      }
      @media (max-width: 760px) {
        .stats {
          grid-template-columns: repeat(3, 1fr);
        }
        .stat {
          padding: 12px;
          display: block;
        }
        .stat-icon {
          display: none;
        }
        .stat strong {
          font-size: 20px;
        }
        .stat span {
          font-size: 9px;
        }
        .detail-layout {
          grid-template-columns: 1fr;
        }
        .toolbar {
          gap: 6px;
        }
        .toolbar select {
          max-width: 115px;
        }
        .tabs {
          gap: 20px;
        }
        .banner {
          padding: 15px;
        }
        .banner .motif {
          display: none;
        }
      }
    `,
  ];
  query = "";
  type = "";
  tag = "";
  sort = "newest";
  selected = new Set<string>();
  detail: StoredFile | null = null;
  preview = "";
  modal = "";
  showComposer = false;
  draftName = "";
  draftDescription = "";
  draftTags: string[] = [];
  pending: JournalItem[] = [];
  duplicates: string[] = [];
  refs: string[] = [];
  audioScroll = 0;
  scrollTop = 0;
  columns = 4;
  dragging = false;
  dimensions = { width: 0, height: 0 };
  splitFiles: { name: string; blob: Blob }[] = [];
  splitOptions: SplitOptions = {
    width: 32,
    height: 32,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    spacing: 0,
    skipEmpty: true,
    prefix: "tile",
  };
  private search = new AssetSearch([]);
  private filesRef: StoredFile[] = [];
  private resize?: ResizeObserver;
  private change = () => {
    if (this.filesRef !== app.files) {
      this.filesRef = app.files;
      this.search = new AssetSearch(app.files.filter(isLibraryFile));
      this.selected = new Set(
        [...this.selected].filter((id) => app.files.some((f) => f.assetId === id)),
      );
    }
    this.requestUpdate();
  };
  connectedCallback() {
    super.connectedCallback();
    app.addEventListener("change", this.change);
    this.change();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    app.removeEventListener("change", this.change);
    this.resize?.disconnect();
    if (this.preview) URL.revokeObjectURL(this.preview);
  }
  firstUpdated() {
    this.resize = new ResizeObserver((entries) => {
      this.columns = Math.max(1, Math.floor((entries[0].contentRect.width + 18) / 205));
    });
    this.resize.observe(this);
  }
  private get results() {
    return this.search
      .find(this.query, this.type, this.tag)
      .sort((a, b) =>
        this.sort === "name"
          ? a.name.localeCompare(b.name, "ja")
          : b.modifiedTime.localeCompare(a.modifiedTime),
      );
  }
  private filter() {
    this.scrollTop = 0;
    this.audioScroll = 0;
    const viewport = this.renderRoot.querySelector(".viewport");
    if (viewport) viewport.scrollTop = 0;
  }
  private close() {
    this.localSplit = undefined;
    this.modal = "";
    this.detail = null;
    this.pending = [];
    this.splitFiles = [];
    if (this.preview) URL.revokeObjectURL(this.preview);
    this.preview = "";
  }
  private localSplit?: Blob;
  private dragDepth = 0;
  private dragEnter(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    this.dragDepth++;
    this.dragging = !this.modal;
  }
  private dragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = this.modal ? "none" : "copy";
  }
  private dragLeave(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) this.dragging = false;
  }
  private dropFiles(e: DragEvent) {
    e.preventDefault();
    this.dragDepth = 0;
    this.dragging = false;
    if (this.modal) return;
    void this.importFiles([...(e.dataTransfer?.files || [])]);
  }
  private async importFiles(files: File[]) {
    if (!files.length) return;
    void app.enqueueImport(files);
  }
  private async splitFile(file?: File) {
    if (!file) return;
    const result = await app.run(() => app.prepareImport([file]));
    const item = result?.items[0];
    if (!item?.blob || item.metadata?.type !== "image" || item.blob.type === "image/svg+xml")
      return;
    this.localSplit = item.blob;
    this.detail = {
      ...item.metadata,
      assetId: item.id,
      fileId: item.id,
      name: item.name,
      tagIds: [],
      version: "0",
      size: item.blob.size,
      modifiedTime: "",
      description: "",
    } as StoredFile;
    const image = await loadImage(item.blob);
    this.dimensions = {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    this.preview = URL.createObjectURL(item.blob);
    await this.prepareSplit();
  }
  private async open(file: StoredFile) {
    this.detail = file;
    this.draftName = file.name;
    this.draftDescription = file.description;
    this.draftTags = [...file.tagIds];
    this.modal = "detail";
    this.preview = "";
    if (file.type === "json") return;
    const blob = await app.run(() => app.blob(file));
    if (blob && this.detail?.assetId === file.assetId) {
      this.preview = URL.createObjectURL(blob);
      if (file.type === "image") {
        const image = await loadImage(blob);
        this.dimensions = {
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
      }
    }
  }
  private async prepareTrash() {
    const ids = [...this.selected];
    if (this.detail && !ids.includes(this.detail.assetId)) ids.push(this.detail.assetId);
    this.selected = new Set(ids);
    const refs = await app.run(() => app.references(ids));
    if (refs) {
      this.refs = refs;
      this.modal = "trash";
    }
  }
  private async trash() {
    const ids = new Set(this.selected);
    const files = app.files.filter((f) => ids.has(f.assetId));
    await app.run(() =>
      app.startOperation(
        "bulk-trash",
        files.map((f) => ({
          id: f.assetId,
          name: f.name,
          fileId: f.fileId,
          metadata: { version: f.version },
        })),
      ),
    );
    if (!app.error) {
      this.selected = new Set();
      this.close();
    }
  }
  private async prepareSplit() {
    if (!this.detail) return;
    this.splitOptions = {
      ...this.splitOptions,
      prefix: this.detail.name.replace(/\.[^.]+$/, ""),
    };
    this.splitFiles = [];
    this.modal = "split";
  }
  private async generateTiles() {
    const file = this.detail;
    if (!file) return;
    const result = await app.run(async () =>
      split(this.localSplit || (await app.blob(file)), this.splitOptions),
    );
    if (result) {
      this.splitFiles = result;
      if (!result.length) {
        app.error = "出力するタイルがありません。透明タイルの除外設定を確認してください。";
        app.changed();
      }
    }
  }
  private async saveTiles() {
    const file = this.detail;
    if (!file) return;
    const complete = await app.run(async () => {
      const items: JournalItem[] = [];
      for (const tile of this.splitFiles) {
        const id = uid();
        items.push({
          id,
          name: tile.name,
          blob: tile.blob,
          metadata: {
            assetId: id,
            name: tile.name,
            type: "image",
            tagIds: file.tagIds,
            sha256: await hashBlob(tile.blob),
          },
        });
      }
      return app.startOperation("tile-split", items, [file.assetId]);
    });
    if (complete) this.close();
  }
  render() {
    const files = app.files.filter(isLibraryFile);
    const results = this.results;
    const audioFiles = results.filter(
      (f) => f.type === "audio" || f.tagIds.includes("editor-sound"),
    );
    const images = results.filter((f) => f.type !== "audio" && !f.tagIds.includes("editor-sound"));
    const audioStart = Math.max(0, Math.floor(this.audioScroll / 82) - 1);
    const rowHeight = 249;
    const startRow = Math.max(0, Math.floor(this.scrollTop / rowHeight) - 1);
    const endRow = startRow + 6;
    const visible = images.slice(startRow * this.columns, endRow * this.columns);
    return html` <div
        class="library-dropzone"
        @dragenter=${this.dragEnter}
        @dragover=${this.dragOver}
        @dragleave=${this.dragLeave}
        @drop=${this.dropFiles}
      >
        ${this.dragging ? html`<div class="drop-indicator" role="status">${icon("upload", 30)}画像・音声をドロップして追加</div>` : nothing}
        <div class="page-head">
          <div>
            <div class="eyebrow" style="margin-bottom:7px">THE BUILDING BLOCKS OF YOUR WORLD</div>
            <h1>
              素材ライブラリ<span
                style="color:#a7b299;font-weight:400;font-size:20px;margin-left:10px"
                >.</span
              >
            </h1>
            <p>ひとつひとつの素材から、次の世界をつくろう。</p>
          </div>
          <div class="row">
            <button
              ?disabled=${app.busy || !storage.connected}
              @click=${() => this.renderRoot.querySelector<HTMLInputElement>("#split-upload")?.click()}
            >
              タイル分割</button
            ><button
              ?disabled=${app.busy || !storage.connected}
              @click=${() => (this.showComposer = true)}
            >
              タイル合成</button
            ><button
              class="primary"
              ?disabled=${!storage.connected}
              @click=${() => this.renderRoot.querySelector<HTMLInputElement>("#upload")?.click()}
            >
              ${icon("plus", 16)}素材を追加
            </button>
          </div>
        </div>
        <input
          id="split-upload"
          class="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          @change=${(e: Event) => {
            const input = e.target as HTMLInputElement;
            void this.splitFile(input.files?.[0]);
            input.value = "";
          }}
        />
        <input
          id="upload"
          class="sr-only"
          type="file"
          accept="image/*,audio/*,.json"
          multiple
          @change=${(e: Event) => {
            const input = e.target as HTMLInputElement;
            void this.importFiles([...(input.files || [])]);
            input.value = "";
          }}
        />
        <div class="stats">
          <div class="stat">
            <div class="stat-icon">${icon("image", 21)}</div>
            <div>
              <strong>${files.filter((f) => f.type === "image").length.toLocaleString()}</strong
              ><span>画像素材</span>
            </div>
          </div>
          <div class="stat">
            <div class="stat-icon">${icon("sound", 21)}</div>
            <div>
              <strong
                >${files.filter((f) => f.type === "audio" || f.tagIds.includes("editor-sound")).length.toLocaleString()}</strong
              ><span>音声素材</span>
            </div>
          </div>
          <div class="stat">
            <div class="stat-icon">${icon("layers", 21)}</div>
            <div>
              <strong>${files.filter((f) => f.type === "json").length.toLocaleString()}</strong
              ><span>JSON素材</span>
            </div>
          </div>
        </div>
        ${
          !storage.connected
            ? html`<div class="banner">
                <div>
                  <h3>制作のための、小さな素材のアトリエ。</h3>
                  <p>ストレージ に接続して、画像やサウンドを整理しましょう。</p>
                </div>
                <button class="small" @click=${() => navigate("settings")}>
                  接続設定へ ${icon("arrow", 14)}
                </button>
                <div class="motif">${icon("layers", 42)}</div>
              </div>`
            : nothing
        }
        <div class="tabs">
          ${[
            ["", "すべての素材"],
            ["image", "画像"],
            ["audio", "音声"],
            ["json", "JSON"],
          ].map(
            ([value, label]) =>
              html`<button
                class=${this.type === value ? "active" : ""}
                @click=${() => {
                  this.type = value;
                  this.filter();
                }}
              >
                ${label}
              </button>`,
          )}
        </div>
        <div class="toolbar">
          <label class="search"
            >${icon("search", 16)}<input
              aria-label="素材を検索"
              placeholder="名前や説明で検索…"
              .value=${this.query}
              @input=${(e: Event) => {
                this.query = (e.target as HTMLInputElement).value;
                this.filter();
              }} /></label
          ><select
            aria-label="タグで絞り込み"
            .value=${this.tag}
            @change=${(e: Event) => {
              this.tag = (e.target as HTMLSelectElement).value;
              this.filter();
            }}
          >
            <option value="">すべてのタグ</option>
            ${app.tags.map((t) => html`<option value=${t.tagId}>${t.name}</option>`)}</select
          ><select
            aria-label="並び順"
            .value=${this.sort}
            @change=${(e: Event) => {
              this.sort = (e.target as HTMLSelectElement).value;
              this.filter();
            }}
          >
            <option value="newest">更新が新しい順</option>
            <option value="name">名前順</option>
          </select>
        </div>
        ${
          this.selected.size
            ? html`<div class="selectionbar">
                <span>${this.selected.size}件を選択中</span
                ><button
                  class="small"
                  ?disabled=${!storage.connected || app.busy}
                  @click=${() => {
                    this.draftTags = [];
                    this.modal = "tags";
                  }}
                >
                  ${icon("tag", 13)}タグを追加</button
                ><button
                  class="small danger"
                  ?disabled=${!storage.connected || app.busy}
                  @click=${() => this.prepareTrash()}
                >
                  ${icon("trash", 13)}削除</button
                ><button class="small quiet" @click=${() => (this.selected = new Set())}>
                  選択解除
                </button>
              </div>`
            : nothing
        }
        <div class="row spread results">
          <span>${results.length.toLocaleString()} 件の素材${this.query ? " · 検索結果" : ""}</span
          ><span
            >${results.length ? html`<button class="quiet small" @click=${() => (this.selected = new Set(results.map((f) => f.assetId)))}>すべて選択</button>` : "PNG / JPEG / WebP / SVG / AUDIO"}</span
          >
        </div>
        ${
          images.length
            ? html`<div
                class="viewport"
                @scroll=${(e: Event) => (this.scrollTop = (e.target as HTMLElement).scrollTop)}
              >
                <div
                  class="virtual"
                  style=${`height:${Math.ceil(images.length / this.columns) * rowHeight}px`}
                >
                  <div
                    class="cards"
                    style=${`grid-template-columns:repeat(${this.columns},minmax(0,1fr));top:${startRow * rowHeight}px`}
                    @select-asset=${(e: CustomEvent<string>) => {
                      const selected = new Set(this.selected);
                      selected.has(e.detail) ? selected.delete(e.detail) : selected.add(e.detail);
                      this.selected = selected;
                    }}
                    @open-asset=${(e: CustomEvent<StoredFile>) => {
                      e.preventDefault();
                      void this.open(e.detail);
                    }}
                  >
                    ${repeat(
                      visible,
                      (f) => `${f.assetId}:${f.version}`,
                      (f) =>
                        html`<asset-card
                          .file=${f}
                          .selected=${this.selected.has(f.assetId)}
                        ></asset-card>`,
                    )}
                  </div>
                </div>
              </div>`
            : results.length
              ? nothing
              : html`<div class="empty">
                  <div class="empty-icon">${icon(this.query ? "search" : "image", 32)}</div>
                  <h2>
                    ${this.query || this.tag || this.type ? "素材が見つかりません" : "最初の素材を、ここに。"}
                  </h2>
                  <p>
                    ${this.query || this.tag || this.type ? "検索条件を変えて、もう一度探してみてください。" : "画像や音声をドラッグ＆ドロップ。タグを付けて整理し、マップやキャラクター制作へつなげましょう。"}
                  </p>
                  <button
                    ?disabled=${app.busy}
                    @click=${() => (storage.connected ? this.renderRoot.querySelector<HTMLInputElement>("#upload")?.click() : navigate("settings"))}
                  >
                    ${icon(storage.connected ? "upload" : "cloud", 16)}${storage.connected ? "ファイルを選択" : "ストレージ の接続設定"}
                  </button>
                  <div class="upload-note" style="margin-top:14px">1回の登録は合計 1 GB まで</div>
                </div>`
        }
        ${
          audioFiles.length
            ? html`<h3 style="margin:20px 0 12px">音声素材</h3>
                <div
                  style="height:${Math.min(410, audioFiles.length * 82)}px;overflow:auto"
                  @scroll=${(e: Event) => (this.audioScroll = (e.target as HTMLElement).scrollTop)}
                >
                  <div style="position:relative;height:${audioFiles.length * 82}px">
                    <div
                      style="position:absolute;left:0;right:0;top:${audioStart * 82}px;display:grid;gap:12px"
                      @select-asset=${(e: CustomEvent<string>) => {
                        const selected = new Set(this.selected);
                        selected.has(e.detail) ? selected.delete(e.detail) : selected.add(e.detail);
                        this.selected = selected;
                      }}
                      @open-asset=${(e: CustomEvent<StoredFile>) => {
                        e.preventDefault();
                        void this.open(e.detail);
                      }}
                    >
                      ${repeat(
                        audioFiles.slice(audioStart, audioStart + 8),
                        (f) => `${f.assetId}:${f.version}`,
                        (f) =>
                          html`<audio-row
                            .file=${f}
                            .selected=${this.selected.has(f.assetId)}
                          ></audio-row>`,
                      )}
                    </div>
                  </div>
                </div>`
            : nothing
        }
      </div>
      ${
        this.showComposer
          ? html`<tile-composer
              .initial=${app.files.filter((f) => this.selected.has(f.assetId) && f.type === "image" && f.mimeType !== "image/svg+xml").map((f) => f.assetId)}
              @close-composer=${() => (this.showComposer = false)}
              @composed-tiles=${() => {
                this.showComposer = false;
                this.selected = new Set();
              }}
            ></tile-composer>`
          : nothing
      }${this.modal ? this.renderDialog() : nothing}`;
  }
  private tagPicker() {
    return html`<div class="row wrap">
      ${app.tags.map((t) => html`<label class="check"><input type="checkbox" .checked=${this.draftTags.includes(t.tagId)} @change=${() => (this.draftTags = this.draftTags.includes(t.tagId) ? this.draftTags.filter((id) => id !== t.tagId) : [...this.draftTags, t.tagId])} />${t.name}</label>`)}${!app.tags.length ? html`<p class="muted">設定でタグを作成できます。</p>` : ""}
    </div>`;
  }
  private renderDialog() {
    return html`<div
      class="overlay"
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Escape" && !app.busy) this.close();
      }}
    >
      <section class="dialog" role="dialog" aria-modal="true" aria-label="素材の操作">
        <div class="row spread">
          <h2>
            ${{ detail: "素材の詳細", import: "素材を登録", trash: "削除", tags: "タグを一括追加", split: "タイル分割" }[this.modal]}
          </h2>
          <button
            class="quiet"
            aria-label="閉じる"
            ?disabled=${app.busy}
            @click=${() => this.close()}
          >
            ${icon("close")}
          </button>
        </div>
        <operation-progress></operation-progress>
        ${
          this.modal === "detail" && this.detail
            ? html`<div class="detail-layout">
                  <div class="stack">
                    <div class="preview-large checker">
                      ${
                        projectPage(this.detail)
                          ? html`<div class="stack">
                              <strong>${projectLabel(this.detail)}JSON素材</strong
                              ><button
                                class="primary"
                                ?disabled=${app.busy}
                                @click=${() => {
                                  const file = this.detail;
                                  if (!file) return;
                                  const page = projectPage(file);
                                  if (page) navigate(page, file.assetId);
                                }}
                              >
                                編集画面で開く
                              </button>
                            </div>`
                          : this.preview
                            ? this.detail.type === "audio"
                              ? html`<audio controls src=${this.preview}></audio>`
                              : html`<img src=${this.preview} alt=${this.detail.name} />`
                            : html`<span class="muted"
                                >画像・音声は接続後にプレビューできます</span
                              >`
                      }
                    </div>
                    <div class="filemeta muted">
                      ${this.detail.mimeType} · ${formatSize(this.detail.size)}<br />${this.detail.type === "image" ? `${this.dimensions.width} × ${this.dimensions.height} px` : ""}<br />素材
                      ID: ${this.detail.assetId}
                    </div>
                  </div>
                  <div class="stack">
                    <label
                      >素材名<input
                        .value=${this.draftName}
                        @input=${(e: Event) => (this.draftName = (e.target as HTMLInputElement).value)} /></label
                    ><label
                      >説明・出典・ライセンス<textarea
                        .value=${this.draftDescription}
                        @input=${(e: Event) => (this.draftDescription = (e.target as HTMLTextAreaElement).value)}
                      ></textarea>
                    </label>
                    <h3>タグ</h3>
                    ${this.tagPicker()}<button
                      class="primary"
                      ?disabled=${app.busy || !storage.connected}
                      @click=${async () => {
                        if (this.detail)
                          await app.run(() =>
                            app.update(
                              this.detail as StoredFile,
                              this.draftName,
                              this.draftDescription,
                              this.draftTags,
                            ),
                          );
                        if (!app.error) this.close();
                      }}
                    >
                      変更を保存
                    </button>
                  </div>
                </div>
                <footer>
                  <button
                    ?disabled=${app.busy || !storage.connected}
                    @click=${async () => {
                      if (!this.detail) return;
                      const f = this.detail;
                      const blob = await app.run(() => app.blob(f));
                      if (blob) download(blob, f.name);
                    }}
                  >
                    ${icon("download", 15)}ダウンロード</button
                  ><button
                    class="danger"
                    ?disabled=${app.busy || !storage.connected}
                    @click=${() => this.prepareTrash()}
                  >
                    ${icon("trash", 15)}
                  </button>
                </footer>`
            : nothing
        }
        ${
          this.modal === "tags"
            ? html`${this.tagPicker()}
                <footer>
                  <button
                    class="primary"
                    ?disabled=${app.busy || !this.draftTags.length}
                    @click=${async () => {
                      const items = app.files
                        .filter((f) => this.selected.has(f.assetId))
                        .map((f) => ({
                          id: f.assetId,
                          fileId: f.fileId,
                          name: f.name,
                          metadata: {
                            tagIds: [...new Set([...f.tagIds, ...this.draftTags])],
                          },
                        }));
                      await app.run(() => app.startOperation("bulk-tag", items));
                      if (!app.error) this.close();
                    }}
                  >
                    選択した素材に追加
                  </button>
                </footer>`
            : nothing
        }
        ${
          this.modal === "trash"
            ? html`<div class="stack">
                  <p>${this.selected.size}件をストレージの削除します。</p>
                  ${
                    this.refs.length
                      ? html`<div class="notice error">
                          以下のJSON素材から参照されています。削除後も編集は続けられます。欠落箇所はプレースホルダーで表示します。
                          <ul>
                            ${this.refs.map((r) => html`<li>${r}</li>`)}
                          </ul>
                        </div>`
                      : ""
                  }
                </div>
                <footer>
                  <button ?disabled=${app.busy} @click=${() => this.close()}>キャンセル</button
                  ><button class="danger" ?disabled=${app.busy} @click=${() => this.trash()}>
                    ${this.refs.length ? "削除する" : "削除"}
                  </button>
                </footer>`
            : nothing
        }
        ${
          this.modal === "split"
            ? html`<div class="stack">
                  <p class="muted">
                    ${this.detail?.name} · ${this.dimensions.width} × ${this.dimensions.height} px
                    ／ 出力 PNG
                  </p>
                  <div class="grid2">
                    ${(
                      [
                        ["width", "タイル幅"],
                        ["height", "タイル高さ"],
                        ["top", "上余白"],
                        ["right", "右余白"],
                        ["bottom", "下余白"],
                        ["left", "左余白"],
                        ["spacing", "タイル間隔"],
                      ] as const
                    ).map(
                      ([key, label]) =>
                        html`<label
                          >${label}<input
                            type="number"
                            min=${key === "width" || key === "height" ? 1 : 0}
                            .value=${String(this.splitOptions[key])}
                            @input=${(e: Event) => {
                              this.splitOptions = {
                                ...this.splitOptions,
                                [key]: Number((e.target as HTMLInputElement).value),
                              };
                              this.splitFiles = [];
                            }}
                        /></label>`,
                    )}<label
                      >ファイル名の接頭辞<input
                        .value=${this.splitOptions.prefix}
                        @input=${(e: Event) => {
                          this.splitOptions = {
                            ...this.splitOptions,
                            prefix: (e.target as HTMLInputElement).value,
                          };
                          this.splitFiles = [];
                        }}
                    /></label>
                  </div>
                  <label class="check"
                    ><input
                      type="checkbox"
                      .checked=${this.splitOptions.skipEmpty}
                      @change=${(e: Event) => {
                        this.splitOptions = {
                          ...this.splitOptions,
                          skipEmpty: (e.target as HTMLInputElement).checked,
                        };
                        this.splitFiles = [];
                      }}
                    />透明なタイルを除外</label
                  >${this.preview ? html`<div class="preview-large checker"><img src=${this.preview} alt="分割する元画像" /></div>` : ""}<button
                    ?disabled=${app.busy}
                    @click=${() => this.generateTiles()}
                  >
                    分割結果を確認</button
                  >${
                    this.splitFiles.length
                      ? html`<div class="notice">
                          ${this.splitFiles.length}枚のPNG · 合計
                          ${formatSize(this.splitFiles.reduce((n, f) => n + f.blob.size, 0))}<br />${this.splitFiles
                            .slice(0, 3)
                            .map((f) => f.name)
                            .join(" / ")}
                        </div>`
                      : ""
                  }
                </div>
                <footer>
                  <button ?disabled=${app.busy} @click=${() => this.close()}>キャンセル</button
                  ><button
                    class="primary"
                    ?disabled=${app.busy || !this.splitFiles.length}
                    @click=${() => this.saveTiles()}
                  >
                    画像素材として保存
                  </button>
                </footer>`
            : nothing
        }
      </section>
    </div>`;
  }
}
customElements.define("assets-page", AssetsPage);
