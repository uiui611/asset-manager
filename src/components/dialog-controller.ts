import type { ReactiveController, ReactiveControllerHost } from "lit";
export class DialogController implements ReactiveController {
  private dialog: HTMLElement | null = null;
  private previous: HTMLElement | null = null;
  constructor(
    private host: ReactiveControllerHost & {
      renderRoot: HTMLElement | DocumentFragment;
    },
  ) {
    host.addController(this);
  }
  private keydown = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || !this.dialog) return;
    const items = this.focusable();
    if (!items.length) {
      event.preventDefault();
      return;
    }
    let active =
      this.host.renderRoot instanceof ShadowRoot
        ? this.host.renderRoot.activeElement
        : document.activeElement;
    while (active?.shadowRoot?.activeElement)
      active = active.shadowRoot.activeElement;
    const index = items.indexOf(active as HTMLElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (!event.shiftKey && (index === items.length - 1 || index < 0)) {
      event.preventDefault();
      items[0].focus();
    }
  };
  private focusable() {
    const items: HTMLElement[] = [];
    const visit = (root: Element | ShadowRoot) => {
      for (const child of root.children) {
        if (child instanceof HTMLElement) {
          if (child.matches("[inert],[disabled]")) continue;
          if (
            child.matches("button,input,select,textarea,a[href]") &&
            child.getClientRects().length
          )
            items.push(child);
          if (child.shadowRoot) visit(child.shadowRoot);
          visit(child);
        }
      }
    };
    if (this.dialog) visit(this.dialog);
    return items;
  }
  hostConnected() {
    document.addEventListener("keydown", this.keydown, true);
  }
  hostDisconnected() {
    document.removeEventListener("keydown", this.keydown, true);
  }
  hostUpdated() {
    const dialog =
      this.host.renderRoot.querySelector<HTMLElement>("[role=dialog]");
    if (dialog !== this.dialog) {
      if (dialog) {
        this.previous = (
          this.host.renderRoot instanceof ShadowRoot
            ? this.host.renderRoot.activeElement
            : document.activeElement
        ) as HTMLElement;
        this.dialog = dialog;
        this.focusable()[0]?.focus();
      } else {
        this.dialog = null;
        this.previous?.focus();
      }
    }
  }
}
