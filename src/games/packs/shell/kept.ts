import { h, style } from "../../core/dom";
import type { Session } from "../../core/session";
import type { Technique, ViewHandle } from "../../core/types";
import { applyStep, colorOf } from "./engine";

/**
 * When the colors techniques leave on the board show: until the next move, fading out a while after each step,
 * for the last few steps, always, only while the reveal key is held, or never.
 */
export type KeptMode = "next" | "fade" | "recent" | "always" | "hold" | "off";

const CSS = `
.kept-layer { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.kept-layer > div { position: absolute; border-radius: 3px; background: color-mix(in srgb, var(--kc) 30%, transparent); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--kc) 70%, transparent); }
.kept-layer > div.hidden { opacity: 0; }
.kept-layer > div.fading { animation: kept-fade var(--kept-ms) linear forwards; animation-delay: var(--kept-delay); }
.kept-layer.reveal > div { opacity: 1; animation: none; }
@keyframes kept-fade { 0%, 60% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .kept-layer > div.fading { animation-timing-function: steps(1, end); } }
`;

interface Mark {
  /** Relative to the host's box. */
  rect: DOMRect;
  t: Technique;
  /** When the step that made it happened (ms, performance clock); unknown for steps from before this page load. */
  at?: number;
  /** True if the step that made it is the latest step in the history. */
  last: boolean;
  /** Position among the steps that left colors, newest 0. */
  age: number;
}

export interface KeptSource {
  session: Session<any, any, any, any>;
  view: ViewHandle | null;
  list: readonly Technique[];
  mode: KeptMode;
  /** How long a color stays before it has faded, in "fade" mode. */
  fadeMs: number;
  /** False for techniques whose colors stay off the board. */
  shows(t: Technique): boolean;
  /** How many of the newest steps keep their colors, in "recent" mode. */
  recent: number;
}

const keyOf = (r: DOMRect) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;

/**
 * Colors over the board: each spot a technique decided (cast, automatic, or a hand move a technique
 * accounts for), in that technique's color, while it still holds what the step gave it and the
 * step is not undone. Built from the session's history, so it follows undo and redo. Which colors
 * show depends on the mode; every one stays known for `techniqueAt` whatever shows.
 */
export class KeptLayer {
  readonly el = h("div", { class: "kept-layer", "aria-hidden": "true" });
  private marks: Mark[] = [];
  private raf = 0;
  /** Board state after a step → when it happened. */
  private times = new WeakMap<object, number>();
  /** Board state after a hand move → the technique that accounts for it. */
  private recognized = new WeakMap<object, Technique>();

  constructor(private host: HTMLElement, private get: () => KeptSource | null) {
    style("kept", CSS);
  }

  /** Remember that the step ending in `after` happened now. */
  stamp(after: unknown): void {
    if (after && typeof after === "object") this.times.set(after, performance.now());
  }

  /** The hand move ending in `after` is one `t` accounts for. */
  recognize(after: unknown, t: Technique): void {
    if (after && typeof after === "object") this.recognized.set(after, t);
    this.schedule();
  }

  /** The technique a hand move ending in `after` was recognized as, if any. */
  recognizedAt(after: unknown): Technique | undefined {
    return after && typeof after === "object" ? this.recognized.get(after) : undefined;
  }

  /** Show every color while `on` (the reveal key is held), whatever the mode. */
  reveal(on: boolean): void {
    this.el.classList.toggle("reveal", on);
  }

  /** Redraw on the next frame. */
  schedule(): void {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.render());
  }

  /** The technique whose color is at a screen point, shown or not, if any. */
  techniqueAt(clientX: number, clientY: number): Technique | null {
    const base = this.host.getBoundingClientRect();
    const x = clientX - base.left, y = clientY - base.top;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const r = this.marks[i]!.rect;
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return this.marks[i]!.t;
    }
    return null;
  }

  private attach(): void {
    if (this.el.parentElement !== this.host) this.host.append(this.el);
  }

  render(): void {
    this.el.replaceChildren();
    this.marks = [];
    const g = this.get();
    const view = g?.view;
    if (!g || !view?.locateChange) return;
    this.attach();
    const { session, list } = g;
    const now = session.state;
    const byKey = new Map<string, Omit<Mark, "age" | "last"> & { step: number; entry: number }>();
    const past = session.timeline().past;
    let steps = 0;
    const add = (t: Technique, before: unknown, after: unknown, at: number | undefined, entry: number) => {
      const gone = new Set(view.locateChange!(after, now).map(keyOf));
      for (const rect of view.locateChange!(before, after)) {
        const k = keyOf(rect);
        byKey.delete(k);
        if (!gone.has(k)) byKey.set(k, { rect, t, at, step: steps, entry });
      }
      steps++;
    };
    for (const [i, entry] of past.entries()) {
      const at = entry.after && typeof entry.after === "object" ? this.times.get(entry.after) : undefined;
      const hand = entry.after && typeof entry.after === "object" ? this.recognized.get(entry.after) : undefined;
      if (hand && g.shows(hand) && entry.sources[0]?.kind === "player") add(hand, entry.before, entry.after, at, i);
      for (const src of entry.sources) {
        if (src.kind !== "technique") continue;
        const t = list.find((x) => x.id === src.technique);
        if (t && g.shows(t)) add(t, entry.before, applyStep(session.def, session.puzzle, entry.before, src.step), at, i);
      }
    }
    const base = this.host.getBoundingClientRect();
    const clock = performance.now();
    this.marks = [...byKey.values()].map((m) => ({
      t: m.t, at: m.at, age: steps - 1 - m.step, last: m.entry === past.length - 1,
      rect: new DOMRect(m.rect.left - base.left, m.rect.top - base.top, m.rect.width, m.rect.height),
    }));
    for (const m of this.marks) {
      const d = h("div", { style: `--kc:${colorOf(m.t, list)};left:${m.rect.left}px;top:${m.rect.top}px;width:${m.rect.width}px;height:${m.rect.height}px` });
      const shown = g.mode === "always" || (g.mode === "next" && m.last) || (g.mode === "recent" && m.age < g.recent);
      const fading = g.mode === "fade" && m.at !== undefined && clock - m.at < g.fadeMs;
      if (fading) {
        d.classList.add("fading");
        d.style.setProperty("--kept-ms", `${g.fadeMs}ms`);
        d.style.setProperty("--kept-delay", `${-(clock - m.at!)}ms`);
      } else if (!shown) d.classList.add("hidden");
      this.el.append(d);
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }
}
