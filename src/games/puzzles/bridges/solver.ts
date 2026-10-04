import { DIR_NAMES, cutEdges, graph, isValidSolution, islandName, type BridgesPuzzle, type BridgesState, type Graph } from "./graph";

/**
 * Interval-domain logic solver. Every deduction narrows some edge's [lo, hi] bridge range and is
 * sound in every solution, so a puzzle that logic narrows to a single valid assignment has exactly
 * one solution.
 *
 * Tiers (each includes the ones below):
 *   1 easy   - island counting, crossing paths
 *   2 medium - connectivity: isolated groups, cut edges, loops (when forbidden)
 *   3 hard   - single-edge contradiction trials using tiers 1-2
 */
export type Tier = 1 | 2 | 3;
export const TIER_NAMES: Record<Tier, string> = { 1: "easy", 2: "medium", 3: "hard" };

export interface Domain {
  lo: Int8Array;
  hi: Int8Array;
}

export type ContradictionKind = "over" | "under" | "cross" | "closed" | "disconnected" | "loop";

export interface Contradiction {
  kind: ContradictionKind;
  islands: number[];
  edges: number[];
}

export interface Change {
  edge: number;
  lo: number;
  hi: number;
}

export interface Step {
  tier: Tier;
  technique: string;
  message: string;
  islands: number[];
  edges: number[];
  changes: Change[];
}

export interface Stats {
  /** Deductions made per tier (bulk mode counts edge narrowings). */
  byTier: [number, number, number, number];
}

let work = 0;

/** Monotonic count of solver work units (island visits); deterministic for identical inputs. */
export function solverWork(): number {
  return work;
}

function cloneDomain(d: Domain): Domain {
  return { lo: d.lo.slice(), hi: d.hi.slice() };
}

export function initialDomain(g: Graph): Domain {
  const p = g.puzzle;
  const lo = new Int8Array(g.edges.length);
  const hi = new Int8Array(g.edges.length);
  for (const e of g.edges) hi[e.id] = Math.min(p.maxb, p.islands[e.a]!.n, p.islands[e.b]!.n);
  return { lo, hi };
}

/** Domain constrained by a player's state (placed bridges as lower bounds, marks as zero), or a contradiction. */
export function domainFromState(g: Graph, s: BridgesState): Domain | Contradiction {
  const d = initialDomain(g);
  for (const e of g.edges) {
    const b = s.b[e.id] ?? 0;
    if (b > d.hi[e.id]!) return { kind: "over", islands: [e.a, e.b], edges: [e.id] };
    d.lo[e.id] = b;
    if (s.no[e.id] && b === 0) d.hi[e.id] = 0;
  }
  return d;
}

export function isComplete(d: Domain): boolean {
  for (let i = 0; i < d.lo.length; i++) if (d.lo[i] !== d.hi[i]) return false;
  return true;
}

function isContradiction(x: unknown): x is Contradiction {
  return typeof x === "object" && x !== null && "kind" in x;
}

const islandEdgeList = new WeakMap<Graph, number[][]>();
function incident(g: Graph): number[][] {
  let l = islandEdgeList.get(g);
  if (!l) {
    l = g.islandEdges.map((es) => es.filter((e) => e >= 0));
    islandEdgeList.set(g, l);
  }
  return l;
}

// --- tier 1 ---

/** Narrowings for one island from its own count; snapshot-based, so each is individually sound. */
function capacity(g: Graph, d: Domain, i: number): Change[] | Contradiction {
  const n = g.puzzle.islands[i]!.n;
  const inc = incident(g)[i]!;
  let sumLo = 0, sumHi = 0;
  for (const e of inc) {
    sumLo += d.lo[e]!;
    sumHi += d.hi[e]!;
  }
  if (sumLo > n) return { kind: "over", islands: [i], edges: inc.filter((e) => d.lo[e]! > 0) };
  if (sumHi < n) return { kind: "under", islands: [i], edges: inc.slice() };
  const out: Change[] = [];
  for (const e of inc) {
    const lo = Math.max(d.lo[e]!, n - (sumHi - d.hi[e]!));
    const hi = Math.min(d.hi[e]!, n - (sumLo - d.lo[e]!));
    if (lo !== d.lo[e] || hi !== d.hi[e]) out.push({ edge: e, lo, hi });
  }
  return out;
}

