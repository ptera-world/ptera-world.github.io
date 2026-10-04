import type { Rng } from "../core/rng";

/**
 * A random path through every cell of a w×h grid, moving between orthogonal neighbours, as cell
 * ids (y*w + x) in path order. Deterministic in (w, h, rng state, rounds). More rounds mix more.
 */
export function randomHamiltonPath(w: number, h: number, rng: Rng, rounds = 0): number[] {
  const n = w * h;
  const path: number[] = [];
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) path.push(y * w + (y % 2 ? w - 1 - i : i));
  if (n < 3) return path;
  const index = new Int32Array(n);
  path.forEach((c, i) => { index[c] = i; });
  const nbrs = (c: number) => {
    const x = c % w, y = Math.floor(c / w), out: number[] = [];
    if (y > 0) out.push(c - w);
    if (x < w - 1) out.push(c + 1);
    if (y < h - 1) out.push(c + w);
    if (x > 0) out.push(c - 1);
    return out;
  };
  const reverse = (from: number, to: number) => {
    for (let a = from, b = to; a < b; a++, b--) {
      const t = path[a]!;
      path[a] = path[b]!;
      path[b] = t;
      index[path[a]!] = a;
      index[path[b]!] = b;
    }
  };
  const total = rounds || n * 20;
  for (let r = 0; r < total; r++) {
    if (rng.bool()) {
      const e = path[0]!;
      const m = rng.pick(nbrs(e));
      const i = index[m]!;
      if (i === 1) continue;
      reverse(0, i - 1);
    } else {
      const e = path[n - 1]!;
      const m = rng.pick(nbrs(e));
      const i = index[m]!;
      if (i === n - 2) continue;
      reverse(i + 1, n - 1);
    }
  }
  return path;
}
