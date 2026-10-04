import { h, style } from "../../core/dom";

const CSS = `
.gm-dialog { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); padding: 18px; max-width: min(92vw, 380px); margin: auto; }
.gm-dialog::backdrop { background: rgba(0, 0, 0, 0.55); }
.gm-dialog p { margin-bottom: 14px; line-height: 1.45; }
.gm-dialog .row { flex-direction: row; justify-content: flex-end; gap: 8px; }
`;

/** Modal yes/no. Resolves false on cancel, Escape or backdrop click. */
export function confirmDialog(message: string, ok = "ok", danger = false): Promise<boolean> {
  style("dialog", CSS);
  return new Promise((resolve) => {
    const okBtn = h("button", { class: danger ? "danger" : "primary", value: "ok" }, ok);
    const dlg = h("dialog", { class: "gm-dialog" },
      h("form", { method: "dialog" },
        h("p", null, message),
        h("div", { class: "row" }, h("button", { value: "cancel" }, "cancel"), okBtn)));
    dlg.addEventListener("close", () => {
      resolve(dlg.returnValue === "ok");
      dlg.remove();
    });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close("cancel");
    });
    document.body.append(dlg);
    dlg.showModal();
    okBtn.focus();
  });
}
