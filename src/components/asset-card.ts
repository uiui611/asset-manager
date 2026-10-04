import { css, html, LitElement } from "lit";
import { app } from "../application/asset-service";
import { projectLabel, projectPage } from "../domain/library";
import type { StoredFile } from "../domain/models";
import { icon } from "./icon";
import { shared } from "./styles";
export class AssetCard extends LitElement {
  static properties = {
    file: { attribute: false },
    selected: { type: Boolean },
    url: { state: true },
    failed: { state: true },
  };
  static styles = [
    shared,
    css`:host{height:231px;min-width:0}.card{border:1px solid #e0e6da;border-radius:10px;overflow:hidden;background:#fff;position:relative;height:100%;transition:box-shadow .2s,transform .2s}.card:hover{box-shadow:0 5px 18px #33452b0d;transform:translateY(-2px)}.card.selected{border:2px solid #6d9460}.preview{width:100%;height:154px;border:0;border-radius:0;background:#f0f3e9;color:#a3b097;padding:15px;display:flex;position:relative;flex-direction:column}.preview img{width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;image-rendering:pixelated}.format{position:absolute;bottom:8px;right:9px;background:#ffffffc9;padding:1px 5px;font-size:8px;letter-spacing:.4px;color:#7e8b73}.info{padding:10px 12px}.name{font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:7px}.info .row{gap:4px;overflow:hidden}.meta{margin-left:auto;font-size:9px;white-space:nowrap;color:#9ba58f}.selection{position:absolute;z-index:1;left:10px;top:10px;background:#fff;border-radius:3px;display:flex;padding:1px}.selection input{margin:0;width:14px;height:14px}.loading{font-size:10px;margin-top:8px}.badge{font-size:9px;color:#9da98f}`,
  ];
  file!: StoredFile;
  selected = false;
  url = "";
  failed = false;
  private generation = 0;
  protected updated(changes: Map<string, unknown>) {
    if (changes.has("file")) void this.load();
  }
  private async load() {
    const generation = ++this.generation;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = "";
    this.failed = false;
    if (this.file.type !== "image" && projectPage(this.file) !== "characters")
      return;
    try {
      const blob = await app.thumb(this.file);
      if (blob && this.isConnected && generation === this.generation)
        this.url = URL.createObjectURL(blob);
    } catch {
      if (generation === this.generation) this.failed = true;
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.generation++;
    if (this.url) URL.revokeObjectURL(this.url);
  }
  render() {
    const f = this.file;
    if (!f) return;
    return html`<article class="card ${this.selected ? "selected" : ""}"><label class="selection"><input aria-label=${`${f.name} を選択`} type="checkbox" .checked=${this.selected} @change=${() => this.dispatchEvent(new CustomEvent("select-asset", { detail: f.assetId, bubbles: true, composed: true }))}></label><button class="preview checker" aria-label=${`${f.name} の詳細`} @click=${() => this.dispatchEvent(new CustomEvent("open-asset", { detail: f, bubbles: true, composed: true }))}>${this.url ? html`<img src=${this.url} alt=${f.name}>` : html`${icon(projectPage(f) === "maps" ? "map" : projectPage(f) === "characters" ? "character" : projectPage(f) === "sounds" || f.type === "audio" ? "sound" : f.type === "json" ? "code" : "image", 38)}<span class="loading">${projectPage(f) ? `${projectLabel(f)}JSON素材` : this.failed ? "プレビューを取得できません" : f.type === "audio" ? "AUDIO ASSET" : f.type === "json" ? "JSON ASSET" : "IMAGE ASSET"}</span>`}<span class="format">${f.mimeType.split("/")[1]?.toUpperCase()}</span></button><div class="info"><div class="name" title=${f.name}>${f.name}</div><div class="row">${f.tagIds.slice(0, 2).map((id) => html`<span class="tag">${app.tags.find((t) => t.tagId === id)?.name || id}</span>`)}${!f.tagIds.length ? html`<span class="badge">${projectPage(f) ? "JSON素材" : "素材"}</span>` : ""}<span class="meta">${formatSize(f.size)}</span></div></div></article>`;
  }
}
export function formatSize(n: number) {
  return n >= 1e6
    ? `${(n / 1e6).toFixed(1)} MB`
    : n >= 1000
      ? `${Math.round(n / 1000)} KB`
      : `${n} B`;
}
customElements.define("asset-card", AssetCard);
