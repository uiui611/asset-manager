import { app } from "./asset-service";
/** Editing history stays in the mounted editor; only explicit saves reach storage. */
export const fingerprint = (value: object) =>
  JSON.stringify(value, (key, v) =>
    key === "updatedAt" || key === "previewImage" ? undefined : v,
  );

export const editing = { dirty: () => false, locked: () => false };
const unfinished = () => app.hasUnfinishedOperations || editing.locked();
const beforeUnload = (event: BeforeUnloadEvent) => {
  if (editing.dirty() || unfinished()) {
    event.preventDefault();
    event.returnValue = "";
  }
};
let warning = false;
export function updateLeaveGuard() {
  const needed = editing.dirty() || unfinished();
  if (needed === warning) return;
  warning = needed;
  if (needed) window.addEventListener("beforeunload", beforeUnload);
  else window.removeEventListener("beforeunload", beforeUnload);
}
app.addEventListener("change", updateLeaveGuard);
window.addEventListener("pagehide", () => app.discardUnfinished());
window.addEventListener("pageshow", (event) => {
  // A cached page must not resume promises or queued writes from its previous visit.
  if (event.persisted) app.discardUnfinished();
  updateLeaveGuard();
});

let pending: Promise<string | null> | undefined;
function dialog(name?: string, localDownload = false): Promise<string | null> {
  if (pending) return pending;
  const operations = name === undefined && unfinished();
  const element = document.createElement("dialog");
  element.setAttribute(
    "aria-label",
    name === undefined
      ? operations
        ? "未完了の操作"
        : "未保存の変更"
      : localDownload
        ? "エクスポート名を入力"
        : "保存名を入力",
  );
  element.style.cssText =
    "border:1px solid #d5dfcd;border-radius:14px;padding:28px;max-width:440px;width:calc(100% - 48px);color:#304b35;background:#fcfefa;font:14px system-ui";
  const heading = document.createElement("h2");
  heading.textContent =
    name === undefined
      ? operations
        ? "未完了の操作があります"
        : "未保存の変更があります"
      : localDownload
        ? "エクスポート名を入力"
        : "保存名を入力";
  const message = document.createElement("p");
  message.textContent =
    name === undefined
      ? operations
        ? `移動すると未送信分と再試行待ちの内容を破棄します。送信済みの要求は保存される場合があります。${editing.dirty() ? "未保存の編集も破棄します。" : ""}処理を続けるにはこの画面に留まってください。`
        : "変更を破棄して移動しますか？ 編集を続けるにはキャンセルしてください。"
      : localDownload
        ? "端末にダウンロードするファイル名を入力してください。"
        : "素材ライブラリに保存する名前を入力してください。";
  const form = document.createElement("form");
  const input = document.createElement("input");
  input.setAttribute("aria-label", "保存名");
  input.value = name ?? "";
  input.required = true;
  input.maxLength = 100;
  input.style.cssText =
    "box-sizing:border-box;width:100%;padding:12px;margin:10px 0;border:1px solid #acbea0;border-radius:6px";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = operations ? "この画面に留まる" : "キャンセル";
  const ok = document.createElement("button");
  ok.type = "submit";
  ok.textContent =
    name === undefined
      ? operations
        ? "未送信分を取り消して移動"
        : "変更を破棄"
      : localDownload
        ? "ダウンロード"
        : "保存";
  for (const button of [cancel, ok])
    button.style.cssText =
      "padding:10px 18px;margin:8px 8px 0 0;border:1px solid #acbea0;border-radius:7px;background:#edf3e4;color:#304b35;cursor:pointer";
  if (name !== undefined) form.append(input);
  form.append(cancel, ok);
  element.append(heading, message, form);
  document.body.append(element);
  pending = new Promise<string | null>((resolve) => {
    const finish = (value: string | null) => {
      element.close();
      element.remove();
      pending = undefined;
      resolve(value);
    };
    cancel.onclick = () => finish(null);
    element.oncancel = (event) => {
      event.preventDefault();
      finish(null);
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      if (name === undefined) return finish("discard");
      const value = input.value.trim().replace(/\.json$/i, "");
      if (!value || /[\\/\r\n]/.test(value)) {
        input.setCustomValidity("名前を入力してください（スラッシュは使えません）。");
        input.reportValidity();
        return;
      }
      finish(value);
    };
    input.oninput = () => input.setCustomValidity("");
    element.showModal();
    (name === undefined ? cancel : input).focus();
  });
  return pending;
}
export const askName = (name = "", localDownload = false) => dialog(name, localDownload);
export async function confirmDiscard() {
  // A name dialog belongs to the current editor and must settle before SPA navigation.
  if (pending) return false;
  if (!editing.dirty() && !unfinished()) return true;
  if ((await dialog()) !== "discard") return false;
  app.discardUnfinished();
  return true;
}
