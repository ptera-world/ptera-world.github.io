import type { Session } from "../../core/session";
import { bit } from "./engine/bits";
import { modelOf } from "./engine/model";
import { CANDIDATES } from "./keys";
import { peerCandidates } from "./plugins";
import type { GridAction, GridInteraction, GridState, InputMode, LatinPuzzle } from "./puzzle";

/** What the player edits with; every input path (keys, pad, menu) goes through these. */
export type LatinSession = Session<LatinPuzzle, GridState, GridAction, GridInteraction>;

export const MODES: readonly { id: InputMode; label: string; key: string }[] = [
  { id: "digit", label: "digit", key: "z" },
  { id: "corner", label: "corner", key: "x" },
  { id: "center", label: "centre", key: "c" },
  { id: "color", label: "colour", key: "v" },
];

/** Centre marks as the player sees them: computed candidates when shown, else their own marks. */
function shownCenter(session: LatinSession, c: number): number {
  const cands = session.derived()[CANDIDATES] as number[] | undefined;
  return cands ? cands[c]! : session.state.center[c]!;
}

/** Enter `dg` into the selection in `mode` (default: the current mode). Toggles when everything selected already has it. */
export function input(session: LatinSession, dg: number, mode: InputMode = session.interaction.mode): void {
  const p = session.puzzle;
  const st = session.state;
  const sel = session.interaction.selection;
  if (dg < 1 || dg > (mode === "color" ? 9 : p.n) || !sel.length) return;
  if (mode === "color") {
    const on = !sel.every((c) => st.colors[c]! & bit(dg));
    session.dispatch({ type: "color", cells: sel, color: dg, on });
    return;
  }
  if (mode === "digit") {
    const cells = sel.filter((c) => !p.givens[c]);
    if (!cells.length) return;
    const all = cells.every((c) => st.values[c] === dg);
    session.dispatch({ type: "set", cells, digit: all ? 0 : dg });
    return;
  }
  const cells = sel.filter((c) => !p.givens[c] && !st.values[c]);
  if (!cells.length) return;
  const has = (c: number) => ((mode === "center" ? shownCenter(session, c) : st.corner[c]!) & bit(dg)) !== 0;
  session.dispatch({ type: "mark", layer: mode, cells, digit: dg, on: !cells.every(has) });
}

/** Erase the most visible layer in the selection: colours in colour mode, else digits, then marks, then colours. */
export function erase(session: LatinSession): void {
  const p = session.puzzle;
  const st = session.state;
  const it = session.interaction;
  const cells = it.selection;
  if (!cells.length) return;
  const hasValue = cells.some((c) => !p.givens[c] && st.values[c]);
  const hasMarks = cells.some((c) => st.center[c] || st.corner[c] || st.struck[c]);
  const hasColor = cells.some((c) => st.colors[c]);
  const layer = it.mode === "color" && hasColor ? "colors" : hasValue ? "values" : hasMarks ? "marks" : hasColor ? "colors" : null;
  if (layer) session.dispatch({ type: "clear", cells, layer });
}

/** Write every remaining candidate as centre marks, in the selection (or every empty cell when one cell or none is selected). */
export function fillCandidates(session: LatinSession): void {
  const p = session.puzzle;
  const st = session.state;
  const sel = session.interaction.selection;
  const all = [...Array(p.n * p.n).keys()];
  const cells = (sel.length > 1 ? sel : all).filter((c) => !st.values[c]);
  const masks = peerCandidates(modelOf(p), st.values, st.struck);
  session.batch(() => {
    for (let d = 1; d <= p.n; d++) {
      const want = cells.filter((c) => masks[c]! & bit(d) && !(st.center[c]! & bit(d)));
      if (want.length) session.dispatch({ type: "mark", layer: "center", cells: want, digit: d, on: true });
    }
  });
}

export function setMode(session: LatinSession, mode: InputMode): void {
  session.setInteraction((i) => (i.mode === mode ? i : { ...i, mode }));
}

export function setSelection(session: LatinSession, cells: number[], cursor?: number): void {
  session.setInteraction((i) => ({ ...i, selection: cells, cursor: cursor ?? i.cursor }));
}

/** Pick `digit` to highlight everywhere; picking the highlighted digit again (or 0) goes back to following the selection. */
export function setHighlight(session: LatinSession, digit: number): void {
  session.setInteraction((i) => {
    const next = (i.highlight ?? 0) === digit ? 0 : digit;
    return (i.highlight ?? 0) === next ? i : { ...i, highlight: next };
  });
}

/** Move the highlight one digit up or down, wrapping, starting from whatever is highlighted now. */
export function stepHighlight(session: LatinSession, by: number): void {
  const n = session.puzzle.n;
  const it = session.interaction;
  const cur = it.highlight || session.state.values[it.cursor] || 0;
  const next = cur ? ((cur - 1 + by + n * 2) % n) + 1 : by > 0 ? 1 : n;
  session.setInteraction((i) => ({ ...i, highlight: next }));
}

export function selectSame(session: LatinSession, cell: number): void {
  const v = session.state.values[cell]!;
  if (!v) return setSelection(session, [cell], cell);
  setSelection(session, session.state.values.flatMap((x, c) => (x === v ? [c] : [])), cell);
}

export function move(session: LatinSession, dr: number, dc: number, extend: boolean): void {
  const n = session.puzzle.n;
  const it = session.interaction;
  const r = (Math.floor(it.cursor / n) + dr + n) % n, c = (it.cursor % n + dc + n) % n;
  const next = r * n + c;
  if (extend) setSelection(session, it.selection.includes(next) ? it.selection : [...it.selection, next], next);
  else setSelection(session, [next], next);
}
