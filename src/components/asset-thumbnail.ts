import { css, html, LitElement, type ReactiveController, type ReactiveControllerHost } from "lit";
import { app } from "../application/asset-service";
import type { StoredFile } from "../domain/models";

/** Keep decoded previews only while their element is near the visible area. */
export class ThumbnailController implements ReactiveController {
  url = "";
  failed = false;
  private observer?: IntersectionObserver;
  private visible = false;
  private generation = 0;
  private loading = false;
  private file?: StoredFile;
  constructor(
    private host: ReactiveControllerHost & Element,
    private currentFile: () => StoredFile | undefined,
    private eligible: (file: StoredFile) => boolean = () => true,
  ) {
    host.addController(this);
  }
  hostConnected() {
    if (typeof IntersectionObserver === "undefined") {
      this.visible = true;
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        this.visible = entries.some((entry) => entry.isIntersecting);
        if (this.visible) void this.load();
        else this.release();
      },
      { rootMargin: "80px" },
    );
    this.observer.observe(this.host);
  }
  hostUpdated() {
    const file = this.currentFile();
    if (file === this.file) return;
    this.file = file;
    this.release();
    this.failed = false;
    if (this.visible) void this.load();
  }
  private release() {
    this.generation++;
    this.loading = false;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = "";
    this.host.requestUpdate();
  }
  private async load() {
    const file = this.currentFile();
    if (!file || !this.eligible(file) || this.url || this.loading || this.failed) return;
    const generation = ++this.generation;
    this.loading = true;
    try {
      const blob = await app.thumb(file);
      if (!this.host.isConnected || !this.visible || generation !== this.generation) return;
      if (blob) this.url = URL.createObjectURL(blob);
      else this.failed = true;
    } catch {
      if (generation === this.generation) this.failed = true;
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.host.requestUpdate();
      }
    }
  }
  hostDisconnected() {
    this.observer?.disconnect();
    this.observer = undefined;
    this.visible = false;
    this.release();
  }
}

export class AssetThumbnail extends LitElement {
  static properties = { file: { attribute: false } };
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
  private thumbnail = new ThumbnailController(this, () => this.file);
  render() {
    return this.thumbnail.url
      ? html`<img src=${this.thumbnail.url} alt=${this.file.name} />`
      : html`<span aria-label=${this.thumbnail.failed ? "画像を取得できません" : "画像"}>▧</span>`;
  }
}
customElements.define("asset-thumbnail", AssetThumbnail);
