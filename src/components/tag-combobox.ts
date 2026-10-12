import { css, html, LitElement, nothing } from "lit";
import { app } from "../application/asset-service";
import type { Tag } from "../domain/models";
import { automaticTagIds, tagName } from "../domain/tags";
import { shared } from "./styles";

export class TagCombobox extends LitElement {
  static properties = {
    selected: { attribute: false },
    multiple: { type: Boolean },
    allowCreate: { type: Boolean },
    disabled: { type: Boolean },
    label: { type: String },
    query: { state: true },
    open: { state: true },
    active: { state: true },
    error: { state: true },
  };
  static styles = [
    shared,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .field {
        position: relative;
      }
      .input-row {
        display: flex;
        gap: 4px;
      }
      input {
        width: 100%;
      }
      .options {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        z-index: 20;
        max-height: 220px;
        overflow: auto;
        background: white;
        border: 1px solid var(--line);
        border-radius: 7px;
        box-shadow: 0 6px 18px #23372e20;
      }
      .option {
        padding: 8px 11px;
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      .option.active,
      .option:hover {
        background: #edf3ed;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
      }
      .tag {
        max-width: 100%;
        white-space: normal;
        overflow-wrap: anywhere;
        align-items: center;
        gap: 5px;
      }
      .tag button {
        padding: 0 3px;
      }
      .hint {
        font-size: 11px;
        margin-top: 5px;
      }
    `,
  ];
  selected: string[] = [];
  multiple = false;
  allowCreate = false;
  disabled = false;
  label = "タグ";
  query = "";
  open = false;
  active = -1;
  error = "";
  private change = () => this.requestUpdate();
  connectedCallback() {
    super.connectedCallback();
    app.addEventListener("change", this.change);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    app.removeEventListener("change", this.change);
  }
  private get candidates() {
    const query = this.query.trim().toLocaleLowerCase();
    return app.tags
      .filter(
        (t) =>
          (!this.multiple || !this.selected.includes(t.tagId)) &&
          // Media tags are assigned automatically, and cannot be bulk-added to other types.
          (!this.multiple || !automaticTagIds.includes(t.tagId)) &&
          t.name.toLocaleLowerCase().includes(query),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }
  private get canCreate() {
    return (
      this.allowCreate && !!this.query.trim() && !app.tags.some((t) => t.name === this.query.trim())
    );
  }
  private emit(selected: string[]) {
    this.selected = selected;
    this.dispatchEvent(
      new CustomEvent("tag-change", {
        detail: selected,
        bubbles: true,
        composed: true,
      }),
    );
  }
  private pick(tag: Tag) {
    if (this.disabled || app.busy) return;
    if (this.multiple && this.selected.length >= 50) {
      this.error = "タグは50個までです。";
      return;
    }
    this.emit(this.multiple ? [...new Set([...this.selected, tag.tagId])] : [tag.tagId]);
    this.query = "";
    this.renderRoot.querySelector("input")?.focus();
    this.open = false;
    this.active = -1;
    this.error = "";
  }
  private async create() {
    if (this.disabled || app.busy) return;
    try {
      const name = tagName(this.query);
      if (this.multiple && this.selected.length >= 50) throw new Error("タグは50個までです。");
      const tag = await app.run(() => app.createTag(name));
      if (tag) this.pick(tag);
      else this.error = app.error;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }
  private keydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    const count = this.candidates.length + Number(this.canCreate);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      this.open = true;
      this.active = count
        ? this.active < 0
          ? e.key === "ArrowDown"
            ? 0
            : count - 1
          : (this.active + (e.key === "ArrowDown" ? 1 : count - 1)) % count
        : -1;
      void this.updateComplete.then(() =>
        this.renderRoot
          .querySelector(`#option-${this.active}`)
          ?.scrollIntoView({ block: "nearest" }),
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const exact = this.candidates.find((t) => t.name === this.query.trim());
      const tag = this.active >= 0 ? this.candidates[this.active] : exact;
      if (tag) this.pick(tag);
      else if (this.canCreate) void this.create();
    } else if (e.key === "Escape" && this.open) {
      e.stopPropagation();
      this.open = false;
      this.query = "";
      this.active = -1;
    }
  }
  render() {
    const candidates = this.candidates;
    const expanded = this.open && !this.disabled && !app.busy;
    const value =
      this.open || this.multiple
        ? this.query
        : app.tags.find((t) => t.tagId === this.selected[0])?.name || "";
    return html`
      ${
        this.multiple
          ? html`<div class="chips">
              ${this.selected.map(
                (id) =>
                  html`<span class="tag">
                    ${app.tags.find((t) => t.tagId === id)?.name || id}
                    ${
                      automaticTagIds.includes(id)
                        ? html`<span title="ファイル形式から自動設定">（自動）</span>`
                        : html`<button
                            class="quiet"
                            aria-label=${`${app.tags.find((t) => t.tagId === id)?.name || id} を削除`}
                            ?disabled=${this.disabled || app.busy}
                            @click=${() => this.emit(this.selected.filter((t) => t !== id))}
                          >
                            ×
                          </button>`
                    }
                  </span>`,
              )}
            </div>`
          : nothing
      }
      <div
        class="field"
        @focusout=${(e: FocusEvent) => {
          if (!(e.relatedTarget instanceof Node) || !this.renderRoot.contains(e.relatedTarget)) {
            this.open = false;
            this.query = "";
            this.active = -1;
          }
        }}
      >
        <div class="input-row">
          <input
            role="combobox"
            aria-label=${this.label}
            aria-autocomplete="list"
            aria-expanded=${expanded}
            aria-controls="options"
            aria-activedescendant=${expanded && this.active >= 0 ? `option-${this.active}` : nothing}
            aria-describedby=${this.multiple ? "hint" : nothing}
            placeholder=${this.multiple ? "タグを選択、または新しいタグ名を入力" : "すべてのタグ"}
            .value=${value}
            ?disabled=${this.disabled || app.busy}
            @focus=${() => {
              this.open = true;
              this.active = -1;
            }}
            @click=${() => {
              this.open = true;
            }}
            @input=${(e: Event) => {
              this.query = (e.target as HTMLInputElement).value;
              this.open = true;
              this.active = -1;
              this.error = "";
            }}
            @keydown=${this.keydown}
          />
          ${
            !this.multiple && this.selected.length
              ? html`<button
                  class="quiet small"
                  aria-label=${`${this.label}を解除`}
                  ?disabled=${this.disabled || app.busy}
                  @click=${() => {
                    this.emit([]);
                    this.query = "";
                    this.open = false;
                  }}
                >
                  ×
                </button>`
              : nothing
          }
        </div>
        ${
          expanded
            ? html`<div
                class="options"
                id="options"
                role="listbox"
                aria-label=${`${this.label}の候補`}
              >
                ${candidates.map(
                  (t, i) =>
                    html`<div
                      class=${`option ${this.active === i ? "active" : ""}`}
                      id=${`option-${i}`}
                      role="option"
                      aria-selected=${this.active === i}
                      @mousedown=${(e: Event) => e.preventDefault()}
                      @click=${() => this.pick(t)}
                    >
                      ${t.name}
                    </div>`,
                )}
                ${
                  this.canCreate
                    ? html`<div
                        class=${`option ${this.active === candidates.length ? "active" : ""}`}
                        id=${`option-${candidates.length}`}
                        role="option"
                        aria-selected=${this.active === candidates.length}
                        @mousedown=${(e: Event) => e.preventDefault()}
                        @click=${() => this.create()}
                      >
                        「${this.query.trim()}」を作成して追加
                      </div>`
                    : nothing
                }
                ${!candidates.length && !this.canCreate ? html`<p class="option muted">候補がありません</p>` : nothing}
              </div>`
            : nothing
        }
      </div>
      ${this.multiple ? html`<p class="hint muted" id="hint">候補を選ぶか、タグ名を入力して Enter で追加。最大50個。形式タグは自動設定されます。</p>` : nothing}
      ${this.error ? html`<p class="hint" role="alert">${this.error}</p>` : nothing}
    `;
  }
}
customElements.define("tag-combobox", TagCombobox);
