import { css, html, LitElement } from "lit";
import { currentProject } from "../../app/router";
import { app, storage } from "../../application/asset-service";
import {
  generateSound,
  hasWebAudio,
  peaks,
  playSamples,
  renderMix,
  renderTrack,
  samplesToWav,
  soundDefaults,
  stopPreset,
} from "../../application/audio";
import {
  askName,
  confirmDiscard,
  editing,
  fingerprint,
  updateLeaveGuard,
} from "../../application/edit-session";
import { download, jsonBlob } from "../../application/media";
import { icon } from "../../components/icon";
import { shared } from "../../components/styles";
import { editorKind } from "../../domain/library";
import { now, type SoundPreset, type SoundTrack, uid } from "../../domain/models";
import { soundControls, soundParameterMax } from "../../domain/sound-parameters";
import { validateProject } from "../../schemas/projects";

const newTrack = (n: number): SoundTrack => ({
  id: uid(),
  name: `トラック ${n}`,
  parameters: soundDefaults(),
  gain: 1,
  offset: 0,
  muted: false,
});
const newSound = (): SoundPreset => ({
  schemaVersion: 1,
  id: uid(),
  name: "",
  format: "multitrack",
  tracks: [newTrack(1)],
  updatedAt: now(),
});
export class SoundsPage extends LitElement {
  static properties = {
    preset: { state: true },
    selectedId: { state: true },
    waves: { state: true },
    advanced: { state: true },
    saved: { state: true },
    help: { state: true },
  };
  static styles = [
    shared,
    css`
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 18px;
      }
      .layout {
        display: grid;
        grid-template-columns: minmax(240px, 1fr) minmax(280px, 1fr);
        gap: 18px;
      }
      .tracks {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .track {
        border: 1px solid #dce5d4;
        border-radius: 10px;
        padding: 14px;
        background: #fcfefa;
      }
      .track.active {
        border: 2px solid #779c66;
        padding: 13px;
      }
      .waveform {
        display: flex;
        align-items: center;
        gap: 2px;
        height: 82px;
        padding: 8px;
        background: #263f33;
        border-radius: 6px;
        overflow: hidden;
        margin: 10px 0;
      }
      .waveform i {
        flex: 1;
        background: #abc994;
        min-height: 2px;
      }
      .fields,
      .knobs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
      }
      .presets {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .track input[type="text"] {
        max-width: 180px;
      }
      .track .row {
        flex-wrap: wrap;
      }
      .sound-name {
        max-width: 400px;
        font-size: 19px;
      }
      .value {
        float: right;
        color: #7c9270;
      }
      .parameter-field {
        display: flex;
        flex-direction: column;
        gap: 5px;
        font-size: 12px;
        color: #5e7165;
      }
      .parameter-label {
        padding: 0;
        border: 0;
        border-radius: 2px;
        background: transparent;
        font-size: 12px;
        text-decoration: underline dotted;
        text-underline-offset: 3px;
      }
      .parameter-help {
        border: 1px solid var(--line);
        color: inherit;
        width: min(440px, calc(100% - 32px));
      }
      .parameter-help::backdrop {
        background: #172b2455;
      }
      .muted-track {
        opacity: 0.55;
      }
      @media (max-width: 850px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];
  preset = newSound();
  selectedId = this.preset.tracks[0].id;
  waves: Record<string, number[]> = {};
  advanced = false;
  saved = "未保存";
  private help?: { label: string; description: string };
  private baseline = fingerprint(this.preset);
  private version?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private previewTimer?: ReturnType<typeof setTimeout>;
  private history: SoundPreset[] = [];
  private redoHistory: SoundPreset[] = [];
  private dirty = () => fingerprint(this.preset) !== this.baseline;
  private change = () => this.requestUpdate();
  private keydown = (event: KeyboardEvent) => {
    if (
      document.querySelector("dialog[open]") ||
      this.renderRoot.querySelector("dialog[open]") ||
      event
        .composedPath()
        .some((el) => el instanceof HTMLElement && el.matches("input,textarea,select"))
    )
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      this.undo(event.shiftKey);
    }
  };
  connectedCallback() {
    super.connectedCallback();
    editing.dirty = this.dirty;
    app.addEventListener("change", this.change);
    window.addEventListener("keydown", this.keydown);
    this.scheduleWaves();
  }
  protected firstUpdated() {
    const id = currentProject();
    if (id)
      void app
        .refresh()
        .then(() => app.whenIdle())
        .then(() => {
          if (this.isConnected) return this.open(id);
        })
        .catch((error) => {
          app.error = String(error);
          app.changed();
        });
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    app.removeEventListener("change", this.change);
    window.removeEventListener("keydown", this.keydown);
    if (editing.dirty === this.dirty) editing.dirty = () => false;
    updateLeaveGuard();
    clearTimeout(this.timer);
    this.stopPreview();
  }
  protected updated() {
    updateLeaveGuard();
  }
  private stopPreview() {
    clearTimeout(this.previewTimer);
    stopPreset();
  }
  private preview() {
    this.stopPreview();
    void app.run(() => playSamples(renderMix(this.preset)));
  }
  private editSound(action: () => void) {
    this.edit(action);
    this.stopPreview();
    if (hasWebAudio()) this.previewTimer = setTimeout(() => this.preview(), 250);
  }
  private parameterLabel(label: string, description: string) {
    return html`<button
      class="parameter-label"
      aria-label=${`${label}の解説`}
      aria-haspopup="dialog"
      @click=${async (event: MouseEvent) => {
        // WebKit does not focus buttons on pointer clicks; set the dialog's return target.
        (event.currentTarget as HTMLButtonElement).focus();
        this.help = { label, description };
        await this.updateComplete;
        this.renderRoot.querySelector<HTMLDialogElement>(".parameter-help")?.showModal();
      }}
    >
      ${label}
    </button>`;
  }
  private edit(action: () => void) {
    this.history.push(structuredClone(this.preset));
    if (this.history.length > 40) this.history.shift();
    this.redoHistory = [];
    action();
    this.changed();
  }
  private changed() {
    this.preset = { ...this.preset, updatedAt: now() };
    this.saved = this.dirty() ? "未保存の変更" : this.version ? "保存済み" : "未保存";
    updateLeaveGuard();
    this.scheduleWaves();
  }
  private undo(redo = false) {
    const from = redo ? this.redoHistory : this.history,
      to = redo ? this.history : this.redoHistory;
    const data = from.pop();
    if (data) {
      this.stopPreview();
      to.push(structuredClone(this.preset));
      this.preset = { ...data, id: this.preset.id };
      this.selectedId = data.tracks.some((t) => t.id === this.selectedId)
        ? this.selectedId
        : data.tracks[0].id;
      this.changed();
    }
  }
  private scheduleWaves() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        this.waves = Object.fromEntries(
          this.preset.tracks.map((t) => [t.id, peaks(renderTrack(t)).map((v) => v * t.gain)]),
        );
      } catch (error) {
        app.error = String(error);
        app.changed();
      }
    }, 120);
  }
  private async newFile() {
    if (app.busy) return;
    if (!(await confirmDiscard())) return;
    this.stopPreview();
    this.preset = newSound();
    this.selectedId = this.preset.tracks[0].id;
    this.baseline = fingerprint(this.preset);
    this.version = undefined;
    this.history = [];
    this.redoHistory = [];
    this.saved = "未保存";
    this.scheduleWaves();
  }
  private async open(id: string) {
    if (app.busy) return;
    if (!id || !(await confirmDiscard())) return;
    const file = app.files.find((f) => f.assetId === id && editorKind(f) === "sound");
    if (!file) return;
    const value = await app.run(() => app.openProject(file));
    if (value) {
      this.stopPreview();
      this.preset = value as SoundPreset;
      this.selectedId = this.preset.tracks[0].id;
      this.baseline = fingerprint(value);
      this.version = file.version;
      this.history = [];
      this.redoHistory = [];
      this.saved = "保存済み";
      this.scheduleWaves();
    }
  }
  private async save(asCopy = false) {
    if (app.busy) return;
    const cancellation = app.cancellationToken;
    const name =
      asCopy || !this.preset.name.trim()
        ? await askName(asCopy ? this.preset.name : "")
        : this.preset.name.trim();
    if (!name || !this.isConnected || cancellation !== app.cancellationToken) return;
    const originalName = this.preset.name;
    const snapshot = structuredClone(this.preset);
    snapshot.name = name;
    if (asCopy) snapshot.id = uid();
    const result = await app.run(() =>
      app.saveProject("sound", snapshot, asCopy ? undefined : this.version),
    );
    if (result) {
      this.version = result.version;
      this.preset = {
        ...this.preset,
        id: snapshot.id,
        name: this.preset.name === originalName ? snapshot.name : this.preset.name,
      };
      this.baseline = fingerprint(snapshot);
      this.saved = this.dirty() ? "未保存の変更" : "保存済み";
      updateLeaveGuard();
    }
  }
  private async saveWav() {
    const cancellation = app.cancellationToken;
    const name = this.preset.name.trim() || (await askName());
    if (!name || !this.isConnected || cancellation !== app.cancellationToken) return;
    const snapshot = structuredClone(this.preset);
    await app.run(async () => {
      const id = uid();
      await app.startOperation("upload", [
        {
          id,
          name: `${name}.wav`,
          blob: samplesToWav(renderMix(snapshot)),
          metadata: { assetId: id, type: "audio", tagIds: ["audio"] },
        },
      ]);
    });
  }
  private async importJson(file?: File) {
    if (app.busy) return;
    if (!file || !(await confirmDiscard())) return;
    await app.run(async () => {
      if (file.size > 1_000_000) throw new Error("効果音JSONは1 MB以下にしてください。");
      const data = JSON.parse(await file.text());
      validateProject("sound", data);
      this.stopPreview();
      this.preset = { ...(data as SoundPreset), id: uid() };
      this.version = undefined;
      this.selectedId = this.preset.tracks[0].id;
      this.history = [];
      this.redoHistory = [];
      this.changed();
    });
  }
  render() {
    const track = this.preset.tracks.find((t) => t.id === this.selectedId) || this.preset.tracks[0];
    const savedFiles = app.files.filter((f) => editorKind(f) === "sound");
    return html` <div class="page-head">
        <div>
          <div class="eyebrow">GIVE YOUR WORLD A SOUND</div>
          <h1>音楽・効果音</h1>
          <p>トラックを重ねて、ひとつの音をつくろう。</p>
        </div>
        <div class="row">
          <button ?disabled=${app.busy} @click=${() => this.newFile()}>
            ${icon("plus", 15)}新規作成</button
          ><button
            class="primary"
            ?disabled=${app.busy || !storage.connected}
            @click=${() => this.save()}
          >
            ${icon("cloud", 16)}保存する</button
          ><button ?disabled=${app.busy || !storage.connected} @click=${() => this.save(true)}>
            別名で保存する
          </button>
        </div>
      </div>
      <div class="toolbar">
        <select
          aria-label="開く"
          @change=${(event: Event) => {
            const input = event.target as HTMLSelectElement;
            void this.open(input.value);
            input.value = "";
          }}
        >
          <option value="">開く…</option>
          ${savedFiles.map((f) => html`<option value=${f.assetId}>${f.name}</option>`)}</select
        ><button
          @click=${() => this.renderRoot.querySelector<HTMLInputElement>("#sound-import")?.click()}
        >
          インポート</button
        ><input
          id="sound-import"
          class="sr-only"
          type="file"
          accept=".json"
          @change=${(event: Event) => {
            const input = event.target as HTMLInputElement;
            void this.importJson(input.files?.[0]);
            input.value = "";
          }}
        /><button
          title="端末へダウンロード"
          @click=${async () => {
            const name = this.preset.name.trim() || (await askName("", true));
            if (name) download(jsonBlob({ ...this.preset, name }), `${name}.json`);
          }}
        >
          ${icon("download", 13)}エクスポート</button
        ><button ?disabled=${app.busy || !storage.connected} @click=${() => this.saveWav()}>
          WAVを素材として保存
        </button>
      </div>
      <div class="row spread" style="margin-bottom:18px">
        <input
          class="sound-name"
          aria-label="効果音名"
          placeholder="名前なし"
          .value=${this.preset.name}
          @input=${(event: Event) => this.edit(() => (this.preset.name = (event.target as HTMLInputElement).value))}
        /><span role="status">${this.saved}</span>
      </div>
      <div class="actions">
        <button
          aria-label="試聴する"
          title="試聴する"
          ?disabled=${!hasWebAudio()}
          @click=${() => this.preview()}
        >
          ${icon("play", 18)}</button
        ><button aria-label="停止" title="停止" @click=${() => this.stopPreview()}>
          ${icon("stop", 18)}</button
        ><button
          aria-label="元に戻す"
          ?disabled=${!this.history.length}
          @click=${() => this.undo()}
        >
          ↶</button
        ><button
          aria-label="やり直す"
          ?disabled=${!this.redoHistory.length}
          @click=${() => this.undo(true)}
        >
          ↷
        </button>
      </div>
      <div class="layout">
        <section class="tracks">
          <div class="row spread">
            <h3>トラック</h3>
            <button
              ?disabled=${this.preset.tracks.length >= 8}
              @click=${() =>
                this.edit(() => {
                  const next = newTrack(this.preset.tracks.length + 1);
                  this.preset.tracks.push(next);
                  this.selectedId = next.id;
                })}
            >
              トラックを追加
            </button>
          </div>
          ${this.preset.tracks.map(
            (t) =>
              html`<article class="track ${track.id === t.id ? "active" : ""}">
                <div class="row spread">
                  <button @click=${() => (this.selectedId = t.id)}>${t.name} を編集</button
                  ><label class="check"
                    ><input
                      type="checkbox"
                      aria-label=${`${t.name} ミュート`}
                      .checked=${t.muted}
                      @change=${(event: Event) => this.edit(() => (t.muted = (event.target as HTMLInputElement).checked))}
                    />ミュート</label
                  ><button
                    ?disabled=${this.preset.tracks.length === 1}
                    aria-label=${`${t.name} を削除`}
                    @click=${() =>
                      this.edit(() => {
                        this.preset.tracks = this.preset.tracks.filter(
                          (other) => other.id !== t.id,
                        );
                        this.selectedId = this.preset.tracks[0].id;
                      })}
                  >
                    削除
                  </button>
                </div>
                <div
                  class="waveform ${t.muted ? "muted-track" : ""}"
                  aria-label=${`${t.name} の波形`}
                >
                  ${(this.waves[t.id] || []).map((v) => html`<i style=${`height:${Math.max(2, v * 70)}px`}></i>`)}
                </div>
                <div class="fields">
                  <div class="parameter-field">
                    <div>
                      ${this.parameterLabel("音量", "このトラックを重ねるときの音量です。0で無音、1で生成した音の音量を保ちます。")}
                    </div>
                    <input
                      aria-label=${`${t.name} 音量`}
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      .value=${String(t.gain)}
                      @input=${(event: Event) => this.editSound(() => (t.gain = Number((event.target as HTMLInputElement).value)))}
                    />
                  </div>
                  <div class="parameter-field">
                    <div>
                      ${this.parameterLabel("開始位置（秒）", "このトラックを鳴らし始めるまでの待ち時間です。0で最初から鳴り、値を大きくするとほかのトラックより遅れて鳴ります。")}
                    </div>
                    <input
                      aria-label=${`${t.name} 開始位置`}
                      type="number"
                      min="0"
                      max="10"
                      step="0.01"
                      .value=${String(t.offset)}
                      @change=${(event: Event) => {
                        const n = Number((event.target as HTMLInputElement).value);
                        if (Number.isFinite(n) && n >= 0 && n <= 10)
                          this.editSound(() => (t.offset = n));
                      }}
                    />
                  </div>
                </div>
              </article>`,
          )}
          <p class="muted">
            最大8トラック。重なった音が大きすぎる場合は、全体の音量を自動調整します。
          </p>
        </section>
        <section class="panel stack">
          <label
            >トラック名<input
              aria-label="トラック名"
              .value=${track.name}
              @input=${(event: Event) => this.edit(() => (track.name = (event.target as HTMLInputElement).value))}
          /></label>
          <h3>プリセットからつくる</h3>
          <div class="presets">
            ${[
              ["pickupCoin", "コイン"],
              ["laserShoot", "レーザー"],
              ["explosion", "爆発"],
              ["powerUp", "パワーアップ"],
              ["hitHurt", "ダメージ"],
              ["jump", "ジャンプ"],
              ["blipSelect", "決定音"],
              ["random", "ランダム"],
            ].map(
              ([value, label]) =>
                html`<button
                  @click=${() => this.editSound(() => (track.parameters = generateSound(value)))}
                >
                  ${label}
                </button>`,
            )}
          </div>
          <div class="parameter-field">
            <div>
              ${this.parameterLabel("波形", "音色のもとになる波の形です。矩形波は電子音、ノコギリ波は鋭い音、正弦波は柔らかい音、ノイズは爆発や打撃のような音に向いています。")}
            </div>
            <select
              aria-label="波形"
              .value=${String(track.parameters.wave_type ?? 0)}
              @change=${(event: Event) => this.editSound(() => (track.parameters.wave_type = Number((event.target as HTMLSelectElement).value)))}
            >
              ${["矩形波", "ノコギリ波", "正弦波", "ノイズ"].map((name, i) => html`<option value=${i}>${name}</option>`)}
            </select>
          </div>
          <div class="knobs">
            ${soundControls
              .filter((_, i) => this.advanced || [0, 1, 4, 5, 7, 22].includes(i))
              .map(
                ([key, label, min, description]) =>
                  html`<div class="parameter-field">
                    <div>
                      ${this.parameterLabel(label, description)}<span class="value"
                        >${Number(track.parameters[key] || 0).toFixed(2)}</span
                      >
                    </div>
                    <input
                      type="range"
                      aria-label=${label}
                      min=${min}
                      max=${soundParameterMax(key)}
                      step="0.01"
                      .value=${String(track.parameters[key] || 0)}
                      @input=${(event: Event) => this.editSound(() => (track.parameters[key] = Number((event.target as HTMLInputElement).value)))}
                    />
                  </div>`,
              )}
          </div>
          <button @click=${() => (this.advanced = !this.advanced)}>
            ${this.advanced ? "基本パラメータだけ表示" : "すべてのパラメータを表示"}
          </button>
          <p class="muted">パラメータを変更すると波形を更新し、操作が止まってから試聴します。</p>
        </section>
      </div>
      <dialog
        class="dialog parameter-help"
        aria-labelledby="parameter-help-title"
        aria-describedby="parameter-help-description"
      >
        <h2 id="parameter-help-title">${this.help?.label}</h2>
        <p id="parameter-help-description">${this.help?.description}</p>
        <footer>
          <button
            @click=${() => this.renderRoot.querySelector<HTMLDialogElement>(".parameter-help")?.close()}
          >
            閉じる
          </button>
        </footer>
      </dialog>`;
  }
}
customElements.define("sounds-page", SoundsPage);
