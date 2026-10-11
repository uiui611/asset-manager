import { css, html, LitElement } from "lit";
import { app } from "../application/asset-service";
import type { StoredFile } from "../domain/models";
export class AssetThumbnail extends LitElement {
  static properties = { file: { attribute: false }, url: { state: true } };
  static styles = css`
    :host {
      display: inline-flex;
      width: 42px;
      height: 42px;
      flex-shrink: 0;
      background: #edf1e6;
      border-radius: 4px;
      align-items: center;
      justify-content: center;
    }
    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      image-rendering: pixelated;
    }
  `;
  file!: StoredFile;
  url = "";
  private generation = 0;
  updated(changes: Map<string, unknown>) {
    if (changes.has("file")) void this.load();
  }
  private async load() {
    const generation = ++this.generation;
    URL.revokeObjectURL(this.url);
    this.url = "";
    try {
      const blob = await app.thumb(this.file);
      if (blob && this.isConnected && generation === this.generation)
        this.url = URL.createObjectURL(blob);
    } catch {
      /* Keep the fallback when an image is missing. */
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.generation++;
    URL.revokeObjectURL(this.url);
  }
  render() {
    return this.url
      ? html`<img src=${this.url} alt=${this.file.name} />`
      : html`<span aria-label="画像">▧</span>`;
  }
}
customElements.define("asset-thumbnail", AssetThumbnail);
