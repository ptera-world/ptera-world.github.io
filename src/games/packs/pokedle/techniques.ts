import type { DataAttribute, Hint } from "../../core/types";
import { formatValue } from "../../lib/dataset/compare";
import type { PokemonItem } from "../../lib/pokemon/types";
import {
  candidates, ctxOf, firstRight, givenLabel, isOpen, isOver, solvedAt,
  type DataSource, type PokedleAction, type PokedleFocus, type PokedlePuzzle, type PokedleState,
} from "./logic";

/** Open, unsolved boards, while the game goes on. */
export function liveBoards(p: PokedlePuzzle, s: PokedleState): number[] {
  if (isOver(p, s)) return [];
  return p.boards.flatMap((_, b) => (isOpen(p, s, b) && solvedAt(p, s, b) < 0 ? [b] : []));
}

export function boardName(data: DataSource, p: PokedlePuzzle, b: number): string {
  if (p.boards.length === 1) return "the board";
  const g = givenLabel(ctxOf(data, p).data, p.boards[b]!.given);
  return g ? `the ${g} board` : `board ${b + 1}`;
}

const rowsOf = (p: PokedlePuzzle, s: PokedleState) => s.guesses.map((_, i) => i);

/** Values every one of `items` shares for an attribute, in words, or null. */
function shared(attr: DataAttribute, items: readonly PokemonItem[]): string | null {
  const vals = items.map((i) => i.values[attr.id] ?? null);
  if (attr.kind === "set") {
    const all = (vals[0] as string[] | null) ?? [];
    const common = all.filter((x) => vals.every((v) => Array.isArray(v) && v.includes(x)));
    return common.length ? `${attr.label}: ${formatValue(attr, common)}` : null;
  }
  if (attr.kind === "number" && vals.every((v) => typeof v === "number")) {
    const nums = vals as number[];
    const lo = Math.min(...nums), hi = Math.max(...nums);
    return lo === hi ? `${attr.label} ${formatValue(attr, lo)}` : `${attr.label} ${formatValue(attr, lo)} to ${formatValue(attr, hi)}`;
  }
  const first = JSON.stringify(vals[0]);
  if (!vals.every((v) => JSON.stringify(v) === first) || vals[0] === null) return null;
  return `${attr.label} ${formatValue(attr, vals[0]!)}`;
}

/**
 * When no technique applies: how many pokémon still fit the board with the fewest, and what they
 * all have in common (or, when only a few are left, which they are).
 */
export function fallbackHint(data: DataSource, p: PokedlePuzzle, s: PokedleState): Hint<PokedleAction> | null {
  const live = liveBoards(p, s);
  if (!live.length || !s.guesses.length) return null;
  const counted = live.map((b) => ({ b, cand: candidates(data, p, s, b) })).sort((x, y) => x.cand.length - y.cand.length || x.b - y.b);
  const { b, cand } = counted[0]!;
  const where = boardName(data, p, b);
  const n = cand.length;
  const head = `${n} pokémon ${n === 1 ? "fits" : "fit"} every mark on ${where}`;
  const focus: PokedleFocus = { board: b, guesses: rowsOf(p, s) };
  const c = ctxOf(data, p);
  // only what the marks settle without a green yet: what a green already shows isn't news
  const right = firstRight(data, p, s, b);
  const known = c.attrs.flatMap((a, i) => (right[i]! < 0 ? [shared(a, cand)] : [])).filter((x): x is string => !!x);
  const detail = n <= 6
    ? `${head}: ${cand.map((i) => i.name).join(", ")}`
    : known.length ? `${head}; they all have ${known.join("; ")}` : head;
  return { message: head, focus: { board: b }, level: 1, more: { message: detail, focus, level: 2 } };
}
