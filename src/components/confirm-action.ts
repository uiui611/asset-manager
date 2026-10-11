export function confirmAction(title: string, message: string, action: string): Promise<boolean> {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", title);
  dialog.style.cssText =
    "border:1px solid #d5dfcd;border-radius:14px;padding:28px;max-width:480px;width:calc(100% - 48px);background:#fcfefa;color:#304b35;font:14px system-ui";
  const heading = document.createElement("h2"),
    text = document.createElement("p"),
    cancel = document.createElement("button"),
    submit = document.createElement("button");
  heading.textContent = title;
  text.textContent = message;
  text.style.whiteSpace = "pre-line";
  cancel.textContent = "キャンセル";
  submit.textContent = action;
  for (const button of [cancel, submit])
    button.style.cssText =
      "padding:10px 16px;margin:8px 8px 0 0;border:1px solid #acbea0;border-radius:7px;background:#edf3e4;color:#304b35;cursor:pointer";
  dialog.append(heading, text, cancel, submit);
  document.body.append(dialog);
  return new Promise((resolve) => {
    const finish = (accepted: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(accepted);
    };
    cancel.onclick = () => finish(false);
    submit.onclick = () => finish(true);
    dialog.oncancel = (e) => {
      e.preventDefault();
      finish(false);
    };
    dialog.showModal();
    cancel.focus();
  });
}
