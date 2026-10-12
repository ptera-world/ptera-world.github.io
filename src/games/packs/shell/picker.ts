import { h, style } from "../../core/dom";
import { openOverlays } from "./surfaces";

export interface PickerItem {
  id: string;
  label: string;
  /** Swatch color (a technique's own); marks leave it out. */
  color?: string;
  on: boolean;
  pick(): void;
}

export interface Picker {
  /** The trigger came up: picks what the pointer moved toward, else the picker stays open for a click or a number. */
  release(): void;
  close(): void;
}

const CSS = `
.pk-backdrop { position: fixed; inset: 0; z-index: 900; }
.pk-ring { position: fixed; z-index: 901; width: 0; height: 0; }
.pk-ring .pk-disc { position: absolute; border-radius: 50%; background: color-mix(in srgb, var(--surface) 90%, transparent); border: 1px solid var(--border); box-shadow: 0 12px 36px rgba(0,0,0,.4); }
.pk-ring .pk-hub { position: absolute; left: -10px; top: -10px; width: 20px; height: 20px; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--border); }
.pk-item { display: flex; align-items: center; gap: 6px; height: 40px; padding: 0 10px; font-size: 13px; line-height: 1.15; text-align: left; border-radius: 8px; background: var(--surface-2); border: 1px solid var(--border); border-left: 6px solid var(--pk-color, var(--accent)); overflow: hidden; }
.pk-item .pk-n { font: 11px var(--mono); color: var(--text-dim); flex: none; }
.pk-item .pk-l { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pk-item.on { background: color-mix(in srgb, var(--pk-color, var(--accent)) 22%, var(--surface-2)); }
.pk-item.aim { outline: 2px solid var(--pk-color, var(--accent)); outline-offset: 1px; }
.pk-ring .pk-item { position: absolute; width: 124px; transform: translate(-50%, -50%); }
.pk-grid { position: fixed; z-index: 901; display: grid; grid-template-columns: repeat(3, 150px); gap: 6px; padding: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 12px 36px rgba(0,0,0,.4); max-width: calc(100vw - 16px); max-height: 80vh; overflow: auto; }
@media (max-width: 520px) { .pk-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`;

/** Distance the pointer must move from where the picker opened before a direction counts. */
const FLICK_PX = 24;
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

/**
 * The palette at a point: a ring (entries around the point, picked by direction) or a grid
 * (picked by what the pointer is over). Entries are numbered 1–9, 0 in order; while open the
 * picker takes those keys and Escape, and nothing else.
 */
export function openPicker(items: readonly PickerItem[], x: number, y: number, shape: "ring" | "grid", onClose: () => void): Picker {
  style("picker", CSS);
  const back = h("div", { class: "pk-backdrop" });
  let aimed = -1;
  let closed = false;
  const buttons = items.map((it, i) => h("button", {
    class: `pk-item${it.on ? " on" : ""}`, style: it.color ? `--pk-color: ${it.color}` : undefined, role: "menuitem",
    onclick: () => choose(i),
  }, i < DIGITS.length ? h("span", { class: "pk-n" }, DIGITS[i]) : null, h("span", { class: "pk-l" }, it.label)));

  let panel: HTMLElement;
  /** Direction of each entry from the center, in radians (ring only). */
  const angles: number[] = [];
  if (shape === "ring") {
    const n = Math.max(1, items.length);
    const r = Math.max(84, (n * 46) / Math.PI);
    const reach = r + 72;
    const cx = Math.max(reach, Math.min(innerWidth - reach, x)), cy = Math.max(r + 28, Math.min(innerHeight - r - 28, y));
    x = cx; y = cy;
    const disc = h("div", { class: "pk-disc", style: `left:${-reach}px;top:${-reach}px;width:${reach * 2}px;height:${reach * 2}px` });
    buttons.forEach((b, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      angles.push(a);
      b.style.left = `${Math.cos(a) * r}px`;
      b.style.top = `${Math.sin(a) * r}px`;
    });
    panel = h("div", { class: "pk-ring", role: "menu", style: `left:${cx}px;top:${cy}px` }, disc, h("div", { class: "pk-hub", "aria-hidden": "true" }), buttons);
  } else {
    panel = h("div", { class: "pk-grid", role: "menu" }, buttons);
  }
  document.body.append(back, panel);
  if (shape === "grid") {
    const r = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2))}px`;
    panel.style.top = `${Math.max(8, Math.min(innerHeight - r.height - 8, y - 20))}px`;
  }

  const setAim = (i: number) => {
    if (i === aimed) return;
    buttons[aimed]?.classList.remove("aim");
    aimed = i;
    buttons[aimed]?.classList.add("aim");
  };
  const onMove = (e: PointerEvent) => {
    if (shape === "ring") {
      const dx = e.clientX - x, dy = e.clientY - y;
      if (Math.hypot(dx, dy) < FLICK_PX) { setAim(-1); return; }
      const a = Math.atan2(dy, dx);
      let best = -1, bestD = Infinity;
      angles.forEach((b, i) => {
        const d = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
        if (d < bestD) { bestD = d; best = i; }
      });
      setAim(best);
    } else {
      const over = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(".pk-item");
      setAim(over ? buttons.indexOf(over as HTMLButtonElement) : -1);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    const i = DIGITS.indexOf(e.key);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (i >= 0 && i < items.length && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); choose(i); }
  };
  function close(): void {
    if (closed) return;
    closed = true;
    openOverlays.delete(close);
    back.remove();
    panel.remove();
    window.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("keydown", onKey, true);
    onClose();
  }
  function choose(i: number): void {
    const it = items[i];
    close();
    it?.pick();
  }
  openOverlays.add(close);
  window.addEventListener("pointermove", onMove, true);
  document.addEventListener("keydown", onKey, true);
  back.addEventListener("pointerdown", (e) => { e.preventDefault(); close(); });
  back.addEventListener("contextmenu", (e) => e.preventDefault());

  return {
    release: () => { if (!closed && aimed >= 0) choose(aimed); },
    close,
  };
}
