import { buildsDownAlternating, isRed, rankOf, suitOf } from "../../lib/cards/deck";

/**
 * A Klondike position for searching. Pile numbers in moves are the game's: 0 stock, 1 waste,
 * 2–5 foundations (clubs, diamonds, hearts, spades), 6–12 columns.
 */
export interface Pos {
  /** Bottom first; the last card is drawn next. */
  stock: number[];
  /** Bottom first; the last card is the one in play. */
  waste: number[];
  /** Top rank per suit, 0 when empty. */
  found: number[];
  cols: number[][];
  /** Face-down cards at the bottom of each column. */
  down: number[];
  /** Times the waste has been turned back into the stock. */
  recycles: number;
}

export interface Rules {
  draw: number;
  /** Passes through the stock allowed; 0 for no limit. */
  passes: number;
}

export const STOCK = 0, WASTE = 1, FOUND = 2, COLS = 6;

/** One step of a plan: click the stock `draws` times, then make the move (if any). */
export interface Move {
  draws: number;
  from: number;
  to: number;
  n: number;
}

export interface Search {
  path: Move[] | null;
  impossible: boolean;
  nodes: number;
}

export const clonePos = (p: Pos): Pos => ({
  stock: p.stock.slice(), waste: p.waste.slice(), found: p.found.slice(),
  cols: p.cols.map((c) => c.slice()), down: p.down.slice(), recycles: p.recycles,
});

export const canRecycle = (r: Rules, recycles: number): boolean => r.passes === 0 || recycles < r.passes - 1;

/** One click on the stock: draw, or turn the waste over when the stock is empty. False if neither is possible. */
export function click(p: Pos, r: Rules): boolean {
  if (p.stock.length) {
    for (let i = 0; i < r.draw && p.stock.length; i++) p.waste.push(p.stock.pop()!);
    return true;
  }
  if (p.waste.length && canRecycle(r, p.recycles)) {
    p.stock = p.waste.reverse();
    p.waste = [];
    p.recycles++;
    return true;
  }
  return false;
}

const fits = (p: Pos, c: number) => p.found[suitOf(c)] === rankOf(c) - 1;

/** A card nothing could ever need to build on again. */
export function isSafeHome(found: readonly number[], card: number): boolean {
  const r = rankOf(card);
  if (found[suitOf(card)] !== r - 1) return false;
  if (r <= 2) return true;
  const red = isRed(card);
  for (let s = 0; s < 4; s++) if ((s === 1 || s === 2) !== red && found[s]! < r - 1) return false;
  return true;
}

/** Apply a move in place (no checks). Uncovers a column's new top card. */
export function applyMove(p: Pos, m: Move, r: Rules): void {
  for (let i = 0; i < m.draws; i++) click(p, r);
  if (m.n === 0) return;
  let cards: number[];
  if (m.from === WASTE) cards = [p.waste.pop()!];
  else if (m.from < COLS) { const s = m.from - FOUND; cards = [s * 13 + p.found[s]! - 1]; p.found[s]!--; }
  else {
    const j = m.from - COLS;
    const col = p.cols[j]!;
    cards = col.splice(col.length - m.n, m.n);
    if (p.down[j]! >= col.length && col.length) p.down[j] = col.length - 1;
    if (!col.length) p.down[j] = 0;
  }
  if (m.to < COLS) p.found[m.to - FOUND]!++;
  else p.cols[m.to - COLS]!.push(...cards);
}

/** The first safe move home among the waste card and the column tops, or null. */
export function safeHomeMove(p: Pos): Move | null {
  const w = p.waste[p.waste.length - 1];
  if (w !== undefined && isSafeHome(p.found, w)) return { draws: 0, from: WASTE, to: FOUND + suitOf(w), n: 1 };
  for (let j = 0; j < p.cols.length; j++) {
    const col = p.cols[j]!;
    const c = col[col.length - 1];
    if (c !== undefined && isSafeHome(p.found, c)) return { draws: 0, from: COLS + j, to: FOUND + suitOf(c), n: 1 };
  }
  return null;
}

/**
 * Moves worth searching. Column-to-column moves only when they turn a card over, empty a column
 * for a king, or free a card that can then go home; a king only into the first empty column;
 * cards from a foundation (three and up) back onto a column; cards reachable by drawing come as
 * one step with their draws.
 */
