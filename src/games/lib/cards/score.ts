import { h, style } from "../../core/dom";
import type { Action, PuzzleRef, WidgetDef } from "../../core/types";

const CSS = `
.cards-score { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; font-variant-numeric: tabular-nums; }
`;

/**
 * A line above the board that reads out a card game's score. `read` returns the text from the
 * state and the elapsed time; with `timed` it is read again every second while the game runs.
 */
export function scoreWidget<Pz, S, A extends Action = any, I = any>(o: {
  id: string;
  name: string;
  description: string;
  puzzles: readonly PuzzleRef[];
  timed?: (p: Pz) => boolean;
  read(p: Pz, s: S, elapsedMs: number): string;
}): WidgetDef<Pz, S, A, I> {
  return {
    id: o.id,
    name: o.name,
    description: o.description,
    puzzles: o.puzzles,
    defaultSlot: "top",
    order: 10,
    mount(el, { session, owner }) {
      style("cards-score", CSS);
      const box = h("div", { class: "cards-score", "aria-live": "off" });
      el.append(box);
      const render = () => { box.textContent = o.read(session.puzzle, session.state, session.finishedAtMs ?? session.elapsedMs()); };
      session.hooks.change.tap(render, { owner });
      session.hooks.refresh.tap(render, { owner });
      render();
      if (!o.timed?.(session.puzzle)) return;
      const tick = setInterval(render, 1000);
      return () => clearInterval(tick);
    },
  };
}
