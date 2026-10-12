import type { Step, Technique } from "../../core/types";
import { cellList } from "../../lib/grid-kit/names";
import { failed, kindName, pairs, remaining, type PairsAction, type PairsFocus, type PairsPuzzle, type PairsState } from "./logic";

type PairsTechnique = Technique<PairsPuzzle, PairsState, PairsAction>;

const flips = (cells: readonly number[]): PairsAction[] => cells.map((cell) => ({ type: "flip", cell }));
const focus = (cells: number[]): PairsFocus => ({ cells });

/** Cards that stay face down to the player but were shown before: the only cards a hint may name. */
const known = (s: PairsState, cells: readonly number[]) => cells.filter((c) => s.seen[c]);

export const twin: PairsTechnique = {
  id: "pairs.twin",
  name: "twin of the one you flipped",
  puzzles: [pairs],
  level: 1,
  description: "after you flip a card, think back: if you have already seen another card of the same kind, flip that one next.",
  practice: false,
  instances(p, s, visit) {
    if (!s.up.length || failed(p, s)) return;
    const kind = p.faces[s.up[0]!]!;
    const seen = known(s, (remaining(p, s).get(kind) ?? []).filter((c) => !s.up.includes(c)));
    if (!seen.length) return;
    const next = seen.slice(0, p.set - s.up.length);
    visit(step(p, s, kind, next));
  },
};

function step(p: PairsPuzzle, s: PairsState, kind: number, cells: number[]): Step<PairsAction> {
  const showing = s.up.filter((c) => p.faces[c] === kind);
  return {
    message: `you already saw ${kindName(kind)} at ${cellList(p, [...showing, ...cells])}: flip ${cellList(p, cells)}`,
    nudge: showing.length ? "you have seen a match for the card showing" : "you have seen all of one kind already",
    focus: focus(cells),
    nudgeFocus: focus(showing),
    actions: flips(cells),
  };
}

export const knownSet: PairsTechnique = {
  id: "pairs.known-set",
  name: "all of a kind seen",
  puzzles: [pairs],
  level: 2,
  description: "when you have already seen every card of one kind, even if they are all face down now, flip them straight away.",
  practice: false,
  instances(p, s, visit) {
    if (s.up.length && !failed(p, s)) return;
    for (const [kind, cells] of remaining(p, s)) {
      if (cells.length !== p.set || known(s, cells).length !== p.set) continue;
      if (visit({
        message: `you have seen every ${kindName(kind)}, at ${cellList(p, cells)}: flip them`,
        nudge: "you have seen every card of one kind already",
        focus: focus(cells),
        nudgeFocus: focus([]),
        actions: flips(cells),
      })) return;
    }
  },
};

export const pairsTechniques: PairsTechnique[] = [twin, knownSet];
