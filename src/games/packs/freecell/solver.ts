import { buildsDownAlternating, rankOf, suitOf, isRed } from "../../lib/cards/deck";

/**
 * A FreeCell position for searching: columns bottom first, free cells (-1 empty), and the top
 * rank on each suit's foundation (0 empty). Pile numbers in moves are the game's: free cells
 * first, then the four foundations (one per suit), then the columns.
 */
export interface Pos {
  cols: number[][];
  cells: number[];
  found: number[];
}

export interface Move {
  from: number;
  to: number;
  n: number;
}

export interface Search {
  /** Moves that win from the position, or null. */
  path: Move[] | null;
  /** The search ran out without a budget cut: no win exists. */
  impossible: boolean;
  nodes: number;
}

export const cellPile = (_p: Pos, i: number): number => i;
export const foundPile = (p: Pos, suit: number): number => p.cells.length + suit;
export const colPile = (p: Pos, j: number): number => p.cells.length + 4 + j;

/** Cards at the top of a column that already form one movable run. */
export function runLength(col: readonly number[]): number {
  let k = col.length ? 1 : 0;
  while (k < col.length && buildsDownAlternating(col[col.length - k]!, col[col.length - k - 1]!)) k++;
  return k;
}

/** How many cards may move together: (free cells + 1) doubled for each spare empty column. */
export function capacity(p: Pos, toEmpty: boolean): number {
  const free = p.cells.filter((c) => c < 0).length;
  const empty = p.cols.filter((c) => !c.length).length - (toEmpty ? 1 : 0);
  return (free + 1) * 2 ** Math.max(0, empty);
}

/** A card nothing could ever need to build on again: both foundations of the other color are within one rank. */
export function isSafeHome(found: readonly number[], card: number): boolean {
  const r = rankOf(card);
  if (found[suitOf(card)] !== r - 1) return false;
  if (r <= 2) return true;
  const red = isRed(card);
  for (let s = 0; s < 4; s++) if ((s === 1 || s === 2) !== red && found[s]! < r - 1) return false;
  return true;
}

export const clonePos = (p: Pos): Pos => ({ cols: p.cols.map((c) => c.slice()), cells: p.cells.slice(), found: p.found.slice() });

/** Apply a move in place (no checks). */
export function applyMove(p: Pos, m: Move): void {
  const C = p.cells.length;
  const take = (pile: number, n: number): number[] => {
    if (pile < C) { const c = p.cells[pile]!; p.cells[pile] = -1; return [c]; }
    if (pile < C + 4) { const s = pile - C; const c = s * 13 + p.found[s]! - 1; p.found[s]!--; return [c]; }
    const col = p.cols[pile - C - 4]!;
    return col.splice(col.length - n, n);
  };
  const cards = take(m.from, m.n);
  if (m.to < C) p.cells[m.to] = cards[0]!;
  else if (m.to < C + 4) p.found[m.to - C]!++;
  else p.cols[m.to - C - 4]!.push(...cards);
}

/** Calls `visit` with every safe move home, scanning free cells then columns, until it returns true. */
export function eachSafeHomeMove(p: Pos, visit: (m: Move) => boolean | void): void {
  const C = p.cells.length;
  for (let i = 0; i < C; i++) {
    const c = p.cells[i]!;
    if (c >= 0 && isSafeHome(p.found, c) && visit({ from: i, to: C + suitOf(c), n: 1 }) === true) return;
  }
  for (let j = 0; j < p.cols.length; j++) {
    const col = p.cols[j]!;
    const c = col[col.length - 1];
    if (c !== undefined && isSafeHome(p.found, c) && visit({ from: C + 4 + j, to: C + suitOf(c), n: 1 }) === true) return;
  }
}

/** The first safe move home, scanning free cells then columns, or null. */
export function safeHomeMove(p: Pos): Move | null {
  let found: Move | null = null;
  eachSafeHomeMove(p, (m) => { found = m; return true; });
  return found;
}

