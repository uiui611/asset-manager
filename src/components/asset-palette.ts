import { css, html, LitElement } from "lit";
import { app, storage } from "../application/asset-service";
import { isRaster, type StoredFile } from "../domain/models";
import { AssetSearch } from "../domain/search";
import { shared } from "./styles";
import "./asset-thumbnail";
export class AssetPalette extends LitElement {
  static properties = {
    selected: { type: String },
    selection: { attribute: false },
    multiple: { type: Boolean },
    query: { state: true },
    tag: { state: true },
    sort: { state: true },
  };
  static styles = [
    shared,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .filters {
        display: grid;
        gap: 7px;
        margin-bottom: 10px;
      }
      .filters input,
      .filters select {
        width: 100%;
        min-width: 0;
        font-size: 11px;
      }
      .list {
        display: flex;
        flex-direction: column;
        gap: 7px;
        max-height: 400px;
        overflow: auto;
      }
      .list button {
        justify-content: flex-start;
        text-align: left;
        padding: 7px;
        min-width: 0;
      }
      .list span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
      }
      .active {
        border-color: #789769;
        background: #edf3e4;
      }
      .count {
        font-size: 10px;
        color: #7b8c70;
        margin-bottom: 8px;
      }
    `,
  ];
  selected = "";
  selection: string[] = [];
  multiple = false;
  query = "";
  tag = "";
  sort = "newest";
  private files: StoredFile[] = [];
  private search = new AssetSearch([]);
  private change = () => this.requestUpdate();
  connectedCallback() {
    super.connectedCallback();
    app.addEventListener("change", this.change);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    app.removeEventListener("change", this.change);
  }
  render() {
    if (this.files !== app.files) {
      this.files = app.files;
      this.search = new AssetSearch(this.files.filter(isRaster));
    }
    const files = this.search
      .find(this.query, "", this.tag)
      .sort((a, b) =>
        this.sort === "name"
          ? a.name.localeCompare(b.name, "ja")
          : b.modifiedTime.localeCompare(a.modifiedTime),
      );
    return html`<div class="filters">
        <input
          aria-label="パレットを検索"
          placeholder="名前や説明で検索…"
          .value=${this.query}
          @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
        /><select
          aria-label="パレットのタグ"
          .value=${this.tag}
          @change=${(e: Event) => (this.tag = (e.target as HTMLSelectElement).value)}
        >
          <option value="">すべてのタグ</option>
          ${app.tags.map((t) => html`<option value=${t.tagId}>${t.name}</option>`)}</select
        ><select
          aria-label="パレットの並び順"
          .value=${this.sort}
          @change=${(e: Event) => (this.sort = (e.target as HTMLSelectElement).value)}
        >
          <option value="newest">更新が新しい順</option>
          <option value="name">名前順</option>
        </select>
      </div>
      <div class="count">${files.length} 件</div>
      <div class="list">
        ${files.map((f) => {
          const active = this.multiple
            ? this.selection.includes(f.assetId)
            : this.selected === f.assetId;
          return html`<button
            class=${active ? "active" : ""}
            aria-pressed=${active}
            aria-label=${f.name}
            title=${f.name}
            ?disabled=${!storage.connected}
            @click=${() => this.dispatchEvent(new CustomEvent("pick-asset", { detail: f, bubbles: true, composed: true }))}
          >
            <asset-thumbnail .file=${f}></asset-thumbnail
            ><span>${f.name}</span>${this.multiple && active ? html`<span>✓</span>` : ""}
          </button>`;
        })}
      </div>
      ${!files.length ? html`<p class="muted">条件に一致する画像がありません。</p>` : ""}`;
  }
}
customElements.define("asset-palette", AssetPalette);
