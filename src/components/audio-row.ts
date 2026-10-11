import { css, html, LitElement } from "lit";
import { app, storage } from "../application/asset-service";
import { editorKind } from "../domain/library";
import type { SoundPreset, StoredFile } from "../domain/models";
import { shared } from "./styles";
export class AudioRow extends LitElement {
  static properties = {
    file: { attribute: false },
    selected: { type: Boolean },
    playing: { state: true },
    loading: { state: true },
  };
  static styles = [
    shared,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .row {
        height: 70px;
        border: 1px solid #dce5d4;
        border-radius: 8px;
        padding: 10px;
        background: white;
        gap: 12px;
      }
      .selected {
        border-color: #779c66;
      }
      .name {
        flex: 1;
        min-width: 0;
        text-align: left;
        justify-content: flex-start;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      small {
        font-size: 10px;
        color: #839576;
      }
      button {
        white-space: nowrap;
      }
    `,
  ];
  file!: StoredFile;
  selected = false;
  playing = false;
  loading = false;
  private audio?: HTMLAudioElement;
  private url = "";
  private generation = 0;
  private stopOthers = (event: Event) => {
    if ((event as CustomEvent).detail !== this) this.audio?.pause();
  };
  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("asset-audio-play", this.stopOthers);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.generation++;
    this.audio?.pause();
    URL.revokeObjectURL(this.url);
    window.removeEventListener("asset-audio-play", this.stopOthers);
  }
  protected updated(changes: Map<string, unknown>) {
    if (changes.has("file")) {
      this.generation++;
      this.audio?.pause();
      this.audio = undefined;
      URL.revokeObjectURL(this.url);
      this.url = "";
      this.playing = false;
    }
  }
  private async play() {
    if (this.playing) {
      this.audio?.pause();
      return;
    }
    this.loading = true;
    const generation = this.generation;
    try {
      if (!this.audio) {
        let blob: Blob;
        if (editorKind(this.file) === "sound") {
          const { renderMix, samplesToWav } = await import("../application/audio");
          blob = samplesToWav(renderMix((await app.openProject(this.file)) as SoundPreset));
        } else blob = await app.blob(this.file);
        if (!this.isConnected || generation !== this.generation) return;
        this.url = URL.createObjectURL(blob);
        this.audio = new Audio(this.url);
        this.audio.onplay = () => (this.playing = true);
        this.audio.onpause = () => (this.playing = false);
        this.audio.onended = () => (this.playing = false);
      }
      window.dispatchEvent(new CustomEvent("asset-audio-play", { detail: this }));
      await this.audio.play();
    } catch (error) {
      app.error = String(error);
      app.changed();
    } finally {
      this.loading = false;
    }
  }
  private open() {
    const event = new CustomEvent("open-asset", {
      detail: this.file,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    if (this.dispatchEvent(event)) void this.play();
  }
  render() {
    const f = this.file;
    if (!f) return;
    return html`<article class="row ${this.selected ? "selected" : ""}">
      <input
        type="checkbox"
        aria-label=${`${f.name} を選択`}
        .checked=${this.selected}
        @change=${() => this.dispatchEvent(new CustomEvent("select-asset", { detail: f.assetId, bubbles: true, composed: true }))}
      /><button
        aria-label=${`${f.name} を${this.playing ? "停止" : "再生"}`}
        ?disabled=${this.loading || !storage.connected}
        @click=${() => this.play()}
      >
        ${this.loading ? "読込中" : this.playing ? "■ 停止" : "▶ 再生"}</button
      ><button
        class="name quiet"
        title=${f.name}
        aria-label=${`${f.name} の詳細`}
        @click=${() => this.open()}
      >
        ${f.name}</button
      ><small
        >${editorKind(f) === "sound" ? "効果音JSON" : f.mimeType.split("/")[1]?.toUpperCase()}</small
      >
    </article>`;
  }
}
customElements.define("audio-row", AudioRow);
