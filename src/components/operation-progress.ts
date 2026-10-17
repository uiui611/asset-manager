import { css, html, LitElement, nothing } from "lit";
import { app, storage } from "../application/asset-service";
import type { Operation, OperationItem } from "../domain/models";
import { shared } from "./styles";

const labels: Record<string, string> = {
  upload: "素材の登録",
  "tile-split": "タイル分割",
  "bulk-tag": "タグ・メタデータ更新",
  "bulk-trash": "削除",
  "content-update": "保存",
};
const statuses = {
  pending: "未実行",
  running: "実行中",
  failed: "失敗",
  unknown: "結果不明",
  completed: "完了",
  cancelled: "取消済み",
};
export class OperationProgress extends LitElement {
  static styles = [
    shared,
    css`
      :host {
        display: block;
      }
      article {
        margin-bottom: 12px;
        padding: 12px;
        border: 1px solid #dce6d6;
        border-radius: 8px;
        background: #f7faf4;
        font-size: 12px;
      }
      .line,
      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .actions {
        justify-content: flex-start;
        margin-top: 10px;
      }
      .error {
        color: #9e5142;
        overflow-wrap: anywhere;
      }
      p {
        margin: 8px 0;
      }
      summary {
        cursor: pointer;
      }
      ul {
        max-height: 180px;
        overflow: auto;
        padding-left: 20px;
      }
      li {
        margin: 5px 0;
        overflow-wrap: anywhere;
      }
      progress {
        width: 100%;
        height: 9px;
        accent-color: #668752;
      }
    `,
  ];
  private working = new Set<string>();
  private change = () => this.requestUpdate();
  connectedCallback() {
    super.connectedCallback();
    app.addEventListener("change", this.change);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    app.removeEventListener("change", this.change);
  }
  private async invoke(operation: Operation, action: () => Promise<unknown>) {
    if (this.working.has(operation.id)) return;
    this.working.add(operation.id);
    this.requestUpdate();
    try {
      await app.run(action);
    } finally {
      this.working.delete(operation.id);
      this.requestUpdate();
    }
  }
  private itemStatus(operation: Operation, item: OperationItem) {
    return item.status || (operation.completedItems.includes(item.id) ? "completed" : "pending");
  }
  private operation(operation: Operation) {
    const label = labels[operation.type] || "保存";
    const disabled = app.busy || this.working.has(operation.id);
    const running = operation.status === "running";
    const completed = operation.status === "completed";
    const resultRequired =
      operation.resultCheckRequired &&
      (operation.status === "unknown" ||
        operation.items.some((item) => item.resultCheck === "mismatch"));
    const counts = { pending: 0, running: 0, failed: 0, unknown: 0, completed: 0, cancelled: 0 };
    for (const item of operation.items) counts[this.itemStatus(operation, item)]++;
    const retryableFailures = operation.items.filter(
      (item) => item.status === "failed" && item.retryable,
    ).length;
    const retryCount = counts.pending + retryableFailures;
    const total = operation.items.length;
    return html`<article aria-label=${`${label}の操作結果`}>
      <div class="line" role="status">
        <strong>${label} · ${statuses[operation.status]}</strong>
        <span>${operation.completedItems.length} / ${total} 件完了</span>
      </div>
      ${running ? html`<progress aria-label=${`${label}の進捗`} max=${total || 1} value=${operation.completedItems.length}></progress>` : nothing}
      <p>
        ${counts.failed ? html`失敗 ${counts.failed} 件 · ` : nothing}
        ${counts.unknown ? html`結果不明 ${counts.unknown} 件 · ` : nothing} 未実行
        ${counts.pending} 件
      </p>
      ${operation.error ? html`<p class="error">${operation.error}</p>` : nothing}
      ${operation.status === "unknown" ? html`<p>保存結果を確認できません。結果を確認してから、必要な操作を選んでください。</p>` : nothing}
      ${!running && !completed && !operation.canRetry && operation.status !== "unknown" ? html`<p>内容や最新版を確認し、修正してから操作し直してください。</p>` : nothing}
      <details>
        <summary>対象と結果（${total} 件）</summary>
        <ul>
          ${operation.items.map((item) => html`<li>${item.name} · ${statuses[this.itemStatus(operation, item)]}${item.error ? html`<span class="error"> · ${item.error}</span>` : nothing}</li>`)}
        </ul>
      </details>
      <div class="actions">
        ${!running && operation.status === "unknown" ? html`<button class="small" ?disabled=${disabled || !storage.connected} @click=${() => this.invoke(operation, () => app.checkOperation(operation.id))}>結果を確認</button>` : nothing}
        ${!running && !completed && operation.canRetry ? html`<button class="small" ?disabled=${disabled || !storage.connected} @click=${() => this.invoke(operation, () => app.retryOperation(operation.id))}>${retryableFailures ? "再試行" : "未実行分を送信"}（${retryCount} 件）</button>` : nothing}
        ${!running && !resultRequired ? html`<button class="small quiet" ?disabled=${disabled} @click=${() => app.discardOperation(operation.id)}>${completed ? "確認" : "破棄"}</button>` : nothing}
      </div>
      ${resultRequired ? html`<p>この編集を続けるには上書き結果の確認が必要です。確認できないまま離れる場合は、編集と未送信分を破棄して移動してください。</p>` : nothing}
      ${!running && !completed ? html`<p>自動再試行は行いません。ページを閉じると未送信分は残りません。</p>` : nothing}
    </article>`;
  }
  render() {
    return html`${app.operations.filter((operation) => operation.status !== "cancelled").map((operation) => this.operation(operation))}`;
  }
}
customElements.define("operation-progress", OperationProgress);
