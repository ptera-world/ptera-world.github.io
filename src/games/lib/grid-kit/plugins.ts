import { defineSchema, type BoolField } from "../../core/schema";
import type { Action, Hint, Plugin, PuzzleRef } from "../../core/types";
import type { Focus } from "./names";

/** Rule breaks by kind; each kind lists what to flag (cells, unless the puzzle maps them with `cells`). */
export type Conflicts = Record<string, number[]>;

export interface ConflictKind {
  id: string;
  /** Settings label for showing this kind. */
  label: string;
}

/**
 * Shows rule breaks visible without knowing the answer (derived under `key`), and reports the
 * ones a player move just made as a mistake fx.
 */
export function conflictsPlugin<Pz, S>(o: {
  id: string;
  puzzle: PuzzleRef;
  description: string;
  key: string;
  kinds: readonly ConflictKind[];
  find(p: Pz, s: S): Conflicts;
  /** Cells to point the mistake fx at for a kind's flagged items. Default: the items are cells. */
  cells?(p: Pz, kind: string, items: number[]): number[];
}): Plugin<Pz, S, any, any, Record<string, BoolField>> {
  return {
    id: o.id,
    name: "show conflicts",
    description: o.description,
    category: "assists",
    appliesTo: [o.puzzle],
    enabledByDefault: true,
    settings: defineSchema(Object.fromEntries(o.kinds.map((k) => [k.id, { type: "bool" as const, label: k.label, default: true }]))),
    setup({ session, settings, owner }) {
      const shown = (s: S): Conflicts => {
        const all = o.find(session.puzzle, s);
        return Object.fromEntries(o.kinds.map((k) => [k.id, settings[k.id] ? all[k.id] ?? [] : []]));
      };
      session.hooks.derive.tap((d, { state }) => ({ ...d, [o.key]: shown(state) }), { owner });
      session.hooks.change.tap(({ prev, state, cause, source }) => {
        if (cause !== "action" || source?.kind !== "player") return;
        const before = shown(prev), after = shown(state);
        const fresh = (k: ConflictKind) => after[k.id]!.filter((c) => !before[k.id]!.includes(c));
        const cells = [...new Set(o.kinds.flatMap((k) => (o.cells ? o.cells(session.puzzle, k.id, fresh(k)) : fresh(k))))];
        if (cells.length) session.hooks.fx.call({ kind: "mistake", focus: { cells, because: [] } satisfies Focus });
      }, { owner });
    },
  };
}

/** Runs ahead of technique hints (which tap at priority 100), so a wrong mark is pointed out before any move. */
export function checkMarksPlugin<Pz, S, A extends Action>(o: { id: string; puzzle: PuzzleRef; description: string; wrong(p: Pz, s: S): Hint<A> | null }): Plugin<Pz, S> {
  return {
    id: o.id,
    name: "hints check your marks first",
    description: o.description,
    category: "assists",
    appliesTo: [o.puzzle],
    enabledByDefault: true,
    setup({ session, owner }) {
      session.hooks.hint.tap(({ puzzle, state }) => (o.wrong(puzzle, state) as Hint<never> | null) ?? undefined, { owner, priority: 90 });
    },
  };
}
