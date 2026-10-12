import { h, style } from "../../core/dom";
import type { Session } from "../../core/session";
import type { Technique, ViewHandle } from "../../core/types";
import { applyStep, colorOf } from "./engine";

const CSS = `
.kept-layer { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.kept-layer > div { position: absolute; border-radius: 3px; background: color-mix(in srgb, var(--kc) 30%, transparent); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--kc) 70%, transparent); }
.kept-layer > div.flash { animation: kept-flash 700ms ease-out forwards; }
@keyframes kept-flash { from { opacity: 1; } to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .kept-layer > div.flash { animation-duration: 1ms; animation-delay: 500ms; } }
`;

interface Mark {
  /** Relative to the host's box. */
  rect: DOMRect;
  t: Technique;
}

const keyOf = (r: DOMRect) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;

/**
 * Colors over the board: each spot a technique decided, in that technique's color, while it still
 * holds what the technique gave it and the step that made it is not undone. Built from the
 * session's history, so it follows undo, redo and reloads. Also flashes a cast's spots once.
 */
export class KeptLayer {
  readonly el = h("div", { class: "kept-layer", "aria-hidden": "true" });
  private marks: Mark[] = [];
  private raf = 0;

  constructor(private host: HTMLElement, private get: () => { session: Session<any, any, any, any>; view: ViewHandle | null; list: readonly Technique[]; on: boolean } | null) {
    style("kept", CSS);
  }

  /** Redraw on the next frame. */
  schedule(): void {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.render());
  }

  /** The technique whose color is at a screen point, if any. */
  techniqueAt(clientX: number, clientY: number): Technique | null {
    const base = this.host.getBoundingClientRect();
    const x = clientX - base.left, y = clientY - base.top;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const r = this.marks[i]!.rect;
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return this.marks[i]!.t;
    }
    return null;
  }

  /** Flash the spots `t` changed from `prev` to `next`. */
  flash(t: Technique, prev: unknown, next: unknown): void {
    const g = this.get();
    const rects = g?.view?.locateChange?.(prev, next) ?? [];
    if (!g || !rects.length) return;
    this.attach();
    const base = this.host.getBoundingClientRect();
    const color = colorOf(t, g.list);
    for (const r of rects) {
      const d = this.box(r, base, color);
      d.classList.add("flash");
      d.addEventListener("animationend", () => d.remove());
      this.el.append(d);
    }
  }

  private attach(): void {
    if (this.el.parentElement !== this.host) this.host.append(this.el);
  }

  private box(r: DOMRect, base: DOMRect, color: string): HTMLElement {
    return h("div", { style: `--kc:${color};left:${r.left - base.left}px;top:${r.top - base.top}px;width:${r.width}px;height:${r.height}px` });
  }

  render(): void {
    for (const d of Array.from(this.el.children)) if (!d.classList.contains("flash")) d.remove();
    this.marks = [];
    const g = this.get();
    const view = g?.view;
    if (!g || !g.on || !view?.locateChange) return;
    this.attach();
    const { session, list } = g;
    const now = session.state;
    const byKey = new Map<string, Mark>();
    for (const entry of session.timeline().past) {
      for (const src of entry.sources) {
        if (src.kind !== "technique") continue;
        const t = list.find((x) => x.id === src.technique);
        if (!t) continue;
        const after = applyStep(session.def, session.puzzle, entry.before, src.step);
        const gone = new Set(view.locateChange(after, now).map(keyOf));
        for (const rect of view.locateChange(entry.before, after)) {
          const k = keyOf(rect);
          byKey.delete(k);
          if (!gone.has(k)) byKey.set(k, { rect, t });
        }
      }
    }
    const base = this.host.getBoundingClientRect();
    this.marks = [...byKey.values()].map((m) => ({ t: m.t, rect: new DOMRect(m.rect.left - base.left, m.rect.top - base.top, m.rect.width, m.rect.height) }));
    for (const m of this.marks) this.el.append(this.box(m.rect, new DOMRect(0, 0, 0, 0), colorOf(m.t, list)));
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }
}