function crossing(g: Graph, d: Domain): Change[] | Contradiction {
  const out: Change[] = [];
  for (const e of g.edges) {
    if (d.lo[e.id]! <= 0) continue;
    for (const c of g.cross[e.id]!) {
      if (d.lo[c]! > 0) return { kind: "cross", islands: [], edges: [e.id, c] };
      if (d.hi[c]! > 0) out.push({ edge: c, lo: 0, hi: 0 });
    }
  }
  return out;
}

function apply(d: Domain, changes: readonly Change[]): void {
  for (const c of changes) {
    d.lo[c.edge] = Math.max(d.lo[c.edge]!, c.lo);
    d.hi[c.edge] = Math.min(d.hi[c.edge]!, c.hi);
  }
}

function tier1(g: Graph, d: Domain, stats?: Stats, seedEdge = -1): Contradiction | null {
  const N = g.puzzle.islands.length;
  const queue: number[] = [];
  const queued = new Uint8Array(N);
  const push = (i: number) => {
    if (!queued[i]) {
      queued[i] = 1;
      queue.push(i);
    }
  };
  if (seedEdge >= 0) {
    push(g.edges[seedEdge]!.a);
    push(g.edges[seedEdge]!.b);
  } else {
    for (let i = 0; i < N; i++) push(i);
  }
  const zeroCrossings = (e: number): Contradiction | null => {
    for (const c of g.cross[e]!) {
      if (d.lo[c]! > 0) return { kind: "cross", islands: [], edges: [e, c] };
      if (d.hi[c]! > 0) {
        d.hi[c] = 0;
        if (stats) stats.byTier[1]++;
        push(g.edges[c]!.a);
        push(g.edges[c]!.b);
      }
    }
    return null;
  };
  for (const e of seedEdge >= 0 ? [g.edges[seedEdge]!] : g.edges) {
    if (d.lo[e.id]! > 0) {
      const c = zeroCrossings(e.id);
      if (c) return c;
    }
  }
  while (queue.length) {
    const i = queue.pop()!;
    queued[i] = 0;
    work++;
    const r = capacity(g, d, i);
    if (isContradiction(r)) return r;
    for (const ch of r) {
      const wasZero = d.lo[ch.edge] === 0;
      d.lo[ch.edge] = ch.lo;
      d.hi[ch.edge] = ch.hi;
      if (stats) stats.byTier[1]++;
      const e = g.edges[ch.edge]!;
      push(e.a);
      push(e.b);
      if (wasZero && ch.lo > 0) {
        const c = zeroCrossings(ch.edge);
        if (c) return c;
      }
    }
  }
  return null;
}

// --- tier 2 ---

interface Groups {
  root: Int32Array;
  size: Int32Array;
  residual: Int32Array;
  count: number;
}

/** Islands grouped by edges with lo > 0. Returns a loop contradiction if loops are off and lo-edges form a cycle. */
function groups(g: Graph, d: Domain): Groups | Contradiction {
  const p = g.puzzle;
  const N = p.islands.length;
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const residual = new Int32Array(N);
  p.islands.forEach((is, i) => { residual[i] = is.n; });
  for (const e of g.edges) {
    const lo = d.lo[e.id]!;
    if (lo <= 0) continue;
    residual[e.a]! -= lo;
    residual[e.b]! -= lo;
    const ra = find(e.a), rb = find(e.b);
    if (ra === rb) {
      if (!p.loops) return { kind: "loop", islands: [e.a, e.b], edges: [e.id] };
    } else {
      parent[ra] = rb;
    }
  }
  const root = new Int32Array(N);
  const size = new Int32Array(N);
  const res = new Int32Array(N);
  let count = 0;
  for (let i = 0; i < N; i++) {
    const r = find(i);
    root[i] = r;
    if (size[r] === 0) count++;
    size[r]!++;
    res[r]! += residual[i]!;
  }
  return { root, size, residual: res, count };
}

