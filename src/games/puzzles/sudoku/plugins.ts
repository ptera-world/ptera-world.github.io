import { defineSchema } from "../../core/schema";
import type { Plugin } from "../../core/types";
import { bit, isSingle, lowDigit } from "./engine/bits";
import { conflicts, modelOf, type Model } from "./engine/model";
import { constraintTypes } from "./engine/registry";
import { cellName } from "./engine/types";
import { LATIN_IDS } from "./defs";
import { CANDIDATES, CONFLICTS, COUNTS, INFO, MISTAKES, PEERS, SAME, type SameDigit } from "./keys";
import { mistakeHint, nextStep, solutionOf, stepHint, type GridAction, type GridInteraction, type GridState, type LatinPuzzle } from "./puzzle";

type LatinPlugin = Plugin<LatinPuzzle, GridState, GridAction, GridInteraction>;

/** Candidates left by placed digits in peer cells, minus struck-out ones if `struck`. */
export function peerCandidates(m: Model, values: readonly number[], struck?: readonly number[]): number[] {
  const masks = values.map((v, c) => (v ? bit(v) : m.all & ~(struck?.[c] ?? 0)));
  for (let c = 0; c < m.size; c++) {
    const v = values[c]!;
    if (v) for (const p of m.peers[c]!) if (!values[p]) masks[p]! &= ~bit(v);
  }
  return masks;
}

/** Peer candidates narrowed further by every rule (cages, lines, dots…) to a fixpoint. */
export function ruleCandidates(m: Model, values: readonly number[], struck?: readonly number[]): number[] {
  const masks = peerCandidates(m, values, struck);
  for (let changed = true, guard = 0; changed && guard < 50; guard++) {
    changed = false;
    for (const r of m.rules) {
      const cur = r.cells.map((c) => masks[c]!);
      if (!r.propagate(cur)) continue;
      r.cells.forEach((c, i) => {
        if (values[c] || cur[i] === masks[c]) return;
        masks[c] = cur[i]!;
        changed = true;
        if (isSingle(cur[i]!)) for (const p of m.peers[c]!) if (!values[p] && masks[p]! & cur[i]!) masks[p]! &= ~cur[i]!;
      });
    }
  }
  return masks;
}

const DEPTH = {
  type: "enum", label: "rule out using", default: "peers",
  options: [
    { value: "peers", label: "digits already placed" },
    { value: "rules", label: "placed digits and constraint arithmetic" },
  ],
} as const;

const autoCandidates: LatinPlugin = {
  id: "sudoku.auto-candidates",
  name: "auto candidates",
  description: "show every digit each empty cell can still hold. centre-mark input then removes or restores candidates.",
  category: "assists",
  appliesTo: LATIN_IDS,
  enabledByDefault: false,
  settings: defineSchema({ depth: DEPTH }),
  setup({ session, settings, owner }) {
    const deep = settings.depth === "rules";
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const m = modelOf(puzzle);
      const masks = deep ? ruleCandidates(m, state.values, state.struck) : peerCandidates(m, state.values, state.struck);
      return { ...d, [CANDIDATES]: masks.map((mask, c) => (state.values[c] ? 0 : mask)) };
    }, { owner });
    session.hooks.action.tap((a) => {
      if (a?.type !== "mark" || a.layer !== "center") return a;
      return { type: "strike", marks: a.cells.map((c): [number, number] => [c, bit(a.digit)]), on: !a.on };
    }, { owner });
  },
};

const autoRemove: LatinPlugin = {
  id: "sudoku.auto-remove",
  name: "clear marks on placement",
  description: "placing a digit removes it from the pencil marks of every cell that sees it.",
  category: "assists",
  appliesTo: LATIN_IDS,
  enabledByDefault: true,
  settings: defineSchema({
    corner: { type: "bool", label: "corner marks too", default: true },
  }),
  setup({ session, settings, owner }) {
    const corner = settings.corner as boolean;
    session.hooks.apply.tap((next, { puzzle, prev, action }) => {
      if (action && next.values === prev.values) return next;
      const m = modelOf(puzzle);
      let center = next.center, cornerM = next.corner;
      for (let c = 0; c < m.size; c++) {
        const v = next.values[c]!;
        if (!v || (action && v === prev.values[c])) continue;
        const b = bit(v);
        for (const p of m.peers[c]!) {
          if (center[p]! & b) {
            if (center === next.center) center = center.slice();
            center[p]! &= ~b;
          }
          if (corner && cornerM[p]! & b) {
            if (cornerM === next.corner) cornerM = cornerM.slice();
            cornerM[p]! &= ~b;
          }
        }
      }
      return center === next.center && cornerM === next.corner ? next : { ...next, center, corner: cornerM };
    }, { owner, priority: 20 });
  },
};

