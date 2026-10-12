import { HOLD_MS } from "../../core/gestures";
import { style } from "../../core/dom";
import type { Technique } from "../../core/types";

/** Where a dragged technique comes from: the palette, or a hotbar slot. */
export type DragFrom = { kind: "palette" } | { kind: "slot"; slot: number };

/** Where it lands: before or after a palette tile, a hotbar slot, or nowhere. */
export type DropAt = { kind: "palette"; id: string; after: boolean } | { kind: "slot"; slot: number } | null;

export interface TileDragHandlers {
  drop(t: Technique, from: DragFrom, at: DropAt): void;
  /** A touch hold let go without moving. */
  held(t: Technique): void;
}

const CSS = `
.td-ghost { position: fixed; z-index: 950; pointer-events: none; opacity: .85; transform: translate(-50%, -50%) scale(1.04); box-shadow: 0 10px 28px rgba(0,0,0,.4); }
[data-drop].td-over { outline: 2px dashed var(--tc, var(--accent)); outline-offset: 2px; }
.td-source { opacity: .45; }
`;

const DRAG_PX = 6;

/**
 * Dragging technique tiles between the palette and the hotbar. A mouse drags as soon as it moves;
 * touch drags after a hold, and a hold let go without moving is reported instead. Drop targets
 * are elements with `data-drop` ("palette:<id>" or "slot:<n>"). The release ending a drag or a
 * hold is not a click (`swallowClick`).
 */
export class TileDrag {
  private press: { el: HTMLElement; t: Technique; from: DragFrom; x: number; y: number; touch: boolean; armed: boolean; ghost: HTMLElement | null } | null = null;
  private timer = 0;
  private over: HTMLElement | null = null;
  private swallow = false;

  constructor(private handlers: TileDragHandlers, signal: AbortSignal) {
    style("tile-drag", CSS);
    window.addEventListener("pointermove", (e) => this.move(e), { capture: true, signal });
    window.addEventListener("pointerup", (e) => this.up(e), { capture: true, signal });
    window.addEventListener("pointercancel", () => this.end(), { capture: true, signal });
    window.addEventListener("touchmove", (e) => { if (this.press?.armed && this.press.touch) e.preventDefault(); }, { passive: false, capture: true, signal });
    signal.addEventListener("abort", () => this.end());
  }

  /** True while a tile is being dragged (its panel should not re-render under it). */
  get dragging(): boolean {
    return !!this.press?.ghost;
  }

  /** True once if the click that follows a drag or a hold should be ignored. */
  swallowClick(): boolean {
    const s = this.swallow;
    this.swallow = false;
    return s;
  }

  /** A press on a tile carrying `t`. */
  down(e: PointerEvent, el: HTMLElement, t: Technique, from: DragFrom): void {
    if (e.button !== 0) return;
    this.end();
    this.swallow = false;
    const touch = e.pointerType !== "mouse";
    this.press = { el, t, from, x: e.clientX, y: e.clientY, touch, armed: !touch, ghost: null };
    if (touch) this.timer = window.setTimeout(() => { if (this.press) { this.press.armed = true; el.classList.add("td-source"); } }, HOLD_MS);
  }

  private move(e: PointerEvent): void {
    const p = this.press;
    if (!p) return;
    if (!p.ghost) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_PX) return;
      if (!p.armed) { this.end(); return; }
      p.ghost = p.el.cloneNode(true) as HTMLElement;
      p.ghost.classList.add("td-ghost");
      p.ghost.style.width = `${p.el.getBoundingClientRect().width}px`;
      document.body.append(p.ghost);
      p.el.classList.add("td-source");
    }
    p.ghost.style.left = `${e.clientX}px`;
    p.ghost.style.top = `${e.clientY}px`;
    const over = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]") ?? null;
    if (over !== this.over) {
      this.over?.classList.remove("td-over");
      this.over = over;
      over?.classList.add("td-over");
    }
  }

  private up(e: PointerEvent): void {
    const p = this.press;
    if (!p) return;
    if (p.ghost) {
      this.swallow = true;
      const at = this.dropAt(e);
      this.end();
      this.handlers.drop(p.t, p.from, at);
      return;
    }
    if (p.touch && p.armed) {
      this.swallow = true;
      this.end();
      this.handlers.held(p.t);
      return;
    }
    this.end();
  }

  private dropAt(e: PointerEvent): DropAt {
    const d = this.over?.dataset.drop;
    if (!d || !this.over) return null;
    const [kind, rest] = [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1)];
    if (kind === "slot") return { kind: "slot", slot: Number(rest) };
    const r = this.over.getBoundingClientRect();
    return { kind: "palette", id: rest, after: e.clientY > r.bottom || (e.clientY >= r.top && e.clientX > r.left + r.width / 2) };
  }

  private end(): void {
    clearTimeout(this.timer);
    this.press?.ghost?.remove();
    this.press?.el.classList.remove("td-source");
    this.over?.classList.remove("td-over");
    this.over = null;
    this.press = null;
  }
}