function membersOf(gr: Groups, r: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < gr.root.length; i++) if (gr.root[i] === r) out.push(i);
  return out;
}

function edgeName(g: Graph, e: number): string {
  const ed = g.edges[e]!;
  return `${islandName(g.puzzle, ed.a)} and ${islandName(g.puzzle, ed.b)}`;
}

function bridgesWord(n: number): string {
  return n === 1 ? "one bridge" : `${n} bridges`;
}

/** Tier-2 steps, or a contradiction. Bulk callers apply every change; step callers pick one. */
function tier2Steps(g: Graph, d: Domain, wantMessages: boolean): Step[] | Contradiction {
  const p = g.puzzle;
  const N = p.islands.length;
  const gr = groups(g, d);
  if (isContradiction(gr)) return gr;
  if (gr.count > 1) {
    for (let i = 0; i < N; i++) {
      if (gr.root[i] === i && gr.residual[i] === 0) {
        const m = membersOf(gr, i);
        return { kind: "closed", islands: m, edges: g.edges.filter((e) => d.lo[e.id]! > 0 && gr.root[e.a] === i).map((e) => e.id) };
      }
    }
  }
  const steps: Step[] = [];
  for (const e of g.edges) {
    const hi = d.hi[e.id]!;
    if (hi <= 0 || d.lo[e.id]! > 0) continue;
    const ra = gr.root[e.a]!, rb = gr.root[e.b]!;
    if (ra === rb) {
      if (!p.loops) {
        steps.push({
          tier: 2, technique: "loop", islands: [e.a, e.b], edges: [e.id],
          changes: [{ edge: e.id, lo: 0, hi: 0 }],
          message: wantMessages ? `${edgeName(g, e.id)} are already connected, and loops aren't allowed, so no bridge goes between them` : "",
        });
      }
      continue;
    }
    if (gr.size[ra]! + gr.size[rb]! < N && gr.residual[ra]! + gr.residual[rb]! === 2 * hi) {
      const k = gr.size[ra]! + gr.size[rb]!;
      const then = hi - 1 === 0 ? "they can't be joined" : `at most ${bridgesWord(hi - 1)} can go between them`;
      steps.push({
        tier: 2, technique: "isolation", islands: wantMessages ? [...membersOf(gr, ra), ...membersOf(gr, rb)] : [e.a, e.b], edges: [e.id],
        changes: [{ edge: e.id, lo: 0, hi: hi - 1 }],
        message: wantMessages
          ? k === 2
            ? `joining ${edgeName(g, e.id)} with ${bridgesWord(hi)} would finish both and cut them off from the rest, so ${then}`
            : `${bridgesWord(hi)} between ${edgeName(g, e.id)} would close off a group of ${k} islands, so ${then}`
          : "",
      });
    }
  }
  if (steps.length) return steps;

  if (gr.count <= 1) return steps;
  const dense = new Int32Array(N).fill(-1);
  const roots: number[] = [];
  for (let i = 0; i < N; i++) if (gr.root[i] === i) { dense[i] = roots.length; roots.push(i); }
  const adj: [number, number][][] = roots.map(() => []);
  for (const e of g.edges) {
    if (d.hi[e.id]! <= 0) continue;
    const a = dense[gr.root[e.a]!]!, b = dense[gr.root[e.b]!]!;
    if (a === b) continue;
    adj[a]!.push([b, e.id]);
    adj[b]!.push([a, e.id]);
  }
  const seen = new Uint8Array(roots.length);
  const stack = [0];
  seen[0] = 1;
  while (stack.length) for (const [v] of adj[stack.pop()!]!) if (!seen[v]) { seen[v] = 1; stack.push(v); }
  const unreached = roots.findIndex((_, k) => !seen[k]);
  if (unreached >= 0) {
    const m = membersOf(gr, roots[unreached]!);
    return { kind: "disconnected", islands: m, edges: [] };
  }
  for (const e of cutEdges(roots.length, adj)) {
    const ed = g.edges[e]!;
    let message = "";
    if (wantMessages) {
      const side = sideSize(adj, dense[gr.root[ed.a]!]!, e, roots, gr);
      const other = N - side;
      const [small, smallIsland] = side <= other ? [side, ed.a] : [other, ed.b];
      message = `${edgeName(g, e)} must be joined: every other route is blocked, and without it ${small === 1 ? islandName(p, smallIsland) : `the ${small} islands on the side of ${islandName(p, smallIsland)}`} would be cut off`;
    }
    steps.push({ tier: 2, technique: "cut", islands: [ed.a, ed.b], edges: [e], changes: [{ edge: e, lo: 1, hi: d.hi[e]! }], message });
  }
  return steps;
}

