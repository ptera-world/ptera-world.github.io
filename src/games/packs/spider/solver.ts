import { rankOf, suitOf } from "../../lib/cards/deck";

/**
 * A Spider position for searching. Pile numbers in moves are the game's: 0 stock, then one pile per
 * suit to complete (`sets`), then the columns.
 */
export interface Pos {
  /** Bottom first; each deal takes the last cards, one per column, the very last going to the first column. */
  stock: number[];
  cols: number[][];
  down: number[];
  /** Completed suits so far, each as its 13 cards ace first. */
  done: number[][];
  /** How many runs complete the game: four per deck. */
  sets: number;
}

export const STOCK = 0, DONE = 1;

/** The pile number of the first column. */
export const colBase = (p: { sets: number }): number => DONE + p.sets;

/** A deal (from STOCK, n 0) or a run moving between columns. */
export interface Move {
  from: number;
  to: number;
  n: number;
}

export interface Search {
  path: Move[] | null;
  impossible: boolean;
  nodes: number;
}

/** Face (suit * 13 + rank − 1) of each card id. */
export type Faces = readonly number[];

export const clonePos = (p: Pos): Pos => ({ stock: p.stock.slice(), cols: p.cols.map((c) => c.slice()), down: p.down.slice(), done: p.done.map((d) => d.slice()), sets: p.sets });

const follows = (f: Faces, upper: number, lower: number) => rankOf(f[lower]!) === rankOf(f[upper]!) + 1;
const sameSuit = (f: Faces, a: number, b: number) => suitOf(f[a]!) === suitOf(f[b]!);

/** Face-up cards at the top of a column that run down in one suit and so move together. */
export function runLength(f: Faces, col: readonly number[], down: number): number {
  if (col.length <= down) return 0;
  let k = 1;
  while (col.length - k - 1 >= down && follows(f, col[col.length - k]!, col[col.length - k - 1]!) && sameSuit(f, col[col.length - k]!, col[col.length - k - 1]!)) k++;
  return k;
}

const flip = (p: Pos, j: number) => {
  const col = p.cols[j]!;
  if (p.down[j]! >= col.length) p.down[j] = Math.max(0, col.length - 1);
};

/** Lift off any column whose top 13 face-up cards run king to ace in one suit; returns how many. */
export function collect(f: Faces, p: Pos): number {
  let n = 0;
  for (let j = 0; j < p.cols.length; j++) {
    const col = p.cols[j]!;
    if (col.length >= 13 && runLength(f, col, p.down[j]!) >= 13 && rankOf(f[col[col.length - 13]!]!) === 13) {
      p.done.push(col.splice(col.length - 13, 13).reverse());
      flip(p, j);
      n++;
    }
  }
  return n;
}

/** Apply a move in place (no checks), collecting completed suits. */
export function applyMove(f: Faces, p: Pos, m: Move): void {
  if (m.from === STOCK) {
    for (let j = 0; j < p.cols.length && p.stock.length; j++) p.cols[j]!.push(p.stock.pop()!);
  } else {
    const i = m.from - colBase(p);
    const cards = p.cols[i]!.splice(p.cols[i]!.length - m.n, m.n);
    p.cols[m.to - colBase(p)]!.push(...cards);
    flip(p, i);
  }
  collect(f, p);
}

export function canDeal(p: Pos): boolean {
  return p.stock.length > 0 && p.cols.every((c) => c.length > 0);
}

export function isLegal(f: Faces, p: Pos, m: Move): boolean {
  if (m.from === STOCK) return m.to === STOCK && canDeal(p);
  const i = m.from - colBase(p), j = m.to - colBase(p);
  if (i < 0 || j < 0 || i >= p.cols.length || j >= p.cols.length || i === j || m.n < 1) return false;
  if (m.n > runLength(f, p.cols[i]!, p.down[i]!)) return false;
  const lead = p.cols[i]![p.cols[i]!.length - m.n]!;
  const dst = p.cols[j]!;
  return !dst.length || follows(f, lead, dst[dst.length - 1]!);
}

/**
 * Moves worth searching: whole runs onto any card one higher (or the first empty column, if
 * that uncovers something); part of a run only onto the same suit; a deal when allowed.
 */
export function moves(f: Faces, p: Pos): Move[] {
  const out: Move[] = [];
  const firstEmpty = p.cols.findIndex((c) => !c.length);
  const base = colBase(p);
  for (let i = 0; i < p.cols.length; i++) {
    const col = p.cols[i]!;
    const run = runLength(f, col, p.down[i]!);
    for (let k = 1; k <= run; k++) {
      const lead = col[col.length - k]!;
      for (let j = 0; j < p.cols.length; j++) {
        if (j === i) continue;
        const dst = p.cols[j]!;
        if (dst.length) {
          const top = dst[dst.length - 1]!;
          if (!follows(f, lead, top)) continue;
          if (k < run && !sameSuit(f, lead, top)) continue;
          // a whole run onto another suit is pointless when it already sits on a card one higher
          if (k === run && !sameSuit(f, lead, top) && col.length > k && p.down[i]! < col.length - k && follows(f, lead, col[col.length - k - 1]!)) continue;
          out.push({ from: base + i, to: base + j, n: k });
        } else if (j === firstEmpty && k === run && col.length > k) {
          out.push({ from: base + i, to: base + j, n: k });
        }
      }
    }
  }
  if (canDeal(p)) out.push({ from: STOCK, to: STOCK, n: 0 });
  return out;
}

export const isWon = (p: Pos): boolean => p.done.length === p.sets;

function key(f: Faces, p: Pos): string {
  const cols = p.cols.map((c, j) => `${p.down[j]}:${String.fromCharCode(...c.map((x) => f[x]! + 48))}`).sort();
  return `${p.stock.length}|${p.done.length}|${cols.join(",")}`;
}

function score(f: Faces, p: Pos): number {
  let h = (p.sets - p.done.length) * 40 + p.stock.length * 2;
  for (let j = 0; j < p.cols.length; j++) {
    const col = p.cols[j]!;
    h += p.down[j]! * 4;
    if (!col.length) { h -= 3; continue; }
    for (let i = Math.max(1, p.down[j]!); i < col.length; i++) {
      const a = col[i]!, b = col[i - 1]!;
      if (!follows(f, a, b)) h += 2;
      else if (!sameSuit(f, a, b)) h += 1;
    }
  }
  return h;
}

interface Node { pos: Pos; move: Move | null; parent: Node | null; f: number; g: number }

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
        let m = i, mf = last.f;
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

export const BUDGET = 40_000;

/** Best-first search for a win. Deterministic per budget (nodes expanded). */
export function solve(f: Faces, start: Pos, budget = BUDGET): Search {
  const pos = clonePos(start);
  const seen = new Set<string>([key(f, pos)]);
  const open = new Heap();
  open.push({ pos, move: null, parent: null, f: score(f, pos), g: 0 });
  let nodes = 0;
  while (open.size) {
    const n = open.pop();
    if (isWon(n.pos)) {
      const path: Move[] = [];
      for (let x: Node | null = n; x?.move; x = x.parent) path.unshift(x.move);
      return { path, impossible: false, nodes };
    }
    if (++nodes > budget) return { path: null, impossible: false, nodes };
    for (const m of moves(f, n.pos)) {
      const q = clonePos(n.pos);
      applyMove(f, q, m);
      const k = key(f, q);
      if (seen.has(k)) continue;
      seen.add(k);
      open.push({ pos: q, move: m, parent: n, f: score(f, q) + (n.g + 1) * 0.05, g: n.g + 1 });
    }
  }
  return { path: null, impossible: true, nodes };
}
