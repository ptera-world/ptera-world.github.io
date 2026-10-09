import { h, style } from "../../core/dom";
import type { CommandDef } from "../../core/types";

/**
 * Ways to show a set of commands. Every board-menu entry point (right-click, touch hold, the
 * board actions widget) renders through one of these, so a command appears the same everywhere.
 */
export type SurfaceStyle = "list" | "radial" | "tiles";

export interface SurfaceItem {
  cmd: CommandDef;
  enabled: boolean;
  keys: string[];
}

const CSS = `
.sf-backdrop { position: fixed; inset: 0; z-index: 900; }
.sf-radial { position: fixed; z-index: 901; width: 0; height: 0; }
.sf-radial .ring { position: absolute; left: -110px; top: -110px; width: 220px; height: 220px; border-radius: 50%; background: color-mix(in srgb, var(--surface) 88%, transparent); box-shadow: 0 12px 36px rgba(0,0,0,.4); border: 1px solid var(--border); animation: sf-in 140ms ease-out; }
.sf-radial .slice { position: absolute; transform: translate(-50%, -50%); max-width: 88px; padding: 5px 8px; border-radius: 8px; font-size: 12px; line-height: 1.2; text-align: center; background: var(--surface-2); border: 1px solid var(--border); }
.sf-radial .slice.on { background: var(--accent-soft); border-color: var(--accent); }
.sf-radial .slice.danger { color: var(--danger); }
.sf-radial .slice:disabled { opacity: .4; }
.sf-radial .hub { position: absolute; left: -16px; top: -16px; width: 32px; height: 32px; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--border); }
.sf-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 6px; }
.sf-tiles button { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 7px 9px; text-align: left; font-size: 13px; min-height: 44px; }
.sf-tiles button .k { font: 11px var(--mono); color: var(--text-dim); }
.sf-tiles button.danger { color: var(--danger); }
.sf-tiles button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); }
.sf-pop { position: fixed; z-index: 901; width: min(340px, calc(100vw - 16px)); max-height: 70vh; overflow: auto; padding: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 12px 36px rgba(0,0,0,.4); animation: sf-in 120ms ease-out; }
@keyframes sf-in { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .sf-radial .ring, .sf-pop { animation: none; } }
`;

const isDanger = (c: CommandDef): boolean => (typeof c.danger === "function" ? c.danger() : !!c.danger);

/** Tiles: every command as a labelled button with its keys. Used inline (widget) and as a popup. */
export function tiles(items: readonly SurfaceItem[], run: (id: string) => void): HTMLElement {
  style("surfaces", CSS);
  return h("div", { class: "sf-tiles", role: "menu" }, items.map((it) => h("button", {
    role: "menuitem", "data-command": it.cmd.id, disabled: !it.enabled,
    class: isDanger(it.cmd) ? "danger" : undefined,
    "aria-pressed": it.cmd.checked ? String(it.cmd.checked()) : undefined,
    onclick: () => run(it.cmd.id),
  }, h("span", null, it.cmd.label), it.keys.length ? h("span", { class: "k" }, it.keys[0]) : null)));
}

/** Closers of every open surface and dialog; each closes as if dismissed and removes itself. */
export const openOverlays = new Set<() => void>();

/** Open a floating surface at a point. Resolves when it closes (picked or dismissed). */
export function popup(kind: "radial" | "tiles", x: number, y: number, items: readonly SurfaceItem[], run: (id: string) => void): Promise<void> {
  style("surfaces", CSS);
  return new Promise((resolve) => {
    const back = h("div", { class: "sf-backdrop" });
    let panel: HTMLElement;
    const close = () => { openOverlays.delete(close); back.remove(); panel.remove(); document.removeEventListener("keydown", onKey, true); resolve(); };
    openOverlays.add(close);
    const pick = (id: string) => { close(); run(id); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    if (kind === "tiles") {
      panel = h("div", { class: "sf-pop" }, tiles(items, pick));
      document.body.append(back, panel);
      const r = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, x))}px`;
      panel.style.top = `${Math.max(8, Math.min(innerHeight - r.height - 8, y))}px`;
    } else {
      // eight slices at most; past that the last one opens everything as tiles
      const more = items.length > 8;
      const shown = more ? items.slice(0, 7) : items.slice(0, 8);
      const slices = shown.length + (more ? 1 : 0);
      const cx = Math.max(118, Math.min(innerWidth - 118, x)), cy = Math.max(118, Math.min(innerHeight - 118, y));
      panel = h("div", { class: "sf-radial", role: "menu", style: `left:${cx}px;top:${cy}px` },
        h("div", { class: "ring" }), h("div", { class: "hub", "aria-hidden": "true" }),
        more ? (() => {
          const a = -Math.PI / 2 + (7 / slices) * Math.PI * 2;
          return h("button", { class: "slice", role: "menuitem", style: `left:${Math.cos(a) * 76}px;top:${Math.sin(a) * 76}px`, onclick: () => { close(); void popup("tiles", x, y, items, run); } }, "more…");
        })() : null,
        shown.map((it, i) => {
          const a = -Math.PI / 2 + (i / slices) * Math.PI * 2;
          return h("button", {
            class: ["slice", isDanger(it.cmd) ? "danger" : "", it.cmd.checked?.() ? "on" : ""].join(" "),
            role: "menuitem", "data-command": it.cmd.id, disabled: !it.enabled,
            style: `left:${Math.cos(a) * 76}px;top:${Math.sin(a) * 76}px`,
            onclick: () => pick(it.cmd.id),
          }, it.cmd.label);
        }));
      document.body.append(back, panel);
    }
    back.addEventListener("pointerdown", (e) => { e.preventDefault(); close(); });
    back.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("keydown", onKey, true);
    (panel.querySelector("button:not(:disabled)") as HTMLElement | null)?.focus();
  });
}