function autoFill(kind: "naked" | "hidden"): LatinPlugin {
  return {
    id: `sudoku.fill-${kind}`,
    name: kind === "naked" ? "auto-fill naked singles" : "auto-fill hidden singles",
    description: kind === "naked"
      ? "a cell with only one possible digit left gets it automatically (same undo step as your move)."
      : "a digit with only one possible cell left in a row, column or box goes there automatically.",
    category: "assists",
    appliesTo: LATIN_IDS,
    enabledByDefault: false,
    settings: defineSchema({
      struck: { type: "bool", label: "count candidates i've ruled out", default: true },
      depth: DEPTH,
    }),
    setup({ session, settings, owner }) {
      const useStruck = settings.struck as boolean;
      const candidates = settings.depth === "rules" ? ruleCandidates : peerCandidates;
      session.hooks.apply.tap((next, { puzzle, action, reduce }) => {
        if (action && (action.type === "clear" || (action.type === "set" && action.digit === 0))) return next;
        const m = modelOf(puzzle);
        let s = next;
        for (let guard = 0; guard < m.size; guard++) {
          const masks = candidates(m, s.values, useStruck ? s.struck : undefined);
          const found = kind === "naked" ? findNaked(s, masks) : findHidden(m, s, masks);
          if (!found) break;
          const after = reduce(s, { type: "set", cells: [found[0]], digit: found[1] });
          if (after === s) break;
          s = after;
        }
        return s;
      }, { owner, priority: 10 });
    },
  };
}

function findNaked(s: GridState, masks: readonly number[]): [number, number] | null {
  for (let c = 0; c < masks.length; c++) if (!s.values[c] && isSingle(masks[c]!)) return [c, lowDigit(masks[c]!)];
  return null;
}

function findHidden(m: Model, s: GridState, masks: readonly number[]): [number, number] | null {
  for (const h of m.full) {
    const cells = m.houses[h]!.cells;
    let placed = 0;
    for (const c of cells) if (s.values[c]) placed |= bit(s.values[c]!);
    for (let d = 1; d <= m.n; d++) {
      if (placed & bit(d)) continue;
      const spots = cells.filter((c) => !s.values[c] && masks[c]! & bit(d));
      if (spots.length === 1) return [spots[0]!, d];
    }
  }
  return null;
}

const conflictCheck: LatinPlugin = {
  id: "sudoku.conflicts",
  name: "highlight conflicts",
  description: "mark digits that clash with another digit or break a rule.",
  category: "checks",
  appliesTo: LATIN_IDS,
  enabledByDefault: true,
  settings: defineSchema({
    rules: { type: "bool", label: "check cages, lines and other clues too", default: true },
  }),
  setup({ session, settings, owner }) {
    const rules = settings.rules as boolean;
    session.hooks.derive.tap((d, { puzzle, state }) => ({ ...d, [CONFLICTS]: [...conflicts(modelOf(puzzle), state.values, rules)] }), { owner });
  },
};

const mistakeCheck: LatinPlugin = {
  id: "sudoku.mistakes",
  name: "highlight mistakes",
  description: "mark placed digits that differ from the solution, even when nothing clashes yet.",
  category: "checks",
  appliesTo: LATIN_IDS,
  enabledByDefault: false,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const sol = solutionOf(puzzle);
      if (!sol) return d;
      return { ...d, [MISTAKES]: state.values.flatMap((v, c) => (v && !puzzle.givens[c] && v !== sol[c] ? [c] : [])) };
    }, { owner });
  },
};

/** The digit the player is focused on: the cursor cell's digit, if any. */
function focusDigit(state: GridState, it: GridInteraction): number {
  return state.values[it.cursor] ?? 0;
}

const sameDigit: LatinPlugin = {
  id: "sudoku.same-digit",
  name: "highlight same digit",
  description: "selecting a digit highlights everywhere it's placed.",
  category: "highlighting",
  appliesTo: LATIN_IDS,
  enabledByDefault: true,
  settings: defineSchema({
    marks: { type: "bool", label: "also light it up in pencil marks", default: true },
    seen: { type: "bool", label: "also shade cells where it can't go", default: false },
  }),
  setup({ session, settings, owner }) {
    const marks = settings.marks as boolean, seen = settings.seen as boolean;
    session.hooks.derive.tap((d, { puzzle, state, interaction }) => {
      const digit = focusDigit(state, interaction);
      if (!digit) return d;
      const cells = state.values.flatMap((v, c) => (v === digit ? [c] : []));
      const same: SameDigit = { digit, cells, marks };
      if (!seen) return { ...d, [SAME]: same };
      const m = modelOf(puzzle);
      const blocked = new Set<number>();
      for (const c of cells) for (const p of m.peers[c]!) if (!state.values[p]) blocked.add(p);
      return { ...d, [SAME]: same, [PEERS]: [...new Set([...((d[PEERS] as number[] | undefined) ?? []), ...blocked])] };
    }, { owner, priority: 5 });
  },
};

