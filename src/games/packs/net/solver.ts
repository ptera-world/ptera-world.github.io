import { DIRS, degree, isTree, link, opp, orientations, type NetPuzzle } from "./grid";

/**
 * Deduction rules, in the order the solver prefers them. Every rule only removes orientations
 * that no valid solution can use, so a puzzle the solver fully determines has exactly one solution.
 *
 * - local: a side must stay shut if it faces the board edge, a barrier, or a neighbour that can't
 *   connect back; it must be open if the neighbour is certain to connect.
 * - deadend: two dead-end tiles can't point at each other (they'd form a closed pair).
 * - loop: an orientation can't join a tile to the same group twice (a solution is a tree).
 * - island: an orientation can't seal off a group smaller than the board, i.e. join groups such
 *   that no cell of the result could still open a side leading out of it.
 * - lookahead: an orientation whose assumption leads (via the rules above) to a contradiction is out.
 */
export type Rule = "local" | "deadend" | "loop" | "island" | "lookahead";
export type Tier = 1 | 2 | 3;

export const RULE_TIER: Record<Rule, Tier> = { local: 1, deadend: 1, loop: 2, island: 2, lookahead: 3 };
/** Easiest first. */
export const RULES = Object.keys(RULE_TIER) as Rule[];
const tierRules = (t: Tier): Set<Rule> => new Set(RULES.filter((r) => RULE_TIER[r] <= t));

export interface Step {
  rule: Rule;
  /** Cells whose possible orientations shrank. */
  cells: number[];
  /** Cells that justify the deduction (for highlighting). */
  focus: number[];
  /** Cells left with a single orientation by this step. */
  determined: number[];
}

export interface SolveOptions {
  /** Highest rule tier allowed. Default 3. */
  tier?: Tier;
  /** Known masks per cell, -1 where unknown. A given that isn't a rotation of the tile is a contradiction. */
  givens?: readonly number[];
  /** Record every step (slower; used by hints). */
  trace?: boolean;
}

export interface SolveResult {
  status: "solved" | "stuck" | "contradiction";
  /** Determined mask per cell, -1 where still open. */
  masks: number[];
  steps: Step[];
  /** Number of steps per rule. */
  used: Record<Rule, number>;
}

const popcount = (x: number): number => {
  let c = 0;
  for (; x; x &= x - 1) c++;
  return c;
};

class Solver {
  readonly n: number;
  readonly nb: Int32Array;
  readonly orients: number[][];
  readonly deg: Uint8Array;
  cand: Uint8Array;
  readonly orM: Uint8Array;
  readonly andM: Uint8Array;
  private queue: number[] = [];
  private queued: Uint8Array;
  contra = false;
  trace: Step[] | null;
  used: Record<Rule, number> = { local: 0, deadend: 0, loop: 0, island: 0, lookahead: 0 };
  /** Rules in force. "local" always applies. */
  on: Set<Rule> = tierRules(3);
  /** When set, the first cell a step determines that this accepts halts the solver (`halted`). */
  watch: ((cell: number) => boolean) | null = null;
  halted = -1;

  get stopped(): boolean {
    return this.contra || this.halted >= 0;
  }

