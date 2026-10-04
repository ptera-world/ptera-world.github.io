import { defineSchema } from "../../core/schema";
import type { Plugin, PluginApi } from "../../core/types";
import { bit } from "./engine/bits";
import { conflicts, modelOf, type Model } from "./engine/model";
import { LATIN_IDS } from "./defs";
import { CANDIDATES, CONFLICTS, MISTAKES, PEERS, SAME, type SameDigit } from "./keys";
import { mistakeHint, solutionOf, type GridAction, type GridInteraction, type GridState, type LatinPuzzle } from "./puzzle";

type LatinPlugin = Plugin<LatinPuzzle, GridState, GridAction, GridInteraction>;
type Api = PluginApi<LatinPuzzle, GridState, GridAction, GridInteraction>;

/** Candidates left by placed digits in peer cells, minus the player's struck-out ones. */
export function peerCandidates(m: Model, values: readonly number[], struck?: readonly number[]): number[] {
  const masks = values.map((v, c) => (v ? bit(v) : m.all & ~(struck?.[c] ?? 0)));
  for (let c = 0; c < m.size; c++) {
    const v = values[c]!;
    if (v) for (const p of m.peers[c]!) if (!values[p]) masks[p]! &= ~bit(v);
  }
  return masks;
}

/** Shows computed candidates instead of center marks; center-mark input strikes or restores them. */
function showCandidates({ session, owner }: Api): void {
  session.hooks.derive.tap((d, { puzzle, state }) => {
    const masks = peerCandidates(modelOf(puzzle), state.values, state.struck);
    return { ...d, [CANDIDATES]: masks.map((mask, c) => (state.values[c] ? 0 : mask)) };
  }, { owner });
  session.hooks.action.tap((a) => {
    if (a?.type !== "mark" || a.layer !== "center") return a;
    return { type: "strike", marks: a.cells.map((c): [number, number] => [c, bit(a.digit)]), on: !a.on };
  }, { owner });
}

const autoCandidates: LatinPlugin = {
  id: "sudoku.auto-candidates",
  name: "auto candidates",
  description: "show every digit each empty cell can still hold, given the digits placed so far. center-mark input then crosses candidates out or brings them back. turn on auto for clue techniques to have clues narrow them too.",
  category: "assists",
  appliesTo: LATIN_IDS,
  enabledByDefault: false,
  setup: showCandidates,
};

const practiceCandidates: LatinPlugin = {
  id: "sudoku.practice-candidates",
  name: "candidates while practicing",
  description: "on practice boards for techniques that cross out candidates, show the candidates (like auto candidates) so the pattern is there to find.",
  category: "assists",
  appliesTo: LATIN_IDS,
  enabledByDefault: true,
  setup(api) {
    const o = api.session.origin;
    if (o.kind !== "practice" || !o.step.actions.some((a) => (a as GridAction).type === "strike")) return;
    showCandidates(api);
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

/** Cells in `now` but not in `before`. */
const added = (before: Iterable<number>, now: Iterable<number>): number[] => {
  const b = new Set(before);
  return [...now].filter((c) => !b.has(c));
};

const conflictCheck: LatinPlugin = {
  id: "sudoku.conflicts",
  name: "highlight conflicts",
  description: "mark digits that clash with another digit or break a rule, and react when a move causes one.",
  category: "checks",
  appliesTo: LATIN_IDS,
  enabledByDefault: true,
  settings: defineSchema({
    rules: { type: "bool", label: "check cages, lines and other clues too", default: true },
  }),
  setup({ session, settings, owner }) {
    const rules = settings.rules as boolean;
    const of = (s: GridState) => conflicts(modelOf(session.puzzle), s.values, rules);
    session.hooks.derive.tap((d, { state }) => ({ ...d, [CONFLICTS]: [...of(state)] }), { owner });
    session.hooks.change.tap(({ prev, state, cause, source }) => {
      if (cause !== "action" || source?.kind !== "player" || prev.values === state.values) return;
      const fresh = added(of(prev), of(state));
      if (fresh.length) session.hooks.fx.call({ kind: "mistake", focus: { cells: fresh, areas: [], place: [], eliminate: [], level: 2 } });
    }, { owner });
  },
};

const wrongDigits = (p: LatinPuzzle, s: GridState): number[] => {
  const sol = solutionOf(p);
  return sol ? s.values.flatMap((v, c) => (v && !p.givens[c] && v !== sol[c] ? [c] : [])) : [];
};

const mistakeCheck: LatinPlugin = {
  id: "sudoku.mistakes",
  name: "highlight mistakes",
  description: "mark placed digits that differ from the solution, even when nothing clashes yet, and react when you place one.",
  category: "checks",
  appliesTo: LATIN_IDS,
  enabledByDefault: false,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => ({ ...d, [MISTAKES]: wrongDigits(puzzle, state) }), { owner });
    session.hooks.change.tap(({ prev, state, cause, source }) => {
      if (cause !== "action" || source?.kind !== "player" || prev.values === state.values) return;
      // clashes already get their own mistake event from the conflict check
      const clash = conflicts(modelOf(session.puzzle), state.values);
      const fresh = added(wrongDigits(session.puzzle, prev), wrongDigits(session.puzzle, state)).filter((c) => !clash.has(c));
      if (fresh.length) session.hooks.fx.call({ kind: "mistake", focus: { cells: fresh, areas: [], place: [], eliminate: [], level: 2 } });
    }, { owner });
  },
};