const peerHighlight: LatinPlugin = {
  id: "sudoku.peers",
  name: "highlight peers",
  description: "shade the cells that see the selected cell.",
  category: "highlighting",
  appliesTo: LATIN_IDS,
  enabledByDefault: true,
  settings: defineSchema({
    variant: { type: "bool", label: "include variant links (knight's move, diagonals, cages…)", default: true },
  }),
  setup({ session, settings, owner }) {
    const variant = settings.variant as boolean;
    session.hooks.derive.tap((d, { puzzle, interaction }) => {
      if (interaction.selection.length !== 1) return d;
      const m = modelOf(puzzle);
      const c = interaction.selection[0]!;
      const peers = variant ? m.peers[c]! : m.houseOf[c]!.filter((h) => ["row", "col", "box"].includes(m.houses[h]!.kind)).flatMap((h) => m.houses[h]!.cells);
      return { ...d, [PEERS]: [...new Set([...((d[PEERS] as number[] | undefined) ?? []), ...peers])].filter((x) => x !== c) };
    }, { owner });
  },
};

const digitCounts: LatinPlugin = {
  id: "sudoku.digit-counts",
  name: "digit counts",
  description: "show how many of each digit are left on the digit pad, and fade finished ones.",
  category: "highlighting",
  appliesTo: LATIN_IDS,
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const counts = Array.from({ length: puzzle.n + 1 }, () => 0);
      for (const v of state.values) if (v) counts[v]!++;
      return { ...d, [COUNTS]: counts };
    }, { owner });
  },
};

const hints: LatinPlugin = {
  id: "sudoku.hints",
  name: "step-by-step hints",
  description: "asking again for a hint on the same position reveals more: first where to look, then the pattern, then the deduction.",
  category: "assists",
  appliesTo: LATIN_IDS,
  enabledByDefault: true,
  settings: defineSchema({
    progressive: { type: "bool", label: "reveal gradually", default: true },
    mistakes: { type: "bool", label: "point out wrong digits first", default: true },
  }),
  setup({ session, settings, owner }) {
    let last: { state: GridState; level: number } | null = null;
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (settings.mistakes) {
        const m = mistakeHint(puzzle, state);
        if (m) return m;
      }
      const step = nextStep(puzzle, state);
      if (!step) return null;
      const level = !settings.progressive ? 2 : last?.state === state ? Math.min(2, last.level + 1) : 0;
      last = { state, level };
      return stepHint(step, level);
    }, { owner });
  },
};

const cageCombos: LatinPlugin = {
  id: "sudoku.cage-combos",
  name: "cage combinations",
  description: "list the digit combinations still possible for the cage under the cursor.",
  category: "assists",
  appliesTo: LATIN_IDS,
  enabledByDefault: true,
  settings: defineSchema({
    max: { type: "int", label: "most combinations to list", default: 8, min: 1, max: 40 },
  }),
  setup({ session, settings, owner }) {
    const max = settings.max as number;
    session.hooks.derive.tap((d, { puzzle, state, interaction }) => {
      const m = modelOf(puzzle);
      const lines: string[] = [];
      const masks = peerCandidates(m, state.values, state.struck);
      m.rulesOf[interaction.cursor]?.forEach((ri) => {
        const r = m.rules[ri]!;
        const spec = puzzle.constraints[m.ruleSource[ri]!]!;
        if (!constraintTypes.get(spec.type)?.combos || !r.enumerate) return;
        const seen = new Set<string>();
        const sols = r.enumerate(r.cells.map((c) => masks[c]!), 2000);
        for (const s of sols) seen.add(s.slice().sort((a, b) => a - b).join(""));
        const list = [...seen].sort();
        const shown = list.slice(0, max).join(" ");
        lines.push(`${r.label}: ${list.length ? shown + (list.length > max ? ` (+${list.length - max})` : "") : "no combination fits"}`);
      });
      return lines.length ? { ...d, [INFO]: [...((d[INFO] as string[] | undefined) ?? []), ...lines] } : d;
    }, { owner });
  },
};

const cursorInfo: LatinPlugin = {
  id: "sudoku.cell-name",
  name: "cell name",
  description: "show the cursor cell's row/column name (as used in hints).",
  category: "highlighting",
  appliesTo: LATIN_IDS,
  enabledByDefault: false,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, interaction }) =>
      ({ ...d, [INFO]: [cellName(puzzle.n, interaction.cursor), ...((d[INFO] as string[] | undefined) ?? [])] }), { owner, priority: -1 });
  },
};

export const latinPlugins: LatinPlugin[] = [
  autoCandidates, autoRemove, autoFill("naked"), autoFill("hidden"), hints, cageCombos,
  conflictCheck, mistakeCheck, sameDigit, peerHighlight, digitCounts, cursorInfo,
];