  constructor(readonly p: NetPuzzle, trace: boolean) {
    const n = this.n = p.w * p.h;
    this.nb = new Int32Array(n * 4);
    this.orients = p.tiles.map(orientations);
    this.deg = Uint8Array.from(p.tiles, degree);
    this.cand = new Uint8Array(n);
    this.orM = new Uint8Array(n);
    this.andM = new Uint8Array(n);
    this.queued = new Uint8Array(n);
    this.trace = trace ? [] : null;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) this.nb[i * 4 + k] = link(p, i, DIRS[k]!);
      this.cand[i] = (1 << this.orients[i]!.length) - 1;
      this.refresh(i);
      this.enqueue(i);
    }
  }

  refresh(i: number): void {
    const os = this.orients[i]!, c = this.cand[i]!;
    let o = 0, a = 15;
    for (let k = 0; k < os.length; k++) {
      if (c & (1 << k)) {
        o |= os[k]!;
        a &= os[k]!;
      }
    }
    this.orM[i] = o;
    this.andM[i] = c ? a : 0;
  }

  enqueue(i: number): void {
    if (this.queued[i]) return;
    this.queued[i] = 1;
    this.queue.push(i);
  }

  clearQueue(): void {
    for (const i of this.queue) this.queued[i] = 0;
    this.queue = [];
  }

  setCand(i: number, c: number): boolean {
    if (c === this.cand[i]) return false;
    this.cand[i] = c;
    if (!c) this.contra = true;
    this.refresh(i);
    for (let k = 0; k < 4; k++) {
      const j = this.nb[i * 4 + k]!;
      if (j >= 0) this.enqueue(j);
    }
    return true;
  }

  /** Keep orientations with no side in `shut` and every side in `open`. */
  restrict(i: number, shut: number, open: number): boolean {
    const os = this.orients[i]!, c = this.cand[i]!;
    let next = 0;
    for (let k = 0; k < os.length; k++) {
      const m = os[k]!;
      if (c & (1 << k) && !(m & shut) && (m & open) === open) next |= 1 << k;
    }
    return this.setCand(i, next);
  }

  enqueueAll(): void {
    for (let i = 0; i < this.n; i++) this.enqueue(i);
  }

  record(rule: Rule, cells: number[], focus: () => number[]): void {
    this.used[rule]++;
    if (!this.trace && !this.watch) return;
    const determined = cells.filter((c) => popcount(this.cand[c]!) === 1);
    this.trace?.push({ rule, cells, focus: focus(), determined });
    if (this.watch) {
      const hit = determined.find(this.watch);
      if (hit !== undefined) this.halted = hit;
    }
  }

  neighbours(i: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < 4; k++) {
      const j = this.nb[i * 4 + k]!;
      if (j >= 0 && !out.includes(j)) out.push(j);
    }
    return out;
  }

  determined(): boolean {
    for (let i = 0; i < this.n; i++) if (popcount(this.cand[i]!) !== 1) return false;
    return true;
  }

  masks(): number[] {
    return Array.from(this.cand, (c, i) => (popcount(c) === 1 ? this.orients[i]![31 - Math.clz32(c)]! : -1));
  }

  local(): void {
    const deadends = this.n > 2 && this.on.has("deadend");
    while (this.queue.length && !this.stopped) {
      const i = this.queue.pop()!;
      this.queued[i] = 0;
      let shut = 0, open = 0, pair = 0;
      for (let k = 0; k < 4; k++) {
        const d = DIRS[k]!, j = this.nb[i * 4 + k]!;
        if (j < 0) {
          shut |= d;
          continue;
        }
        const od = opp(d);
        if (!(this.orM[j]! & od)) shut |= d;
        else if (this.andM[j]! & od) open |= d;
        if (deadends && this.deg[i] === 1 && this.deg[j] === 1) pair |= d;
      }
      if (this.restrict(i, shut, open)) this.record("local", [i], () => [i, ...this.neighbours(i)]);
      if (pair && !this.stopped && this.restrict(i, pair, 0)) {
        this.record("deadend", [i], () => [i, ...this.neighbours(i).filter((j) => this.deg[j] === 1)]);
      }
    }
  }

  /** Group-level rules (loop, island) over groups joined by certain connections. Returns true if anything changed. */
  global(): boolean {
    const n = this.n;
    const parent = new Int32Array(n);
    const size = new Int32Array(n).fill(1);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]!]!;
        x = parent[x]!;
      }
      return x;
    };
    for (let i = 0; i < n; i++) {
      for (const k of [0, 3]) {
        const d = DIRS[k]!, j = this.nb[i * 4 + k]!;
        if (j < 0 || !(this.andM[i]! & d)) continue;
        const a = find(i), b = find(j);
        if (a === b) {
          this.contra = true;
          return true;
        }
        if (size[a]! < size[b]!) {
          parent[a] = b;
          size[b]! += size[a]!;
        } else {
          parent[b] = a;
          size[a]! += size[b]!;
        }
      }
    }
    const root = Int32Array.from({ length: n }, (_, i) => find(i));
    // certain sides as of the group map; sides that become certain mid-pass are treated as unknown
    const known = this.andM.slice();
    // frontier[r]: cells of group r with a side that might still open towards another group
    const frontier = new Map<number, number[]>();
    for (let x = 0; x < n; x++) {
      const loose = this.orM[x]! & ~this.andM[x]!;
      for (let k = 0; k < 4; k++) {
        const y = this.nb[x * 4 + k]!;
        if (!(loose & DIRS[k]!) || y < 0 || root[y] === root[x] || !(this.orM[y]! & opp(DIRS[k]!))) continue;
        const list = frontier.get(root[x]!);
        if (list) list.push(x);
        else frontier.set(root[x]!, [x]);
        break;
      }
    }
    for (let r = 0; r < n; r++) {
      if (root[r] === r && size[r]! < n && !frontier.has(r)) {
        this.contra = true;
        return true;
      }
    }
    const members = (roots: readonly number[]): number[] => {
      const out: number[] = [];
      for (let i = 0; i < n; i++) if (roots.includes(root[i]!)) out.push(i);
      return out;
    };

    const loops = this.on.has("loop"), islands = this.on.has("island");
    let changed = false;
    const roots: number[] = [];
    const touch: number[] = [];
    for (let c = 0; c < n; c++) {
      const os = this.orients[c]!, cand = this.cand[c]!;
      if (popcount(cand) < 2) continue;
      for (let ko = 0; ko < os.length; ko++) {
        if (!(this.cand[c]! & (1 << ko))) continue;
        const o = os[ko]!;
        roots.length = 0;
        touch.length = 0;
        roots.push(root[c]!);
        let loopAt = -1;
        for (let k = 0; k < 4; k++) {
          const d = DIRS[k]!, j = this.nb[c * 4 + k]!;
          if (!(o & d) || j < 0 || known[c]! & d) continue;
          touch.push(j);
          if (roots.includes(root[j]!)) {
            loopAt = j;
            break;
          }
          roots.push(root[j]!);
        }
        if (loopAt >= 0) {
          if (!loops) continue;
          this.setCand(c, this.cand[c]! & ~(1 << ko));
          this.record("loop", [c], () => {
            const other = touch.length > 1 ? touch.find((t) => t !== loopAt && root[t] === root[loopAt]) ?? c : c;
            return [c, ...this.path(other, loopAt)];
          });
          changed = true;
          if (this.stopped) return true;
          continue;
        }
        if (!islands) continue;
        let total = 0;
        for (const r of roots) total += size[r]!;
        if (total >= n || this.canLeave(c, o, roots, root, frontier)) continue;
        this.setCand(c, this.cand[c]! & ~(1 << ko));
        const group = [...roots];
        this.record("island", [c], () => [c, ...members(group).filter((x) => x !== c)]);
        changed = true;
        if (this.stopped) return true;
      }
    }
    return changed;
  }

  /**
   * Whether the group formed by turning c to orientation o (c plus the groups in `roots`) could
   * still open some side leading out of it.
   */
  private canLeave(c: number, o: number, roots: readonly number[], root: Int32Array, frontier: Map<number, number[]>): boolean {
    for (const r of roots) {
      for (const x of frontier.get(r) ?? []) {
        if (x === c) continue;
        // sides x must have / must not have because c faces it
        let need = 0, ban = 0;
        for (let k = 0; k < 4; k++) {
          if (this.nb[c * 4 + k] !== x) continue;
          if (o & DIRS[k]!) need |= opp(DIRS[k]!);
          else ban |= opp(DIRS[k]!);
        }
        const os = this.orients[x]!, cand = this.cand[x]!;
        for (let ko = 0; ko < os.length; ko++) {
          const m = os[ko]!;
          if (!(cand & (1 << ko)) || (m & need) !== need || m & ban) continue;
          for (let k = 0; k < 4; k++) {
            const d = DIRS[k]!, y = this.nb[x * 4 + k]!;
            if (m & d && y >= 0 && y !== c && !roots.includes(root[y]!) && this.orM[y]! & opp(d)) return true;
          }
        }
      }
    }
    return false;
  }

  /** Cells on the joined path from a to b (through sides certain to be open). */
  private path(a: number, b: number): number[] {
    if (!this.trace) return [];
    const prev = new Int32Array(this.n).fill(-2);
    prev[a] = -1;
    const q = [a];
    while (q.length) {
      const i = q.shift()!;
      if (i === b) break;
      for (let k = 0; k < 4; k++) {
        const j = this.nb[i * 4 + k]!;
        if (j < 0 || prev[j] !== -2 || !(this.andM[i]! & DIRS[k]!)) continue;
        prev[j] = i;
        q.push(j);
      }
    }
    const out: number[] = [];
    for (let i = b; i >= 0; i = prev[i]!) out.push(i);
    return out;
  }

  propagate(): void {
    for (;;) {
      this.local();
      if (this.stopped) return;
      if ((this.on.has("loop") || this.on.has("island")) && this.global()) {
        if (this.stopped) return;
        continue;
      }
      break;
    }
    if (this.determined() && !isTree(this.p, this.masks())) this.contra = true;
  }

  snapshot(): Uint8Array {
    return this.cand.slice();
  }

  restore(snap: Uint8Array): void {
    this.cand.set(snap);
    for (let i = 0; i < this.n; i++) this.refresh(i);
    this.clearQueue();
    this.contra = false;
  }

  /** Eliminate one orientation that leads to a contradiction under tier-2 rules. */
  lookahead(): boolean {
    for (let i = 0; i < this.n; i++) {
      const c = this.cand[i]!;
      if (popcount(c) < 2) continue;
      for (let bit = 1; bit <= c; bit <<= 1) {
        if (!(c & bit)) continue;
        const snap = this.snapshot();
        const { trace, watch, on } = this, used = { ...this.used };
        this.trace = null;
        this.watch = null;
        this.on = tierRules(2);
        this.setCand(i, bit);
        this.propagate();
        const bad = this.contra;
        this.restore(snap);
        Object.assign(this, { trace, watch, on, used });
        if (bad) {
          this.setCand(i, c & ~bit);
          this.record("lookahead", [i], () => [i]);
          return true;
        }
      }
    }
    return false;
  }

  /** Propagate, plus lookahead while it's on, until nothing changes or the solver stops. */
  run(): void {
    while (!this.stopped) {
      this.propagate();
      if (this.stopped || this.determined()) break;
      if (this.on.has("lookahead") && this.lookahead()) continue;
      break;
    }
  }
}