/** Islands reachable from group `start` without using edge `cut`. */
function sideSize(adj: [number, number][][], start: number, cut: number, roots: number[], gr: Groups): number {
  const seen = new Uint8Array(adj.length);
  seen[start] = 1;
  const stack = [start];
  let total = 0;
  while (stack.length) {
    const u = stack.pop()!;
    total += gr.size[roots[u]!]!;
    for (const [v, id] of adj[u]!) if (id !== cut && !seen[v]) { seen[v] = 1; stack.push(v); }
  }
  return total;
}

// --- tier 3 ---

function trialValues(d: Domain, e: number): number[] {
  const lo = d.lo[e]!, hi = d.hi[e]!;
  return lo === hi ? [] : [hi, lo];
}

/** Propagation used inside trials (tiers 1-2). */
function propagateBelow3(g: Graph, d: Domain, changedEdge: number): Contradiction | null {
  return propagate(g, d, 2, undefined, changedEdge);
}

interface TrialResult {
  edge: number;
  value: number;
  contradiction: Contradiction;
  change: Change;
}

function trial(g: Graph, d: Domain, e: number, v: number): TrialResult | null {
  const t = cloneDomain(d);
  t.lo[e] = v;
  t.hi[e] = v;
  const c = propagateBelow3(g, t, e);
  if (!c) return null;
  const change = v === d.hi[e] ? { edge: e, lo: d.lo[e]!, hi: v - 1 } : { edge: e, lo: v + 1, hi: d.hi[e]! };
  return { edge: e, value: v, contradiction: c, change };
}

export function describeContradiction(g: Graph, c: Contradiction): string {
  const p = g.puzzle;
  const first = c.islands[0];
  switch (c.kind) {
    case "over": return first === undefined ? "an island would get too many bridges" : `${islandName(p, first)} would get too many bridges`;
    case "under": return first === undefined ? "an island couldn't get enough bridges" : `${islandName(p, first)} couldn't get enough bridges`;
    case "cross": return "two bridges would have to cross";
    case "closed": return first === undefined ? "a group would be cut off" : `${c.islands.length === 1 ? islandName(p, first) : `the group with ${islandName(p, first)}`} would be cut off from the rest`;
    case "disconnected": return first === undefined ? "some islands could never connect" : `${islandName(p, first)} could never connect to the rest`;
    case "loop": return "the bridges would have to form a loop";
  }
}