const mistakesFirst: LatinPlugin = {
  id: "sudoku.hint-mistakes",
  name: "hints check your digits first",
  description: "if a placed digit is wrong, the hint points that out (and applying it erases them) before suggesting any technique.",
  category: "checks",
  appliesTo: LATIN_IDS,
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => mistakeHint(puzzle, state) ?? undefined, { owner, priority: 50 });
  },
};

/** The highlighted digit: the one picked for highlighting, else the selected cell's digit. */
export function focusDigit(state: GridState, it: GridInteraction): number {
  return it.highlight || (state.values[it.cursor] ?? 0);
}

const sameDigit: LatinPlugin = {
  id: "sudoku.same-digit",
  name: "highlight a digit",
  description: "light up a digit everywhere: the selected cell's digit, or one you pick with the digit highlighter or the highlight commands.",
  category: "highlighting",
  appliesTo: LATIN_IDS,
  enabledByDefault: true,
  settings: defineSchema({
    marks: { type: "bool", label: "also in pencil marks and candidates", default: true },
    seen: { type: "bool", label: "shade cells where it can't go", default: false },
    possible: { type: "bool", label: "outline empty cells where it can still go", default: false },
  }),
  setup({ session, settings, owner }) {
    const marks = settings.marks as boolean, seen = settings.seen as boolean, possible = settings.possible as boolean;
    session.hooks.derive.tap((d, { puzzle, state, interaction }) => {
      const digit = focusDigit(state, interaction);
      if (!digit) return d;
      const cells = state.values.flatMap((v, c) => (v === digit ? [c] : []));
      const m = modelOf(puzzle);
      let open: number[] | undefined;
      if (possible) {
        const masks = peerCandidates(m, state.values, state.struck);
        open = masks.flatMap((mask, c) => (!state.values[c] && mask & bit(digit) ? [c] : []));
      }
      const same: SameDigit = { digit, cells, marks, open };
      if (!seen) return { ...d, [SAME]: same };
      const blocked = new Set<number>();
      for (const c of cells) for (const p of m.peers[c]!) if (!state.values[p]) blocked.add(p);
      return { ...d, [SAME]: same, [PEERS]: [...new Set([...((d[PEERS] as number[] | undefined) ?? []), ...blocked])] };
    }, { owner, priority: 5 });
  },
};

const BASIC = new Set(["row", "col", "box"]);

function peerTap(api: Api, pick: (m: Model, c: number) => number[]): void {
  api.session.hooks.derive.tap((d, { puzzle, interaction }) => {
    if (interaction.selection.length !== 1) return d;
    const c = interaction.selection[0]!;
    const peers = pick(modelOf(puzzle), c);
    return { ...d, [PEERS]: [...new Set([...((d[PEERS] as number[] | undefined) ?? []), ...peers])].filter((x) => x !== c) };
  }, { owner: api.owner });
}

const housePeers = (m: Model, c: number) => m.houseOf[c]!.filter((h) => BASIC.has(m.houses[h]!.kind)).flatMap((h) => m.houses[h]!.cells);

const peerHighlight: LatinPlugin = {
  id: "sudoku.peers",
  name: "highlight row, column and box",
  description: "shade the cells that share a row, column or box with the selected cell.",
  category: "highlighting",
  appliesTo: LATIN_IDS,
  enabledByDefault: true,
  setup: (api) => peerTap(api, housePeers),
};

const linkHighlight: LatinPlugin = {
  id: "sudoku.links",
  name: "highlight other cells it sees",
  description: "also shade cells the selected cell can't repeat a digit with for other reasons: diagonals, knight's or king's moves, cages.",
  category: "highlighting",
  appliesTo: LATIN_IDS,
  requires: ["links"],
  enabledByDefault: true,
  setup: (api) => peerTap(api, (m, c) => {
    const basic = new Set(housePeers(m, c));
    return m.peers[c]!.filter((x) => !basic.has(x));
  }),
};

export const latinPlugins: LatinPlugin[] = [
  autoCandidates, practiceCandidates, autoRemove, conflictCheck, mistakeCheck, mistakesFirst, sameDigit, peerHighlight, linkHighlight,
];