/** Run the logic solver as far as the allowed rules reach. */
export function solveLogic(p: NetPuzzle, opts: SolveOptions = {}): SolveResult {
  const s = new Solver(p, opts.trace ?? false);
  s.on = tierRules(opts.tier ?? 3);
  if (opts.givens) applyGivens(s, opts.givens);
  s.run();
  const status = s.contra ? "contradiction" : s.determined() ? "solved" : "stuck";
  return { status, masks: s.masks(), steps: s.trace ?? [], used: s.used };
}

/** A tile pinned down by `rule`: the rules easier than it don't determine it from the givens, the rule does. */
export interface Deduction {
  cell: number;
  mask: number;
  rule: Rule;
  /** Steps after the easier rules ran out, ending with the one that determined `cell`. */
  steps: Step[];
}

/**
 * The first tile that `rule` (with every easier rule) determines and the easier rules alone
 * don't, given `givens` (mask per cell, -1 where unknown). Null if there is none or the givens
 * contradict each other.
 */
export function deduce(p: NetPuzzle, givens: readonly number[], rule: Rule): Deduction | null {
  const idx = RULES.indexOf(rule);
  const s = new Solver(p, false);
  applyGivens(s, givens);
  if (s.contra) return null;
  if (idx > 0) {
    s.on = new Set(RULES.slice(0, idx));
    s.run();
    if (s.contra) return null;
  }
  const known = Uint8Array.from(s.cand, (c) => (popcount(c) === 1 ? 1 : 0));
  s.on = new Set(RULES.slice(0, idx + 1));
  s.trace = [];
  s.watch = (c) => !known[c];
  s.enqueueAll();
  s.run();
  if (s.halted < 0 || s.contra) return null;
  return { cell: s.halted, mask: s.masks()[s.halted]!, rule, steps: s.trace };
}

