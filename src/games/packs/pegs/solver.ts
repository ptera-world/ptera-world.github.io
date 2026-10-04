export const HOLE = 0, PEG = 1, OBST = 2;

export interface Jump {
  from: number;
  over: number;
  to: number;
}

/** Every legal jump on the board, in cell order. */
export function jumps(w: number, h: number, grid: ArrayLike<number>): Jump[] {
  const out: Jump[] = [];
  for (let c = 0; c < grid.length; c++) {
    if (grid[c] !== PEG) continue;
    const x = c % w, y = Math.floor(c / w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x2 = x + 2 * dx, y2 = y + 2 * dy;
      if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue;
      const over = c + dy * w + dx, to = y2 * w + x2;
      if (grid[over] === PEG && grid[to] === HOLE) out.push({ from: c, over, to });
    }
  }
  return out;
}

export interface Search {
  /** Jumps that leave one peg, or null. */
  path: Jump[] | null;
  /** True when no such sequence exists (the search ran to the end). */
  impossible: boolean;
}

const BUDGET = 300_000;

/** Depth-first search for a sequence of jumps leaving one peg, remembering dead positions. */
export function findSolution(w: number, h: number, grid0: readonly number[], budget = BUDGET): Search {
  const cells: number[] = [];
  grid0.forEach((v, c) => { if (v !== OBST) cells.push(c); });
  const g = Uint8Array.from(grid0);
  let pegs = g.reduce((a, v) => a + (v === PEG ? 1 : 0), 0);
  const dead = new Set<string>();
  const key = () => {
    let s = "";
    for (let i = 0; i < cells.length; i += 16) {
      let v = 0;
      for (let j = i; j < i + 16 && j < cells.length; j++) v = (v << 1) | (g[cells[j]!] === PEG ? 1 : 0);
      s += String.fromCharCode(v);
    }
    return s;
  };
  let nodes = 0, cut = false;
  const path: Jump[] = [];
  const go = (): boolean => {
    if (pegs === 1) return true;
    const k = key();
    if (dead.has(k)) return false;
    if (++nodes > budget) { cut = true; return false; }
    for (const j of jumps(w, h, g)) {
      g[j.from] = HOLE; g[j.over] = HOLE; g[j.to] = PEG; pegs--;
      path.push(j);
      if (go()) return true;
      path.pop();
      g[j.from] = PEG; g[j.over] = PEG; g[j.to] = HOLE; pegs++;
      if (cut) return false;
    }
    dead.add(k);
    return false;
  };
  const found = go();
  return { path: found ? path.slice() : null, impossible: !found && !cut };
}

export interface PegsLike {
  w: number;
  h: number;
  grid: number[];
  solution?: [number, number][];
}

const pathCache = new WeakMap<PegsLike, Map<string, Jump[]>>();

/** The stored solution, indexed by every position along it. */
function knownPath(p: PegsLike): Map<string, Jump[]> {
  let m = pathCache.get(p);
  if (m) return m;
  m = new Map();
  if (p.solution) {
    const g = p.grid.slice();
    const seq: Jump[] = [];
    for (const [from, to] of p.solution) {
      const j = jumps(p.w, p.h, g).find((x) => x.from === from && x.to === to);
      if (!j) { seq.length = 0; break; }
      seq.push(j);
      g[j.from] = HOLE; g[j.over] = HOLE; g[j.to] = PEG;
    }
    const walk = p.grid.slice();
    seq.forEach((j, i) => {
      m!.set(walk.join(""), seq.slice(i));
      walk[j.from] = HOLE; walk[j.over] = HOLE; walk[j.to] = PEG;
    });
  }
  pathCache.set(p, m);
  return m;
}

const searchCache = new WeakMap<readonly number[], Search>();
const HINT_BUDGET = 150_000;

/** A way to one peg from `grid`: the stored one while still on it, else a fresh search (cached). */
export function solveFrom(p: PegsLike, grid: readonly number[]): Search {
  let r = searchCache.get(grid);
  if (r) return r;
  const known = knownPath(p).get(grid.join(""));
  r = known ? { path: known, impossible: false } : findSolution(p.w, p.h, grid, HINT_BUDGET);
  searchCache.set(grid, r);
  return r;
}
