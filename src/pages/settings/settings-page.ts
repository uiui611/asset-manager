import { css, html, LitElement, nothing } from "lit";
import { app, storage } from "../../application/asset-service";
import { download, jsonBlob } from "../../application/media";
import { DialogController } from "../../components/dialog-controller";
import { icon } from "../../components/icon";
import { shared } from "../../components/styles";
import { db } from "../../database/db";
import { encodeProperties } from "../../domain/metadata";
import { now, type OperationJournal, type StoredFile, type Tag } from "../../domain/models";

interface Manifest {
  schemaVersion: 1;
  exportedAt: string;
  assets: StoredFile[];
  tags: Tag[];
}
export class SettingsPage extends LitElement {
  constructor() {
    super();
    new DialogController(this);
  }
  static properties = {
    tagName: { state: true },
    operations: { state: true },
    issues: { state: true },
    diagnosed: { state: true },
    message: { state: true },
    confirmClear: { state: true },
    manifest: { state: true },
  };
  static styles = [
    shared,
    css`
      .settings {
        display: grid;
        grid-template-columns: minmax(0, 1.25fr) minmax(270px, 0.85fr);
        gap: 22px;
        align-items: start;
      }
      .section-title {
        display: flex;
        gap: 10px;
        align-items: center;
        margin-bottom: 17px;
      }
      .instructions {
        font-size: 12px;
        color: #7e8e72;
        line-height: 2;
        padding-left: 20px;
      }
      .instructions li {
        padding-left: 4px;
        margin-bottom: 6px;
      }
      .connect-input {
        width: 100%;
        font-size: 11px;
      }
      .settings .panel {
        padding: 25px;
      }
      .tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
      }
      .tag-list .tag {
        font-size: 11px;
        padding: 5px 10px;
      }
      .journal {
        border-top: 1px solid #e4e9df;
        padding: 13px 0;
      }
      .journal strong {
        font-size: 12px;
      }
      .journal p {
        font-size: 10px;
        color: #8c9980;
      }
      .journal .row {
        margin-top: 8px;
      }
      .settings p {
        font-size: 12px;
      }
      .link-list a {
        font-size: 12px;
        display: block;
        margin-top: 6px;
      }
      .meta-line {
        font-size: 11px;
        color: #88957d;
        margin: 10px 0;
      }
      .wide {
        grid-column: 1/-1;
      }
      .diagnostic-list {
        font-size: 11px;
        max-height: 220px;
        overflow: auto;
      }
      .setting-note {
        font-size: 10px !important;
        color: #90a081;
        line-height: 1.9;
      }
      .connected-dot {
        width: 8px;
        height: 8px;
        background: #7ba561;
        border-radius: 50%;
      }
      @media (max-width: 960px) {
        .settings {
          grid-template-columns: 1fr;
        }
        .settings .panel {
          padding: 20px;
        }
      }
    `,
  ];
  tagName = "";
  operations: OperationJournal[] = [];
  issues: string[] = [];
  diagnosed = false;
  message = "";
  confirmClear = false;
  manifest: Manifest | null = null;
  private change = () => {
    this.requestUpdate();
    void this.refresh();
  };
  connectedCallback() {
    super.connectedCallback();
    app.addEventListener("change", this.change);
    void this.refresh();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    app.removeEventListener("change", this.change);
  }
  private async refresh() {
    this.operations = (await db.operationJournal.toArray()).filter((o) => o.status !== "completed");
  }
  private async manifestExport() {
    await app.run(async () => {
      const manifest: Manifest = {
        schemaVersion: 1,
        exportedAt: now(),
        assets: app.files,
        tags: app.tags,
      };
      download(jsonBlob(manifest), `asset-manifest-${now().slice(0, 10)}.json`);
      this.message = "マニフェストを書き出しました。素材本体は含まれません。";
    });
  }
  private async manifestImport(file?: File) {
    if (!file) return;
    await app.run(async () => {
      if (file.size > 50_000_000) throw new Error("マニフェストは50 MB以下にしてください。");
      const data = JSON.parse(await file.text());
      if (data.schemaVersion !== 1 || !Array.isArray(data.assets) || !Array.isArray(data.tags))
        throw new Error("マニフェストの形式が不正です。");
      for (const asset of data.assets) {
        if (
          typeof asset.assetId !== "string" ||
          typeof asset.fileId !== "string" ||
          typeof asset.name !== "string" ||
          !Array.isArray(asset.tagIds) ||
          asset.tagIds.some((id: unknown) => typeof id !== "string")
        )
          throw new Error("素材メタデータが不正です。");
        encodeProperties(asset);
      }
      for (const tag of data.tags)
        if (typeof tag.tagId !== "string" || typeof tag.name !== "string")
          throw new Error("タグ定義が不正です。");
      this.manifest = data;
    });
  }
  private async restoreManifest() {
    const manifest = this.manifest;
    if (!manifest) return;
    await app.run(async () => {
      app.requireConnected();
      const items = [];
      for (const asset of manifest.assets) {
        const current = await storage.getMetadata(asset.fileId);
        if (current.assetId !== asset.assetId)
          throw new Error(`${asset.name}: 保存先の素材IDが一致しません。`);
        await app.putFile(current);
        items.push({
          id: asset.assetId,
          fileId: asset.fileId,
          name: asset.name,
          metadata: {
            name: asset.name,
            description: asset.description,
            tagIds: asset.tagIds,
          },
        });
      }
      const tags = new Map(app.tags.map((t) => [t.tagId, t]));
      for (const t of manifest.tags) {
        if (tags.has(t.tagId) && tags.get(t.tagId)?.name !== t.name)
          throw new Error(`タグID ${t.tagId} に異なる定義があります。`);
        tags.set(t.tagId, t);
      }
      for (const tag of tags.values()) await storage.createTag(tag.name);
      await db.tags.bulkPut([...tags.values()]);
      await app.startOperation("bulk-tag", items);
      this.manifest = null;
      this.message = "素材の名前・説明・タグを復元しました。";
    });
  }
  render() {
    return html`
      <div class="page-head">
        <div>
          <div class="eyebrow" style="margin-bottom:7px">A HOME FOR YOUR CREATIVE WORK</div>
          <h1>設定・データ管理</h1>
          <p>保存先の接続と、ライブラリのメンテナンス。</p>
        </div>
        <span class="pill">個人用ワークスペース</span>
      </div>
      ${
        this.message
          ? html`
              <div class="notice" role="status" style="margin-bottom:20px">${this.message}</div>
            `
          : ""
      }
      <div class="settings">
        <div class="stack">
          <section class="panel stack">
            <h2>プライベートストレージ</h2>
            <p>RustFS / assets バケット・YugabyteDB</p>
            <p>状態: ${storage.connected ? "接続済み" : "未接続"}</p>
            <button ?disabled=${app.busy || app.uploads > 0} @click=${() => app.connect()}>
              接続を確認・一覧を更新
            </button>
            <p>画像・音声・JSONを一元管理します。</p>
          </section>
          <section class="panel">
            <h2 class="section-title">${icon("tag", 21)}タグの管理</h2>
            <div class="tag-list">
              ${app.tags.map((t) => html` <span class="tag">${t.name}</span> `)}
            </div>
            ${
              !app.tags.length
                ? html`
                    <p class="muted">「マップチップ」「キャラクター」など、使いやすい分類を。</p>
                  `
                : ""
            }
            <div class="row" style="margin-top:16px">
              <input
                aria-label="新しいタグ名"
                placeholder="新しいタグ名"
                style="flex:1;width:100%"
                .value=${this.tagName}
                @input=${(e: Event) => (this.tagName = (e.target as HTMLInputElement).value)}
              />
              <button
                ?disabled=${!storage.connected || app.busy || !this.tagName.trim()}
                @click=${async () => {
                  await app.run(() => app.createTag(this.tagName));
                  if (!app.error) this.tagName = "";
                }}
              >
                ${icon("plus", 14)}追加
              </button>
            </div>
            <p class="setting-note" style="margin-top:12px">
              タグ定義はストレージへ保存されます。素材ごとに最大50個まで付けられます。
            </p>
          </section>
          <section class="panel">
            <h2 class="section-title">${icon("refresh", 21)}中断した操作</h2>
            ${
              this.operations.length
                ? this.operations.map(
                    (o) => html`
                      <div class="journal">
                        <strong
                          >${{ upload: "素材の登録", "tile-split": "タイル分割", "bulk-tag": "タグ・メタデータ更新", "bulk-trash": "削除" }[o.type]}</strong
                        >
                        <p>
                          ${o.completedItems.length} /
                          ${o.completedItems.length + o.pendingItems.length} 完了 · ${o.status}
                        </p>
                        ${o.error ? html` <p style="color:#ac6358">${o.error}</p> ` : ""}
                        <div class="row">
                          <button
                            class="small"
                            ?disabled=${app.busy || !storage.connected}
                            @click=${() => app.run(() => app.resume(o.id))}
                          >
                            残りを再開
                          </button>
                          <button
                            class="small quiet"
                            ?disabled=${app.busy || app.uploads > 0}
                            @click=${async () => {
                              await db.operationJournal.delete(o.id);
                              await this.refresh();
                            }}
                          >
                            残りを取り消す
                          </button>
                        </div>
                      </div>
                    `,
                  )
                : html` <p class="muted">中断した操作はありません。</p> `
            }
          </section>
        </div>
        <div class="stack">
          <section class="panel stack">
            <h2 class="section-title" style="margin:0">${icon("download", 20)}バックアップ</h2>
            <p class="muted">
              素材の名前・説明・タグを保存します。画像・音声・編集用JSONの本体は含みません。
            </p>
            <button ?disabled=${app.busy || app.uploads > 0} @click=${() => this.manifestExport()}>
              マニフェストを書き出す
            </button>
            <button
              ?disabled=${app.busy || app.uploads > 0}
              @click=${() => this.renderRoot.querySelector<HTMLInputElement>("#manifest")?.click()}
            >
              マニフェストから復元
            </button>
            <input
              id="manifest"
              class="sr-only"
              type="file"
              accept=".json"
              @change=${(e: Event) => {
                const input = e.target as HTMLInputElement;
                void this.manifestImport(input.files?.[0]);
                input.value = "";
              }}
            />
            <p class="setting-note">
              素材本体は含まれません。復元時はストレージ上の同じファイルを確認し、名前・説明・タグを戻します。削除済みファイルの本体をこの機能で復元することはできません。
            </p>
          </section>
          <section class="panel stack">
            <h2 class="section-title" style="margin:0">${icon("check", 21)}ライブラリ診断</h2>
            <p class="muted">素材とマップ・キャラクターの参照を確認します。</p>
            <button
              ?disabled=${app.busy || !storage.connected}
              @click=${async () => {
                const issues = await app.run(() => app.diagnostics());
                if (issues) {
                  this.issues = issues;
                  this.diagnosed = true;
                }
              }}
            >
              参照をチェック</button
            >${
              this.diagnosed
                ? this.issues.length
                  ? html`
                      <ul class="diagnostic-list">
                        ${this.issues.map((i) => html` <li>${i}</li> `)}
                      </ul>
                    `
                  : html` <div class="notice">参照の問題は見つかりませんでした。</div> `
                : ""
            }
          </section>
          <section class="panel stack">
            <h2 class="section-title" style="margin:0">${icon("settings", 20)}ローカルデータ</h2>
            <p class="muted">
              一覧・サムネイルと中断したアップロードのキャッシュを消去します。ストレージ上のファイルは残ります。
            </p>
            <button
              class="danger"
              ?disabled=${app.busy || app.uploads > 0}
              @click=${() => (this.confirmClear = true)}
            >
              ローカルデータを消去…
            </button>
            <p class="setting-note">
              まずマニフェストを書き出してください。次の接続時にストレージから一覧を再構築します。
            </p>
          </section>
          <section class="notice">
            <strong>保存形式について</strong>
            <p style="margin-top:7px">
              画像の出力はPNG、効果音の出力はWAV。編集データはJSONで保存します。ZIP一括出力は初期版に含めていません。
            </p>
          </section>
        </div>
      </div>
      ${
        this.confirmClear
          ? html`
              <div class="overlay">
                <section
                  class="dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="ローカルデータの消去"
                >
                  <h2>ローカルキャッシュを消去します</h2>
                  <p>
                    このブラウザのキャッシュと中断したアップロードを消去します。サーバーに保存した素材は削除しません。
                  </p>
                  <footer>
                    <button @click=${() => (this.confirmClear = false)}>キャンセル</button>
                    <button
                      class="danger"
                      @click=${async () => {
                        await app.run(async () => {
                          storage.disconnect();
                          await db.transaction("rw", db.tables, async () => {
                            for (const table of db.tables) await table.clear();
                          });
                          this.confirmClear = false;
                          this.message = "ローカルデータを消去しました。";
                        });
                      }}
                    >
                      キャッシュを消去
                    </button>
                  </footer>
                </section>
              </div>
            `
          : nothing
      }
      ${
        this.manifest
          ? html`
              <div class="overlay">
                <section
                  class="dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="マニフェスト復元"
                >
                  <h2>バックアップから復元</h2>
                  <p>
                    ${this.manifest.assets.length}件の名前・説明・タグをストレージへ書き戻します。編集用JSONの内容は変更しません。
                  </p>
                  <footer>
                    <button
                      ?disabled=${app.busy || app.uploads > 0}
                      @click=${() => (this.manifest = null)}
                    >
                      キャンセル
                    </button>
                    <button
                      class="primary"
                      ?disabled=${app.busy || !storage.connected}
                      @click=${() => this.restoreManifest()}
                    >
                      内容を復元
                    </button>
                  </footer>
                </section>
              </div>
            `
          : nothing
      }
    `;
  }
}
customElements.define("settings-page", SettingsPage);
