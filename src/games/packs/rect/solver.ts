/**
 * Rectangles solver: each number's possible rectangles, narrowed by rules. A rectangle is
 * "alive" until a rule rules it out; the puzzle is decided when every number has one left.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  w: number;
  h: number;
  /** Numbered cells, in index order. */
  clues: number[];
  /** Per clue, its possible rectangles. */
  boxes: Box[][];
  /** Per clue and box, the cells it covers. */
  cells: number[][][];
  /** Per cell, the (clue, box) pairs covering it. */
  coverers: [number, number][][];
}

/** Every rectangle of area n holding cell q and no other numbered cell. */
export function layout(w: number, h: number, nums: readonly number[]): Layout {
  const clues = nums.flatMap((v, i) => (v > 0 ? [i] : []));
  const isClue = new Uint8Array(w * h);
  for (const q of clues) isClue[q] = 1;
  const boxes: Box[][] = [], cells: number[][][] = [];
  const coverers: [number, number][][] = Array.from({ length: w * h }, () => []);
  clues.forEach((q, ci) => {
    const n = nums[q]!, qx = q % w, qy = Math.floor(q / w);
    const list: Box[] = [], covered: number[][] = [];
    for (let bw = 1; bw <= n; bw++) {
      if (n % bw) continue;
      const bh = n / bw;
      if (bw > w || bh > h) continue;
      for (let x = Math.max(0, qx - bw + 1); x <= Math.min(qx, w - bw); x++) {
        for (let y = Math.max(0, qy - bh + 1); y <= Math.min(qy, h - bh); y++) {
          const inside: number[] = [];
          let ok = true;
          for (let yy = y; yy < y + bh && ok; yy++) {
            for (let xx = x; xx < x + bw; xx++) {
              const c = yy * w + xx;
              if (c !== q && isClue[c]) {
                ok = false;
                break;
              }
              inside.push(c);
            }
          }
          if (!ok) continue;
          for (const c of inside) coverers[c]!.push([ci, list.length]);
          list.push({ x, y, w: bw, h: bh });
          covered.push(inside);
        }
      }
    }
    boxes.push(list);
    cells.push(covered);
  });
  return { w, h, clues, boxes, cells, coverers };
}

/** Alive flags per clue and box. */
export type Alive = Uint8Array[];

export const freshAlive = (l: Layout): Alive => l.boxes.map((b) => new Uint8Array(b.length).fill(1));
export const copyAlive = (a: Alive): Alive => a.map((x) => x.slice());

export interface Kill {
  kind: "owned" | "only-cover" | "trial";
  level: number;
  /** Boxes ruled out, as (clue, box). */
  boxes: [number, number][];
  /** The clue the reasoning is about. */
  clue: number;
  /** Cells the reasoning is about. */
  cells: number[];
}

/** Cells every alive box of clue ci covers. */
function owned(l: Layout, a: Alive, ci: number): number[] {
  let common: Set<number> | null = null;
  l.cells[ci]!.forEach((cells, bi) => {
    if (!a[ci]![bi]) return;
    const here = new Set(cells);
    common = common ? new Set([...common].filter((c) => here.has(c))) : here;
  });
  return common ? [...(common as Set<number>)] : [];
}

/**
 * Level-0 rules over a consistent snapshot of `a`: cells a number covers whichever way it goes
 * can't be covered by any other number; a cell only one number can reach must be covered by
 * one of that number's boxes. Calls `emit` per finding (true stops); returns false on a
 * contradiction (a number or a cell with nothing left).
 */
export function easyRules(l: Layout, a: Alive, emit: (k: Kill) => boolean, kinds: readonly Kill["kind"][] = ["owned", "only-cover"]): boolean {
  for (let ci = 0; ci < l.clues.length; ci++) if (!a[ci]!.some(Boolean)) return false;
  for (let c = 0; c < l.coverers.length; c++) if (!l.coverers[c]!.some(([ci, bi]) => a[ci]![bi])) return false;
  if (kinds.includes("owned")) {
    for (let ci = 0; ci < l.clues.length; ci++) {
      const mine = owned(l, a, ci);
      if (!mine.length) continue;
      const kill: [number, number][] = [];
      for (const c of mine) for (const [cj, bj] of l.coverers[c]!) if (cj !== ci && a[cj]![bj]) kill.push([cj, bj]);
      if (kill.length && emit({ kind: "owned", level: 0, boxes: dedupe(kill), clue: ci, cells: mine })) return true;
    }
  }
  if (kinds.includes("only-cover")) {
    for (let c = 0; c < l.coverers.length; c++) {
      const reaching = new Set(l.coverers[c]!.filter(([ci, bi]) => a[ci]![bi]).map(([ci]) => ci));
      if (reaching.size !== 1) continue;
      const ci = [...reaching][0]!;
      const kill: [number, number][] = [];
      l.cells[ci]!.forEach((cells, bi) => {
        if (a[ci]![bi] && !cells.includes(c)) kill.push([ci, bi]);
      });
      if (kill.length && emit({ kind: "only-cover", level: 0, boxes: kill, clue: ci, cells: [c] })) return true;
    }
  }
  return true;
}

