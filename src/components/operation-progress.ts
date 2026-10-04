import { css, html, LitElement } from "lit";
import { app } from "../application/asset-service";
export class OperationProgress extends LitElement {
  static styles =
    css`:host{display:block}.progress{padding:8px 0;font:12px system-ui;color:#36513c}.line{display:flex;justify-content:space-between;gap:12px}progress{width:100%;height:9px;accent-color:#668752}`;
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
    return html`${app.transfers.map((p) => html`<div class="progress" role="status"><div class="line"><span>${p.label}中</span><span>${p.done} / ${p.total} 件 · ${p.total ? Math.round((p.done / p.total) * 100) : 100}%</span></div><progress aria-label=${`${p.label}の進捗`} max=${p.total || 1} value=${p.done}></progress></div>`)}`;
  }
}
customElements.define("operation-progress", OperationProgress);