function trialStep(g: Graph, r: TrialResult): Step {
  const ed = g.edges[r.edge]!;
  const v = r.value;
  const ch = r.change;
  const conclusion = ch.lo > r.value
    ? `they need at least ${bridgesWord(ch.lo)} between them`
    : ch.hi === 0 ? "they can't be joined" : `at most ${bridgesWord(ch.hi)} can go there`;
  const supposition = v === 0 ? `if ${edgeName(g, r.edge)} weren't joined` : `if ${edgeName(g, r.edge)} had exactly ${bridgesWord(v)}`;
  return {
    tier: 3, technique: "trial", islands: [ed.a, ed.b, ...r.contradiction.islands], edges: [r.edge, ...r.contradiction.edges],
    changes: [ch],
    message: `${supposition}, ${describeContradiction(g, r.contradiction)}, so ${conclusion}`,
  };
}

// --- bulk propagation ---

/**
 * Narrow `d` in place to the fixpoint of every technique up to `tier`. `changedEdge` >= 0 promises
 * `d` was already at the tier-1 fixpoint apart from that edge.
 */
export function propagate(g: Graph, d: Domain, tier: Tier, stats?: Stats, changedEdge = -1): Contradiction | null {
  for (let first = true; ; first = false) {
    const c1 = tier1(g, d, stats, first ? changedEdge : -1);
    if (c1) return c1;
    if (tier < 2) return null;
    work += g.edges.length;
    const s2 = tier2Steps(g, d, false);
    if (isContradiction(s2)) return s2;
    if (s2.length) {
      for (const s of s2) apply(d, s.changes);
      if (stats) stats.byTier[2] += s2.length;
      continue;
    }
    if (tier < 3) return null;
    let changed = false;
    for (const e of g.edges) {
      for (const v of trialValues(d, e.id)) {
        if (d.lo[e.id] === d.hi[e.id]) break;
        if (v < d.lo[e.id]! || v > d.hi[e.id]!) continue;
        const r = trial(g, d, e.id, v);
        if (r) {
          apply(d, [r.change]);
          if (d.lo[e.id]! > d.hi[e.id]!) return r.contradiction;
          if (stats) stats.byTier[3]++;
          changed = true;
        }
      }
    }
    if (!changed) return null;
  }
}

// --- step mode ---

/** Steps from the easiest tier (≤ maxTier) that has any, or a contradiction. */
export function nextSteps(g: Graph, d: Domain, maxTier: Tier): Step[] | Contradiction {
  const p = g.puzzle;
  const steps: Step[] = [];
  const cr = crossing(g, d);
  if (isContradiction(cr)) return cr;
  for (const ch of cr) {
    const blocker = g.edges.find((e) => d.lo[e.id]! > 0 && g.cross[e.id]!.includes(ch.edge))!;
    steps.push({
      tier: 1, technique: "cross", islands: [], edges: [ch.edge, blocker.id], changes: [ch],
      message: `the bridge between ${edgeName(g, blocker.id)} blocks the path between ${edgeName(g, ch.edge)}`,
    });
  }
  for (let i = 0; i < p.islands.length; i++) {
    const r = capacity(g, d, i);
    if (isContradiction(r)) return r;
    if (r.length) steps.push(capacityStep(g, d, i, r));
  }
  if (steps.length || maxTier < 2) return steps;
  const s2 = tier2Steps(g, d, true);
  if (isContradiction(s2) || s2.length || maxTier < 3) return s2;
  for (const e of g.edges) {
    for (const v of trialValues(d, e.id)) {
      const r = trial(g, d, e.id, v);
      if (r) return [trialStep(g, r)];
    }
  }
  return [];
}

function capacityStep(g: Graph, d: Domain, i: number, changes: Change[]): Step {
  const p = g.puzzle;
  const n = p.islands[i]!.n;
  const dirs = g.islandEdges[i]!;
  let sumLo = 0, sumHi = 0;
  for (const e of incident(g)[i]!) {
    sumLo += d.lo[e]!;
    sumHi += d.hi[e]!;
  }
  const raised = changes.filter((c) => c.lo > d.lo[c.edge]!);
  const name = islandName(p, i);
  let message: string;
  if (raised.length) {
    const parts = raised.map((c) => `${c.lo} ${DIR_NAMES[dirs.indexOf(c.edge)]}`);
    const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    message = sumHi === n
      ? `${name} needs every bridge it has room for: ${list}`
      : `${name} has room for ${sumHi} bridges but needs ${n}, so it needs at least ${list}`;
  } else if (sumLo === n) {
    message = `${name} is full, so nothing else connects to it`;
  } else {
    message = `${name} only needs ${n - sumLo} more, which limits how many can go each way`;
  }
  return { tier: 1, technique: "capacity", islands: [i], edges: changes.map((c) => c.edge), changes, message };
}

