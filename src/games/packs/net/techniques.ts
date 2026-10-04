import type { Step as CoreStep, Technique } from "../../core/types";
import { coord, type NetPuzzle } from "./grid";
import type { NetAction, NetHintFocus, NetState } from "./logic";
import { RULES, deduce, type Rule, type Step } from "./solver";

interface Info {
  name: string;
  description: string;
  /** Why the tile at `at` can't turn the other ways. */
  because: (at: string, p: NetPuzzle) => string;
  /** Where to look, without the answer. */
  nudge: string;
  practice: Record<string, unknown>;
}

const INFO: Record<Rule, Info> = {
  local: {
    name: "only fit",
    description: "a pipe can't point off the board, into a wall, or at a tile that can never point back, and it has to point at a tile that always points back. when only one way round is left, that's the way. locked tiles count as known.",
    because: (at, p) => {
      const blocked = [...(p.wrap ? [] : ["the edge"]), ...(p.barriers.some((b) => b) ? ["a wall"] : [])];
      return `every other way, ${at} ${blocked.length ? `points a pipe into ${blocked.join(" or ")}, or ` : ""}doesn't match the tiles next to it`;
    },
    nudge: "a tile in the highlighted area only fits one way",
    practice: { width: 5, height: 5, difficulty: "easy" },
  },
  deadend: {
    name: "dead ends",
    description: "two dead ends (tiles with a single pipe) can't point at each other: they'd make a pair joined to nothing else.",
    because: (at) => `pointing ${at} at the dead end next to it would make a pair cut off from everything`,
    nudge: "two dead ends in the highlighted area can't face each other",
    practice: { width: 7, height: 7, difficulty: "easy" },
  },
  loop: {
    name: "no loops",
    description: "the finished network has no loops, so a tile can't turn a way that joins the same connected group twice.",
    because: (at) => `the other ways ${at} could turn would close a loop`,
    nudge: "turning a tile here the wrong way would close a loop",
    practice: { width: 7, height: 7, difficulty: "normal" },
  },
  island: {
    name: "no islands",
    description: "everything ends up in one network, so a tile can't turn a way that seals a group off with no open end left to grow from.",
    because: (at) => `the other ways ${at} could turn would seal a group off from the rest`,
    nudge: "turning a tile here the wrong way would cut a group off",
    practice: { width: 7, height: 7, wrap: true, difficulty: "normal" },
  },
  lookahead: {
    name: "what if",
    description: "pick a way a tile could turn and follow the other rules from there. if that runs into a contradiction, the tile can't go that way.",
    because: (at) => `trying the other ways for ${at} runs into a contradiction a few tiles later`,
    nudge: "one tile here leads to a contradiction if you try turning it the wrong way",
    practice: { width: 7, height: 7, difficulty: "hard" },
  },
};

/** Cells to highlight: the determining step, plus the cells of rule steps it builds on. */
function focusOf(d: { cell: number; rule: Rule; steps: Step[] }): { main: Step; ruleCells: number[]; cells: number[] } {
  const main = d.steps[d.steps.length - 1]!;
  const cells = new Set(main.focus);
  cells.add(d.cell);
  const ruleCells = new Set<number>();
  for (const st of d.steps) {
    if (st.rule !== d.rule) continue;
    if (st !== main && !st.cells.some((c) => cells.has(c))) continue;
    for (const c of st.cells) ruleCells.add(c);
    if (st !== main) for (const f of st.focus) cells.add(f);
  }
  return { main, ruleCells: [...ruleCells], cells: [...cells] };
}

export function stepFor(p: NetPuzzle, s: NetState, rule: Rule): CoreStep<NetAction> | null {
  const givens = s.tiles.map((m, i) => (s.locked[i] ? m : -1));
  const d = deduce(p, givens, rule);
  if (!d) return null;
  const info = INFO[rule];
  const at = coord(p, d.cell);
  const { main, ruleCells, cells } = focusOf(d);
  const already = s.tiles[d.cell] === d.mask;
  const act = already ? `${at} is already right, lock it` : `turn ${at} like this and lock it`;
  let message: string;
  if (main.rule === rule) message = `${act}: ${info.because("it", p)}`;
  else if (ruleCells.length) message = `${info.because(ruleCells.map((c) => coord(p, c)).join(" and "), p)}, which leaves ${at} only one way to fit. ${act}`;
  else message = `${act}: once ${info.name} rules a few ways out nearby, it only fits one way`;
  return {
    message,
    nudge: info.nudge,
    focus: { cell: d.cell, cells, mask: d.mask } satisfies NetHintFocus,
    nudgeFocus: { cell: -1, cells } satisfies NetHintFocus,
    actions: [{ type: "set", cell: d.cell, mask: d.mask, lock: true }],
  };
}

export const techniques: Technique<NetPuzzle, NetState, NetAction>[] = RULES.map((rule, i) => ({
  id: `net.${rule}`,
  name: INFO[rule].name,
  puzzles: ["net"],
  level: i + 1,
  description: INFO[rule].description,
  find: (p, s) => stepFor(p, s, rule),
  practice: { params: INFO[rule].practice },
}));
