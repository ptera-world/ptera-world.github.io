import { BALL, EMPTY, UNKNOWN, entryAt, entryOf, fireAt, hitCode, reflectCode } from "./beam";

const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

/** What the player has learned: which lasers came out where, and how many balls there may be. */
export interface Evidence {
  w: number;
  h: number;
  minBalls: number;
  maxBalls: number;
  /** Fired entries and their outcomes. */
  shots: readonly (readonly [number, number])[];
}

/**
 * A set of ball layouts that all agree with every shot: these balls, these known-empty cells, and
 * between `least` and `most` more balls anywhere among `free` (cells no shot's beam depends on).
 */
export interface Family {
  balls: number[];
  free: number[];
  least: number;
  most: number;
}

export interface Families {
  list: Family[];
  /** True if `list` covers every layout that agrees with the shots. */
  complete: boolean;
}

/** Largest number of search nodes tried before giving up on finding every family. */
const NODE_LIMIT = 1_500_000;

/**
 * Every layout that agrees with the shots, grouped into families. The search follows each shot's
 * beam through the cells decided so far and branches on the first undecided cell a beam needs, so
 * cells no beam ever needs stay free. Families are found in order of how many balls the beams
 * need, fewest first.
 */
export function families(e: Evidence): Families {
  const { w, h } = e;
  const n = w * h;
  const know = new Uint8Array(n);
  const out: Family[] = [];
  const S = e.shots.length;
  const hit = hitCode(w, h), reflect = reflectCode(w, h);
  const xs = new Int32Array(S), ys = new Int32Array(S), dirs = new Int32Array(S), stage = new Int8Array(S), result = new Int32Array(S).fill(-1);
  e.shots.forEach(([entry], k) => {
    const at = entryAt(w, h, entry);
    xs[k] = at.x; ys[k] = at.y; dirs[k] = at.dir;
  });
  let needed = -1;
  const look = (k: number, side: number): number => {
    const d = dirs[k]!;
    let nx = xs[k]! + DX[d]!, ny = ys[k]! + DY[d]!;
    if (side) {
      const sd = (d + side + 4) % 4;
      nx += DX[sd]!;
      ny += DY[sd]!;
    }
    if (nx < 1 || ny < 1 || nx > w || ny > h) return EMPTY;
    const c = (ny - 1) * w + (nx - 1);
    const v = know[c]!;
    if (v === UNKNOWN) needed = c;
    return v;
  };
  /** Moves shot k on as far as the decided cells allow; the cell it needs next goes in `needed`. */
  const advance = (k: number): void => {
    for (let guard = 0; guard < 4 * (w + 2) * (h + 2); guard++) {
      if (stage[k] === 0) {
        const f = look(k, 0);
        if (f === UNKNOWN) return;
        if (f === BALL) { result[k] = hit; return; }
        const l = look(k, -1), r = look(k, 1);
        if (l === BALL || r === BALL) { result[k] = reflect; return; }
        if (l === UNKNOWN || r === UNKNOWN) return;
        xs[k] = xs[k]! + DX[dirs[k]!]!;
        ys[k] = ys[k]! + DY[dirs[k]!]!;
        stage[k] = 1;
        continue;
      }
      const out = entryOf(w, h, xs[k]!, ys[k]!);
      if (out >= 0) { result[k] = out === e.shots[k]![0] ? reflect : out; return; }
      const f = look(k, 0);
      if (f === UNKNOWN) return;
      if (f === BALL) { result[k] = hit; return; }
      const l = look(k, -1);
      if (l === UNKNOWN) return;
      if (l === BALL) { dirs[k] = (dirs[k]! + 1) % 4; continue; }
      const r = look(k, 1);
      if (r === UNKNOWN) return;
      if (r === BALL) { dirs[k] = (dirs[k]! + 3) % 4; continue; }
      xs[k] = xs[k]! + DX[dirs[k]!]!;
      ys[k] = ys[k]! + DY[dirs[k]!]!;
    }
    result[k] = reflect;
  };
  let nodes = 0, complete = true, balls = 0, budget = 0;
  const walk = (): void => {
    if (++nodes > NODE_LIMIT) { complete = false; return; }
    let pick = -1;
    for (let k = 0; k < S; k++) {
      if (result[k] === -1) {
        needed = -1;
        advance(k);
      }
      if (result[k] !== -1) {
        if (result[k] !== e.shots[k]![1]) return;
        continue;
      }
      pick = needed;
      break;
    }
    if (pick < 0) {
      if (balls !== budget) return;
      const free: number[] = [];
      for (let c = 0; c < n; c++) if (know[c] === UNKNOWN) free.push(c);
      const least = Math.max(0, e.minBalls - balls), most = Math.min(free.length, e.maxBalls - balls);
      if (least > most) return;
      out.push({ balls: Array.from(know).flatMap((v, c) => (v === BALL ? [c] : [])), free, least, most });
      return;
    }
    const saved = [xs.slice(), ys.slice(), dirs.slice(), stage.slice(), result.slice()] as const;
    for (const v of [EMPTY, BALL]) {
      if (v === BALL && balls >= budget) continue;
      know[pick] = v;
      if (v === BALL) balls++;
      walk();
      if (v === BALL) balls--;
      know[pick] = UNKNOWN;
      xs.set(saved[0]); ys.set(saved[1]); dirs.set(saved[2]); stage.set(saved[3]); result.set(saved[4]);
      if (!complete) return;
    }
  };
  for (budget = 0; budget <= e.maxBalls && complete; budget++) walk();
  return { list: out, complete };
}

const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
};

/** How many layouts a family holds. */
export function familySize(f: Family): number {
  let total = 0;
  for (let k = f.least; k <= f.most; k++) total += choose(f.free.length, k);
  return total;
}

/** Up to `limit` layouts from the families, in order. */
export function expand(fams: readonly Family[], limit: number): number[][] {
  const out: number[][] = [];
  for (const f of fams) {
    for (let k = f.least; k <= f.most && out.length < limit; k++) {
      const pick: number[] = [];
      const walk = (from: number) => {
        if (out.length >= limit) return;
        if (pick.length === k) {
          out.push([...f.balls, ...pick].sort((a, b) => a - b));
          return;
        }
        for (let i = from; i <= f.free.length - (k - pick.length); i++) {
          pick.push(f.free[i]!);
          walk(i + 1);
          pick.pop();
          if (out.length >= limit) return;
        }
      };
      walk(0);
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Every laser's outcome for a layout, as one comparable string. */
export function signature(w: number, h: number, balls: readonly number[]): string {
  const set = new Set(balls);
  const out: number[] = [];
  for (let i = 0; i < 2 * (w + h); i++) out.push(fireAt(w, h, set, i));
  return out.join(",");
}