export function moves(p: Pos, r: Rules): Move[] {
  const out: Move[] = [];
  const firstEmpty = p.cols.findIndex((c) => !c.length);
  const playsFor = (card: number, from: number, draws: number) => {
    if (fits(p, card)) out.push({ draws, from, to: FOUND + suitOf(card), n: 1 });
    for (let j = 0; j < p.cols.length; j++) {
      const col = p.cols[j]!;
      if (col.length && buildsDownAlternating(card, col[col.length - 1]!)) out.push({ draws, from, to: COLS + j, n: 1 });
    }
    if (firstEmpty >= 0 && rankOf(card) === 13) out.push({ draws, from, to: COLS + firstEmpty, n: 1 });
  };
  for (let i = 0; i < p.cols.length; i++) {
    const col = p.cols[i]!;
    if (!col.length) continue;
    const top = col[col.length - 1]!;
    if (fits(p, top)) out.push({ draws: 0, from: COLS + i, to: FOUND + suitOf(top), n: 1 });
    const u = p.down[i]!;
    for (let k = u; k < col.length; k++) {
      const lead = col[k]!;
      const whole = k === u;
      const freesHome = !whole && fits(p, col[k - 1]!);
      if (!whole && !freesHome) continue;
      if (whole && u === 0 && rankOf(lead) === 13) continue;
      for (let j = 0; j < p.cols.length; j++) {
        if (j === i) continue;
        const dst = p.cols[j]!;
        if (dst.length ? buildsDownAlternating(lead, dst[dst.length - 1]!) : j === firstEmpty && rankOf(lead) === 13) {
          out.push({ draws: 0, from: COLS + i, to: COLS + j, n: col.length - k });
        }
      }
    }
  }
  for (let s = 0; s < 4; s++) {
    const r0 = p.found[s]!;
    if (r0 < 3) continue;
    const card = s * 13 + r0 - 1;
    for (let j = 0; j < p.cols.length; j++) {
      const col = p.cols[j]!;
      if (col.length && buildsDownAlternating(card, col[col.length - 1]!)) out.push({ draws: 0, from: FOUND + s, to: COLS + j, n: 1 });
    }
  }
  const t = clonePos(p);
  const seen = new Set<number>();
  const limit = Math.ceil(p.stock.length / r.draw) + 1 + Math.ceil((p.stock.length + p.waste.length) / r.draw) + 1;
  for (let k = 0; k <= limit; k++) {
    if (k > 0 && !click(t, r)) break;
    const top = t.waste[t.waste.length - 1];
    if (top === undefined || seen.has(top)) continue;
    seen.add(top);
    playsFor(top, WASTE, k);
  }
  return out;
}

const home = (p: Pos) => p.found[0]! + p.found[1]! + p.found[2]! + p.found[3]!;
export const isWon = (p: Pos): boolean => home(p) === 52;

function key(p: Pos, r: Rules): string {
  const cols = p.cols.map((c, j) => `${p.down[j]}:${String.fromCharCode(...c.map((x) => x + 48))}`).sort();
  return `${p.found.join(",")}|${String.fromCharCode(...p.stock.map((x) => x + 48))}|${String.fromCharCode(...p.waste.map((x) => x + 48))}|${r.passes ? p.recycles : ""}|${cols.join(",")}`;
}

function score(p: Pos): number {
  let h = (52 - home(p)) * 4;
  for (const d of p.down) h += d * 3;
  for (const col of p.cols) if (!col.length) h -= 1;
  return h;
}

interface Node { pos: Pos; moves: Move[]; parent: Node | null; f: number; g: number }

class Heap {
  private a: Node[] = [];
  get size() { return this.a.length; }
  push(n: Node): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (a[j]!.f <= n.f) break;
      a[i] = a[j]!;
      i = j;
    }
    a[i] = n;
  }
  pop(): Node {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, rr = l + 1;
        let m = i, mf = last.f;
        if (l < a.length && a[l]!.f < mf) { m = l; mf = a[l]!.f; }
        if (rr < a.length && a[rr]!.f < mf) m = rr;
        if (m === i) break;
        a[i] = a[m]!;
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

function autoHome(p: Pos, r: Rules): Move[] {
  const out: Move[] = [];
  for (let m = safeHomeMove(p); m; m = safeHomeMove(p)) { applyMove(p, m, r); out.push(m); }
  return out;
}

/** Search cost of one stock click, against 1 per move: lines with fewer clicks come first. */
const DC = 2;
export const BUDGET = 60_000;

/** Best-first search for a win, safe moves home taken as soon as they appear. Deterministic per budget. */
export function solve(start: Pos, r: Rules, budget = BUDGET): Search {
  const pos = clonePos(start);
  const first = autoHome(pos, r);
  const seen = new Set<string>([key(pos, r)]);
  const open = new Heap();
  open.push({ pos, moves: first, parent: null, f: score(pos), g: 0 });
  let nodes = 0;
  while (open.size) {
    const n = open.pop();
    if (isWon(n.pos)) {
      const path: Move[] = [];
      for (let x: Node | null = n; x; x = x.parent) path.unshift(...x.moves);
      return { path, impossible: false, nodes };
    }
    if (++nodes > budget) return { path: null, impossible: false, nodes };
    for (const m of moves(n.pos, r)) {
      const q = clonePos(n.pos);
      applyMove(q, m, r);
      const auto = autoHome(q, r);
      const k = key(q, r);
      if (seen.has(k)) continue;
      seen.add(k);
      open.push({ pos: q, moves: [m, ...auto], parent: n, f: score(q) + (n.g + 1 + m.draws * DC) * 0.5, g: n.g + 1 + m.draws * DC });
    }
  }
  return { path: null, impossible: true, nodes };
}