// --- whole-puzzle analysis ---

export interface LogicResult {
  /** Highest tier needed, or null if logic (up to tier 3) can't finish. */
  tier: Tier | null;
  domain: Domain;
  contradiction: Contradiction | null;
  stats: Stats;
}

/** Bulk logic solve from scratch, escalating tiers only when lower ones stall. */
export function logicSolve(p: BridgesPuzzle, maxTier: Tier = 3): LogicResult {
  const g = graph(p);
  const d = initialDomain(g);
  const stats: Stats = { byTier: [0, 0, 0, 0] };
  let tier: Tier | null = null;
  for (const t of [1, 2, 3] as Tier[]) {
    if (t > maxTier) break;
    const c = propagate(g, d, t, stats);
    if (c) return { tier: null, domain: d, contradiction: c, stats };
    if (isComplete(d)) {
      tier = isValidSolution(p, Array.from(d.lo)) ? t : null;
      break;
    }
  }
  return { tier, domain: d, contradiction: null, stats };
}

export interface SearchResult {
  count: number;
  first: number[] | null;
  /** Node budget ran out; count is a lower bound. */
  aborted: boolean;
}

/** Backtracking search over tier-2 propagation; stops after `limit` solutions or `budget` nodes. */
export function search(p: BridgesPuzzle, start?: Domain, limit = 2, budget = 200_000): SearchResult {
  const g = graph(p);
  const res: SearchResult = { count: 0, first: null, aborted: false };
  let nodes = 0;
  const rec = (d: Domain): void => {
    if (res.count >= limit || res.aborted) return;
    if (++nodes > budget) {
      res.aborted = true;
      return;
    }
    if (propagate(g, d, 2)) return;
    let best = -1, bestSpan = Infinity;
    for (let e = 0; e < d.lo.length; e++) {
      const span = d.hi[e]! - d.lo[e]!;
      if (span > 0 && span < bestSpan) {
        best = e;
        bestSpan = span;
        if (span === 1) break;
      }
    }
    if (best < 0) {
      const b = Array.from(d.lo);
      if (isValidSolution(p, b)) {
        res.count++;
        res.first ??= b;
      }
      return;
    }
    for (let v = d.hi[best]!; v >= d.lo[best]!; v--) {
      const t = cloneDomain(d);
      t.lo[best] = v;
      t.hi[best] = v;
      rec(t);
      if (res.count >= limit || res.aborted) return;
    }
  };
  rec(start ? cloneDomain(start) : initialDomain(g));
  return res;
}

export interface Analysis {
  logic: LogicResult;
  /** A solution, or null if none was found. */
  solution: number[] | null;
  /** true/false when known; null when the search budget ran out. */
  unique: boolean | null;
}

const analyses = new WeakMap<BridgesPuzzle, Analysis>();

/** Memoized per puzzle object. */
export function analyze(p: BridgesPuzzle): Analysis {
  let a = analyses.get(p);
  if (a) return a;
  const logic = logicSolve(p);
  if (logic.tier !== null) {
    a = { logic, solution: Array.from(logic.domain.lo), unique: true };
  } else if (logic.contradiction) {
    a = { logic, solution: null, unique: false };
  } else {
    const s = search(p, logic.domain);
    a = { logic, solution: s.first, unique: s.aborted ? null : s.count === 1 };
  }
  analyses.set(p, a);
  return a;
}

export { isContradiction };
