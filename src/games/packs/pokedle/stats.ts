import { h, style, clear } from "../../core/dom";
import { namespace } from "../../core/storage";
import type { KeyValue, Plugin, PuzzleRef, WidgetDef } from "../../core/types";
import { ctxOf, firstRight, isOver, solvedAt, type DataSource, type PokedleAction, type PokedleInteraction, type PokedlePuzzle, type PokedleState } from "./logic";

/**
 * Per attribute, over every board the player found: on which guess that attribute was first
 * marked right. Kept in this browser under the pack's own storage namespace.
 */
export interface AttrStats {
  /** attribute id → sum of (guess number it was first right on) and how many boards. */
  attrs: Record<string, { sum: number; n: number }>;
  /** Boards found, and the guesses they took in all. */
  boards: number;
  /** Games already counted, newest last (a game counts once however often it is replayed). */
  seen: string[];
}

const KEEP = 400;
const EMPTY: AttrStats = { attrs: {}, boards: 0, seen: [] };

export const statsStore = (): KeyValue => namespace("pokedle");
export const readStats = (store: KeyValue = statsStore()): AttrStats => store.get<AttrStats>("attr-stats", EMPTY);

/** What makes a game the same game: its boards, what they're compared on, and its bands. */
export const gameKey = (p: PokedlePuzzle): string => JSON.stringify([p.boards, p.attrs, p.bands, p.pool]);

/** Add a finished game; false if it was counted before. */
export function record(data: DataSource, p: PokedlePuzzle, s: PokedleState, store: KeyValue = statsStore()): boolean {
  const st = readStats(store);
  const key = gameKey(p);
  if (st.seen.includes(key)) return false;
  const next: AttrStats = { attrs: { ...st.attrs }, boards: st.boards, seen: [...st.seen, key].slice(-KEEP) };
  p.boards.forEach((_, b) => {
    if (solvedAt(p, s, b) < 0) return;
    next.boards++;
    firstRight(data, p, s, b).forEach((k, i) => {
      if (k < 0) return;
      const id = p.attrs[i]!;
      const was = next.attrs[id] ?? { sum: 0, n: 0 };
      next.attrs[id] = { sum: was.sum + k + 1, n: was.n + 1 };
    });
  });
  store.set("attr-stats", next);
  for (const f of listeners) f();
  return true;
}

const listeners = new Set<() => void>();

type P = Plugin<PokedlePuzzle, PokedleState, PokedleAction, PokedleInteraction>;

export function statsPlugin(data: DataSource, puzzle: PuzzleRef): P {
  return {
    id: "pokedle.attr-stats",
    name: "count attribute stats",
    description: "when a game ends, note on which guess each attribute was first right on every board you found (shown under attribute stats)",
    category: "stats",
    appliesTo: [puzzle],
    enabledByDefault: true,
    setup({ session, owner }) {
      session.hooks.change.tap(() => {
        if (session.outcome === "revealed" || !isOver(session.puzzle, session.state)) return;
        record(data, session.puzzle, session.state);
      }, { owner });
    },
  };
}

const CSS = `
.pkd-stats { display: flex; flex-direction: column; gap: 4px; width: 100%; max-width: 420px; font-size: 13px; }
.pkd-stats .row { display: grid; grid-template-columns: 8em 1fr 3em; align-items: center; gap: 8px; }
.pkd-stats .bar { height: 10px; border-radius: 3px; background: var(--verdict-match-c, var(--accent)); min-width: 2px; }
.pkd-stats .num { text-align: right; font-family: var(--mono); }
.pkd-stats .dim { color: var(--text-dim); }
`;

export function statsWidget(data: DataSource, puzzle: PuzzleRef): WidgetDef<PokedlePuzzle, PokedleState, PokedleAction, PokedleInteraction> {
  return {
    id: "pokedle.attr-stats",
    name: "attribute stats",
    description: "for each attribute, the guess it was first right on, on average over the boards you found",
    puzzles: [puzzle],
    defaultSlot: "panel",
    order: 36,
    mount(el, { session }) {
      style("pokedle-stats", CSS);
      const render = () => {
        clear(el);
        const st = readStats();
        const box = h("div", { class: "pkd-stats" });
        el.append(box);
        if (!st.boards) {
          box.append(h("p", { class: "dim" }, "no boards found yet."));
          return;
        }
        const attrs = ctxOf(data, session.puzzle).data.attributes;
        const rows = Object.entries(st.attrs).map(([id, v]) => ({ id, label: attrs.find((a) => a.id === id)?.label ?? id, avg: v.sum / v.n, n: v.n }))
          .sort((a, b) => a.avg - b.avg);
        const most = Math.max(...rows.map((r) => r.avg));
        box.append(h("p", { class: "dim" }, `guess each was first right on, average over ${st.boards} ${st.boards === 1 ? "board" : "boards"} found`));
        for (const r of rows) {
          box.append(h("div", { class: "row", title: `${r.n} ${r.n === 1 ? "board" : "boards"}` },
            h("span", null, r.label),
            h("div", { class: "bar", style: `width: ${(r.avg / most) * 100}%` }),
            h("span", { class: "num" }, r.avg.toFixed(1))));
        }
      };
      render();
      listeners.add(render);
      return () => { listeners.delete(render); };
    },
  };
}
