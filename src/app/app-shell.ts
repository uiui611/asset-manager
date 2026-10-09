import "../components/operation-progress";
import { css, html, LitElement } from "lit";
import { app, storage } from "../application/asset-service";
import { confirmDiscard } from "../application/edit-session";
import { icon } from "../components/icon";
import { shared } from "../components/styles";
import { isLibraryFile } from "../domain/library";
import { currentPage, navigate, type Page } from "./router";

const nav = [
  ["assets", "grid", "素材ライブラリ"],
  ["maps", "map", "マップエディター"],
  ["characters", "character", "キャラクター合成"],
  ["sounds", "sound", "音楽・効果音"],
  ["sprites", "play", "スプライトシート再生"],
] as const;
export class AssetApp extends LitElement {
  static properties = {
    page: { state: true },
    ready: { state: true },
    loadError: { state: true },
  };
  static styles = [
    shared,
    css`
      :host {
        min-height: 100vh;
        background: #f7f9f4;
        display: block;
      }
      .layout {
        display: grid;
        grid-template-columns: 232px minmax(0, 1fr);
        min-height: 100vh;
      }
      .sidebar {
        background: #fdfefa;
        border-right: 1px solid #e1e7dc;
        padding: 31px 19px;
        display: flex;
        flex-direction: column;
        position: sticky;
        top: 0;
        height: 100vh;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 9px 36px;
        font-size: 18px;
        font-weight: 680;
        letter-spacing: -0.6px;
      }
      .brand-mark {
        width: 35px;
        height: 35px;
        background: #294e3b;
        color: #d8e9c0;
        border-radius: 10px;
        display: grid;
        place-items: center;
        transform: rotate(-4deg);
      }
      .brand small {
        display: block;
        font-size: 8px;
        letter-spacing: 2.5px;
        color: #8a9988;
        font-weight: 500;
        margin-top: 0;
      }
      .nav-label {
        font-size: 9px;
        letter-spacing: 1.8px;
        color: #9aa595;
        margin: 13px 12px;
      }
      nav {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      nav button {
        justify-content: flex-start;
        border: 0;
        background: transparent;
        font-size: 12px;
        padding: 12px 13px;
        color: #7b887a;
        gap: 12px;
      }
      nav button.active {
        background: #e8efdf;
        color: #3b603b;
        font-weight: 650;
      }
      .count {
        margin-left: auto;
        font-size: 10px;
        padding: 1px 7px;
        background: #dae5d1;
        border-radius: 4px;
      }
      .side-bottom {
        margin-top: auto;
      }
      .storage-box {
        padding: 16px 12px;
        background: #f1f5eb;
        border: 1px solid #e5eddd;
        border-radius: 9px;
        margin-top: 18px;
      }
      .storage-box p {
        font-size: 10px;
        line-height: 1.8;
        color: #809178;
        margin: 8px 0 11px;
      }
      .storage-box button {
        width: 100%;
        font-size: 10px;
        padding: 7px;
      }
      .topbar {
        height: 75px;
        background: #fdfefa;
        border-bottom: 1px solid #e3e8df;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 37px;
        font-size: 11px;
        color: #8b9686;
      }
      .crumb {
        display: flex;
        gap: 11px;
        align-items: center;
      }
      .online {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #81a377;
        display: inline-block;
      }
      .avatar {
        width: 29px;
        height: 29px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: #e5ebdb;
        color: #688154;
        font-family: Georgia, serif;
        font-size: 14px;
      }
      .content {
        padding: 33px 38px;
        max-width: 1700px;
        margin: 0 auto;
      }
      .statusbar {
        position: sticky;
        top: 0;
        z-index: 10;
        padding: 10px 37px;
        display: flex;
        gap: 20px;
        align-items: center;
        font-size: 12px;
        background: #e7efdf;
        border-bottom: 1px solid #d5e3c9;
      }
      .errorbar {
        background: #fff0eb;
        color: #9e5142;
      }
      .statusbar span {
        flex: 1;
      }
      .intro {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 28px;
        border: 1px solid #dbe6d1;
        border-radius: 12px;
        padding: 21px 25px;
        background: linear-gradient(110deg, #edf3e3, #f4f7ed);
      }
      .intro h3 {
        font-size: 14px;
        margin-bottom: 5px;
      }
      .intro p {
        font-size: 11px;
        color: #809273;
      }
      .intro .art {
        color: #9bae84;
        margin-left: 20px;
      }
      .footer {
        margin: 32px 0 0;
        padding-top: 15px;
        border-top: 1px solid #e6ebe1;
        display: flex;
        justify-content: space-between;
        font-size: 9px;
        letter-spacing: 0.6px;
        color: #9da796;
      }
      @media (max-width: 1000px) {
        .layout {
          grid-template-columns: 195px minmax(0, 1fr);
        }
        .sidebar {
          padding: 25px 12px;
        }
        .content {
          padding: 25px 22px;
        }
        .topbar {
          padding: 0 22px;
        }
        .brand {
          font-size: 15px;
        }
      }
      @media (max-width: 760px) {
        .layout {
          display: block;
        }
        .sidebar {
          height: auto;
          position: static;
          padding: 15px;
          border-right: 0;
          border-bottom: 1px solid #e1e7dc;
        }
        .brand {
          padding: 0 0 13px;
        }
        .nav-label,
        .side-bottom {
          display: none;
        }
        nav {
          flex-direction: row;
          overflow: auto;
        }
        nav button {
          white-space: nowrap;
          padding: 8px;
          font-size: 11px;
          gap: 5px;
        }
        .count {
          display: none;
        }
        .topbar {
          height: 52px;
          padding: 0 16px;
        }
        .content {
          padding: 22px 16px;
        }
        .intro {
          padding: 16px;
        }
        .intro .art {
          display: none;
        }
        .footer {
          font-size: 8px;
        }
      }
    `,
  ];
  page: Page = currentPage();
  ready = false;
  loadError = "";
  private pageLoadId = 0;
  private change = () => this.requestUpdate();
  private routeHash = location.hash;
  private routing = false;
  private route = async () => {
    const target = location.hash;
    if (target === this.routeHash || this.routing) return;
    this.routing = true;
    history.replaceState(null, "", this.routeHash || "#assets");
    if (await confirmDiscard()) {
      history.replaceState(null, "", target);
      this.routeHash = target;
      this.page = currentPage();
      await this.loadPage();
    }
    this.routing = false;
  };
  connectedCallback() {
    super.connectedCallback();
    app.addEventListener("change", this.change);
    window.addEventListener("popstate", this.route);
    window.addEventListener("hashchange", this.route);
    void app.init().catch((e) => {
      app.error = String(e);
      app.changed();
    });
    void this.loadPage();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    app.removeEventListener("change", this.change);
    window.removeEventListener("popstate", this.route);
    window.removeEventListener("hashchange", this.route);
  }
  private async loadPage() {
    const loadId = ++this.pageLoadId;
    const page = this.page;
    this.ready = false;
    this.loadError = "";
    try {
      if (page === "assets") await import("../pages/assets/assets-page");
      if (page === "maps" || page === "characters") await import("../pages/editor/editor-page");
      if (page === "sprites") await import("../pages/sprites/sprites-page");
      if (page === "sounds") await import("../pages/sounds/sounds-page");
      if (page === "settings") await import("../pages/settings/settings-page");
      if (loadId === this.pageLoadId) this.ready = true;
    } catch {
      if (loadId === this.pageLoadId)
        this.loadError =
          "画面を読み込めませんでした。接続を確認し、画面を再読み込みしてください。サーバーに保存した素材は保持されます。";
    }
  }
  render() {
    return html`
      <div class="layout">
        <aside class="sidebar">
          <div class="brand">
            <span class="brand-mark">${icon("layers", 23)}</span>
            <div>Asset Atelier<small>YOUR GAME, PIECE BY PIECE</small></div>
          </div>
          <div class="nav-label">WORKSPACE</div>
          <nav>
            ${nav.map(
              ([id, i, label]) => html`
                <button
                  class=${this.page === id ? "active" : ""}
                  @click=${() => navigate(id)}
                  aria-current=${this.page === id ? "page" : "false"}
                >
                  ${icon(i)}${label}${
                    id === "assets"
                      ? html` <span class="count">${app.files.filter(isLibraryFile).length}</span> `
                      : ""
                  }
                </button>
              `,
            )}
          </nav>
          <div class="side-bottom">
            <div class="nav-label">MANAGE</div>
            <nav>
              <button
                class=${this.page === "settings" ? "active" : ""}
                @click=${() => navigate("settings")}
              >
                ${icon("settings")}設定・データ管理
              </button>
            </nav>
            <div class="storage-box">
              <div class="row" style="gap:8px;font-size:11px;font-weight:600">
                ${icon("cloud", 16)}ストレージ<span
                  class="online"
                  style=${storage.connected ? "" : "background:#b6bdb0"}
                >
                </span>
              </div>
              <p>
                ${storage.connected ? "素材はあなたのストレージへ。変更を同期して、制作の続きを。" : "プライベートストレージを、ゲームづくりの素材ライブラリに。"}
              </p>
              <button
                ?disabled=${app.busy}
                @click=${() => (storage.connected ? app.sync() : app.connect())}
              >
                ${icon(storage.connected ? "refresh" : "arrow", 13)}${storage.connected ? "一覧を更新" : "ストレージに接続"}
              </button>
            </div>
          </div>
        </aside>
        <div>
          <header class="topbar">
            <div class="crumb">
              ワークスペース <span>/</span>
              <span style="color:#455640"
                >${nav.find((n) => n[0] === this.page)?.[2] || "設定・データ管理"}</span
              >
            </div>
            <div class="row">
              <span class="online" style=${storage.connected ? "" : "background:#b6bdb0"}> </span
              >${storage.connected ? "ストレージ接続済み" : "ストレージ未接続"}<button
                class="avatar quiet"
                aria-label="設定を開く"
                @click=${() => navigate("settings")}
              >
                A
              </button>
            </div>
          </header>
          ${
            app.uploads
              ? html`
                  <div class="statusbar" role="status">
                    <span
                      >素材を登録中 · ${app.uploadTotal - app.uploads} / ${app.uploadTotal}
                      件完了（ほかの操作を続けられます）</span
                    >
                  </div>
                `
              : ""
          }${
            app.busy
              ? html`
                  <div class="statusbar" role="status">
                    <span>${app.status || "処理中…"}</span>
                    <button class="small quiet" @click=${() => app.cancel()}>中断</button>
                  </div>
                `
              : ""
          }${
            app.error
              ? html`
                  <div class="statusbar errorbar" role="alert">
                    <span>${app.error}</span>
                    <button
                      class="quiet small"
                      aria-label="エラーを閉じる"
                      @click=${() => {
                        app.error = "";
                        app.changed();
                      }}
                    >
                      ${icon("close", 14)}
                    </button>
                  </div>
                `
              : ""
          }
          <main class="content">
            <operation-progress> </operation-progress>${
              this.ready
                ? this.page === "assets"
                  ? html` <assets-page> </assets-page> `
                  : this.page === "maps"
                    ? html` <editor-page kind="map"> </editor-page> `
                    : this.page === "characters"
                      ? html` <editor-page kind="character"> </editor-page> `
                      : this.page === "sounds"
                        ? html` <sounds-page> </sounds-page> `
                        : this.page === "sprites"
                          ? html` <sprites-page> </sprites-page> `
                          : html` <settings-page> </settings-page> `
                : this.loadError
                  ? html`
                      <section class="panel stack" role="alert">
                        <h2>画面の読み込みに失敗しました</h2>
                        <p>${this.loadError}</p>
                        <button class="primary" @click=${() => location.reload()}>
                          画面を再読み込み
                        </button>
                      </section>
                    `
                  : html` <p role="status">読み込み中…</p> `
            }
            <div class="footer">
              <span>ASSET ATELIER · A LITTLE SPACE FOR BIG IDEAS</span>
              <span>PRIVATE WORKSPACE / v0.1</span>
            </div>
          </main>
        </div>
      </div>
    `;
  }
}
customElements.define("asset-app", AssetApp);