/** Every legal move worth searching (never a whole column into an empty one, only the first empty column or cell). */
export function moves(p: Pos): Move[] {
  const C = p.cells.length;
  const out: Move[] = [];
  const firstEmptyCol = p.cols.findIndex((c) => !c.length);
  const firstFreeCell = p.cells.indexOf(-1);
  const capTo = capacity(p, false), capEmpty = capacity(p, true);
  const fits = (c: number) => p.found[suitOf(c)] === rankOf(c) - 1;
  for (let i = 0; i < C; i++) {
    const c = p.cells[i]!;
    if (c < 0) continue;
    if (fits(c)) out.push({ from: i, to: C + suitOf(c), n: 1 });
    for (let j = 0; j < p.cols.length; j++) {
      const col = p.cols[j]!;
      if (col.length && buildsDownAlternating(c, col[col.length - 1]!)) out.push({ from: i, to: C + 4 + j, n: 1 });
    }
    if (firstEmptyCol >= 0) out.push({ from: i, to: C + 4 + firstEmptyCol, n: 1 });
  }
  for (let i = 0; i < p.cols.length; i++) {
    const col = p.cols[i]!;
    if (!col.length) continue;
    const top = col[col.length - 1]!;
    if (fits(top)) out.push({ from: C + 4 + i, to: C + suitOf(top), n: 1 });
    const run = runLength(col);
    for (let j = 0; j < p.cols.length; j++) {
      if (j === i) continue;
      const dst = p.cols[j]!;
      if (dst.length) {
        const k = rankOf(dst[dst.length - 1]!) - rankOf(top);
        if (k >= 1 && k <= run && k <= capTo && buildsDownAlternating(col[col.length - k]!, dst[dst.length - 1]!)) out.push({ from: C + 4 + i, to: C + 4 + j, n: k });
      } else if (j === firstEmptyCol) {
        for (let k = Math.min(run, capEmpty, col.length - 1); k >= 1; k--) out.push({ from: C + 4 + i, to: C + 4 + j, n: k });
      }
    }
    if (firstFreeCell >= 0) out.push({ from: C + 4 + i, to: firstFreeCell, n: 1 });
  }
  return out;
}

export function isLegal(p: Pos, m: Move): boolean {
  const C = p.cells.length;
  const cardsAt = (pile: number): number[] => {
    if (pile < C) return p.cells[pile]! >= 0 ? [p.cells[pile]!] : [];
    if (pile < C + 4) return [];
    return p.cols[pile - C - 4] ?? [];
  };
  if (m.from === m.to || m.n < 1 || m.from >= C + 4 + p.cols.length || m.to >= C + 4 + p.cols.length) return false;
  if (m.from >= C && m.from < C + 4) return false;
  const src = cardsAt(m.from);
  if (m.n > src.length) return false;
  if (m.from < C && m.n !== 1) return false;
  if (m.from >= C + 4 && m.n > runLength(src)) return false;
  const lead = src[src.length - m.n]!;
  if (m.to < C) return m.n === 1 && p.cells[m.to]! < 0;
  if (m.to < C + 4) return m.n === 1 && suitOf(lead) === m.to - C && p.found[m.to - C] === rankOf(lead) - 1;
  const dst = p.cols[m.to - C - 4]!;
  if (!dst.length) return m.n <= capacity(p, true);
  return m.n <= capacity(p, false) && buildsDownAlternating(lead, dst[dst.length - 1]!);
}

const home = (p: Pos) => p.found[0]! + p.found[1]! + p.found[2]! + p.found[3]!;
export const isWon = (p: Pos): boolean => home(p) === 52;

function key(p: Pos): string {
  const cols = p.cols.map((c) => String.fromCharCode(...c.map((x) => x + 48))).sort();
  const cells = p.cells.filter((c) => c >= 0).sort((a, b) => a - b);
  return `${p.found.join("")}|${String.fromCharCode(...cells.map((x) => x + 48))}|${cols.join(",")}`;
}

/** Lower is closer to winning. */
function score(p: Pos): number {
  let h = (52 - home(p)) * 4;
  for (let s = 0; s < 4; s++) {
    const r = p.found[s]!;
    if (r === 13) continue;
    const want = s * 13 + r;
    for (const col of p.cols) {
      const at = col.indexOf(want);
      if (at >= 0) { h += (col.length - 1 - at) * 2; break; }
    }
  }
  for (const c of p.cells) if (c >= 0) h += 1;
  for (const col of p.cols) {
    if (!col.length) { h -= 2; continue; }
    for (let i = 1; i < col.length; i++) if (!buildsDownAlternating(col[i]!, col[i - 1]!)) h += 1;
  }
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
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        let mf = last.f;
        if (l < a.length && a[l]!.f < mf) { m = l; mf = a[l]!.f; }
        if (r < a.length && a[r]!.f < mf) m = r;
        if (m === i) break;
        a[i] = a[m]!;
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

/** Every safe move home, applied in place; returns them. */
function autoHome(p: Pos): Move[] {
  const out: Move[] = [];
  for (let m = safeHomeMove(p); m; m = safeHomeMove(p)) { applyMove(p, m); out.push(m); }
  return out;
}

export const BUDGET = 150_000;

/**
 * Best-first search for a win, safe moves home always taken first. Deterministic for a given
 * position and budget (nodes expanded).
 */
export function solve(start: Pos, budget = BUDGET): Search {
  const pos = clonePos(start);
  const first = autoHome(pos);
  const seen = new Set<string>([key(pos)]);
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
    for (const m of moves(n.pos)) {
      const q = clonePos(n.pos);
      applyMove(q, m);
      const auto = autoHome(q);
      const k = key(q);
      if (seen.has(k)) continue;
      seen.add(k);
      open.push({ pos: q, moves: [m, ...auto], parent: n, f: score(q) + (n.g + 1) * 0.5, g: n.g + 1 });
    }
  }
  return { path: null, impossible: true, nodes };
}