function applyGivens(s: Solver, givens: readonly number[]): void {
  givens.forEach((g, i) => {
    if (g < 0 || i >= s.n) return;
    const k = s.orients[i]!.indexOf(g);
    if (k < 0 || !(s.cand[i]! & (1 << k))) s.contra = true;
    else s.setCand(i, 1 << k);
  });
}

/**
 * Exhaustive search (logic propagation + branching). Counts solutions up to `limit` and
 * returns the first one found. Works for puzzles logic alone can't finish.
 */
export function searchSolutions(p: NetPuzzle, limit = 2, givens?: readonly number[]): { count: number; first: number[] | null } {
  const s = new Solver(p, false);
  s.on = tierRules(2);
  if (givens) applyGivens(s, givens);
  let count = 0;
  let first: number[] | null = null;
  const dfs = (): void => {
    s.propagate();
    if (s.contra) return;
    let best = -1, bestPop = 5;
    for (let i = 0; i < s.n; i++) {
      const pc = popcount(s.cand[i]!);
      if (pc > 1 && pc < bestPop) {
        best = i;
        bestPop = pc;
      }
    }
    if (best < 0) {
      count++;
      first ??= s.masks();
      return;
    }
    const c = s.cand[best]!;
    for (let bit = 1; bit <= c && count < limit; bit <<= 1) {
      if (!(c & bit)) continue;
      const snap = s.snapshot();
      s.setCand(best, bit);
      dfs();
      s.restore(snap);
    }
  };
  if (!s.contra) dfs();
  return { count, first };
}

/** Rule tier names for messages and ratings. */
export const TIER_LABEL: Record<Tier, string> = { 1: "easy", 2: "normal", 3: "hard" };