function dedupe(list: [number, number][]): [number, number][] {
  const seen = new Set<string>();
  return list.filter(([a, b]) => {
    const k = `${a}:${b}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const kill = (a: Alive, boxes: readonly [number, number][]): boolean => {
  let changed = false;
  for (const [ci, bi] of boxes) {
    if (a[ci]![bi]) {
      a[ci]![bi] = 0;
      changed = true;
    }
  }
  return changed;
};

/** Level-0 rules to a fixpoint, in place; false on contradiction. */
export function settle(l: Layout, a: Alive): boolean {
  for (;;) {
    let changed = false;
    const ok = easyRules(l, a.map((x) => x.slice()), (k) => {
      changed = kill(a, k.boxes) || changed;
      return false;
    });
    if (!ok) return false;
    if (!changed) return easyRules(l, a, () => false);
  }
}

/** "Try it": a box whose choice runs level-0 rules into a contradiction is ruled out. Boxes in clue then box order. */
export function trialRule(l: Layout, a: Alive, emit: (k: Kill) => boolean): boolean {
  const base = copyAlive(a);
  if (!settle(l, base)) return false;
  for (let ci = 0; ci < l.clues.length; ci++) {
    if (base[ci]!.filter(Boolean).length < 2) continue;
    for (let bi = 0; bi < base[ci]!.length; bi++) {
      if (!base[ci]![bi]) continue;
      const t = copyAlive(base);
      t[ci]!.fill(0);
      t[ci]![bi] = 1;
      if (settle(l, t)) continue;
      if (emit({ kind: "trial", level: 1, boxes: [[ci, bi]], clue: ci, cells: l.cells[ci]![bi]! })) return true;
    }
  }
  return true;
}

export const decided = (a: Alive): boolean => a.every((x) => x.filter(Boolean).length === 1);

/** Everything up to `level` to a fixpoint, in place; false on contradiction. */
export function saturate(l: Layout, a: Alive, level: number): boolean {
  for (;;) {
    if (!settle(l, a)) return false;
    if (level < 1) return true;
    let changed = false;
    const ok = trialRule(l, a, (k) => {
      changed = kill(a, k.boxes) || changed;
      return false;
    });
    if (!ok) return false;
    if (!changed) return true;
  }
}

/** Least level ≤ maxLevel that decides every number, or null. */
export function levelNeeded(l: Layout, start: Alive, maxLevel: number): number | null {
  for (let level = 0; level <= maxLevel; level++) {
    const a = copyAlive(start);
    if (saturate(l, a, level) && decided(a)) return level;
  }
  return null;
}

/** Exhaustive search, counting solutions up to `limit`; `first` is the first found. */
export function countSolutions(l: Layout, start: Alive, limit = 2): { count: number; first: Alive | null } {
  const out = { count: 0, first: null as Alive | null };
  const search = (a: Alive): void => {
    if (out.count >= limit || !settle(l, a)) return;
    let pick = -1, best = Infinity;
    for (let ci = 0; ci < a.length; ci++) {
      const n = a[ci]!.filter(Boolean).length;
      if (n > 1 && n < best) {
        best = n;
        pick = ci;
      }
    }
    if (pick < 0) {
      out.count++;
      out.first ??= copyAlive(a);
      return;
    }
    for (let bi = 0; bi < a[pick]!.length; bi++) {
      if (!a[pick]![bi]) continue;
      const t = copyAlive(a);
      t[pick]!.fill(0);
      t[pick]![bi] = 1;
      search(t);
    }
  };
  search(copyAlive(start));
  return out;
}

/** The box index each clue ends up with, for a decided `a`. */
export const chosen = (a: Alive): number[] => a.map((x) => x.indexOf(1));
