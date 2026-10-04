import { bit, combinations, digits, isSingle, lowDigit, popcount } from "./bits";
import type { Model } from "./model";
import { initialState, propagate } from "./solver";
import { cellName } from "./types";

/**
 * Human-style solver: an ordered list of techniques, each finding one step of reasoning a person
 * could follow. Drives hints and difficulty grading. Techniques only rely on the model's houses,
 * not-equal links and rules, so they work for every variant.
 */

export interface Grid {
  m: Model;
  /** Placed digits, 0 = empty. */
  vals: number[];
  /** Remaining candidates per cell (a placed cell holds just its digit). */
  masks: number[];
  solution?: readonly number[];
}

export interface Step {
  technique: string;
  name: string;
  difficulty: number;
  place: [cell: number, digit: number][];
  eliminate: [cell: number, mask: number][];
  /** Cells forming the pattern that justifies the step. */
  cells: number[];
  /** Houses (as cell lists) the reasoning happens in. */
  areas: number[][];
  message: string;
  /** Where to look, without giving the answer away. */
  nudge: string;
  /** Cells the nudge names, when it names any (else the nudge points at `areas`). */
  nudgeCells?: number[];
}

export interface Technique {
  id: string;
  name: string;
  /** Rough human difficulty; also the order techniques are tried in. */
  difficulty: number;
  find(g: Grid): Step | null;
}

// --- grid helpers ---

export function gridFrom(m: Model, values: readonly number[], solution?: readonly number[], struck?: readonly number[]): Grid {
  const vals = values.slice();
  const masks = Array.from({ length: m.size }, () => m.all);
  for (let c = 0; c < m.size; c++) if (struck?.[c]) masks[c]! &= ~struck[c]!;
  for (let c = 0; c < m.size; c++) {
    const v = vals[c]!;
    if (!v) continue;
    masks[c] = bit(v);
    for (const p of m.peers[c]!) if (!vals[p]) masks[p]! &= ~bit(v);
  }
  return { m, vals, masks, solution };
}

export function place(g: Grid, c: number, d: number): void {
  g.vals[c] = d;
  g.masks[c] = bit(d);
  for (const p of g.m.peers[c]!) if (!g.vals[p]) g.masks[p]! &= ~bit(d);
}

export function applyStep(g: Grid, s: Step): void {
  for (const [c, mask] of s.eliminate) if (!g.vals[c]) g.masks[c]! &= ~mask;
  for (const [c, d] of s.place) place(g, c, d);
}

const KIND_ORDER: Record<string, number> = { box: 0, row: 1, col: 2 };
const orderCache = new WeakMap<Model, number[]>();

/** Full houses in the order people scan them: boxes, rows, columns, then the rest. */
function scanOrder(m: Model): number[] {
  let o = orderCache.get(m);
  if (!o) {
    o = m.full.slice().sort((a, b) => (KIND_ORDER[m.houses[a]!.kind] ?? 3) - (KIND_ORDER[m.houses[b]!.kind] ?? 3) || a - b);
    orderCache.set(m, o);
  }
  return o;
}

const name = (g: Grid, c: number) => cellName(g.m.n, c);

function list(items: string[], max = 4): string {
  if (items.length <= max) return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items.join("");
  return `${items.slice(0, max).join(", ")} and ${items.length - max} more`;
}

const digitList = (mask: number) => list(digits(mask).map(String));

function describeElims(g: Grid, elims: [number, number][]): string {
  return list(elims.map(([c, m]) => `${digitList(m)} from ${name(g, c)}`), 3);
}

/** Cells (other than `except`) that see every cell in `cells`. */
function commonPeers(g: Grid, cells: readonly number[]): number[] {
  const [first, ...rest] = cells;
  return g.m.peers[first!]!.filter((p) => !cells.includes(p) && rest.every((c) => g.m.sees[p * g.m.size + c]));
}

function emptyCells(g: Grid, cells: readonly number[]): number[] {
  return cells.filter((c) => !g.vals[c]);
}

function placedMask(g: Grid, cells: readonly number[]): number {
  let m = 0;
  for (const c of cells) if (g.vals[c]) m |= bit(g.vals[c]!);
  return m;
}

function step(t: Technique, s: Omit<Step, "technique" | "name" | "difficulty"> & { difficulty?: number; name?: string }): Step {
  return { technique: t.id, name: s.name ?? t.name, difficulty: s.difficulty ?? t.difficulty, ...s } as Step;
}

// --- singles ---

export const fullHouse: Technique = {
  id: "full-house",
  name: "full house",
  difficulty: 1,
  find(g) {
    for (const h of scanOrder(g.m)) {
      const house = g.m.houses[h]!;
      const empty = emptyCells(g, house.cells);
      if (empty.length !== 1) continue;
      const c = empty[0]!;
      const missing = g.m.all & ~placedMask(g, house.cells);
      if (!isSingle(missing) || !(g.masks[c]! & missing)) continue;
      const d = lowDigit(missing);
      return step(fullHouse, {
        place: [[c, d]], eliminate: [], cells: [c], areas: [house.cells.slice()],
        message: `full house: ${name(g, c)} is the last empty cell in ${house.label}, so it's ${d}`,
        nudge: `${house.label} has one empty cell left`,
      });
    }
    return null;
  },
};

export const hiddenSingle: Technique = {
  id: "hidden-single",
  name: "hidden single",
  difficulty: 1.2,
  find(g) {
    for (const h of scanOrder(g.m)) {
      const house = g.m.houses[h]!;
      const empty = emptyCells(g, house.cells);
      let need = g.m.all & ~placedMask(g, house.cells);
      while (need) {
        const b = need & -need;
        need ^= b;
        const spots = empty.filter((c) => g.masks[c]! & b);
        if (spots.length !== 1) continue;
        const c = spots[0]!, d = lowDigit(b);
        return step(hiddenSingle, {
          place: [[c, d]], eliminate: [], cells: [c], areas: [house.cells.slice()],
          message: `hidden single: in ${house.label}, ${d} only fits in ${name(g, c)}`,
          nudge: `look where ${d} can go in ${house.label}`,
        });
      }
    }
    return null;
  },
};

export const nakedSingle: Technique = {
  id: "naked-single",
  name: "naked single",
  difficulty: 1.5,
  find(g) {
    for (let c = 0; c < g.m.size; c++) {
      if (g.vals[c] || !isSingle(g.masks[c]!)) continue;
      const d = lowDigit(g.masks[c]!);
      return step(nakedSingle, {
        place: [[c, d]], eliminate: [], cells: [c], areas: [],
        message: `naked single: every other digit is ruled out for ${name(g, c)}, so it's ${d}`,
        nudge: `one cell has only one digit left: check ${name(g, c)}`,
        nudgeCells: [c],
      });
    }
    return null;
  },
};

// --- constraint rules ---

/** First rule (easiest first) that rules something out; `accept` limits which rules (by index into m.rules) are tried. */
export function findRuleStep(g: Grid, accept?: (rule: number) => boolean): Step | null {
  const sorted = g.m.rules.map((r, i) => [r, i] as const).sort((a, b) => (a[0].difficulty ?? 2) - (b[0].difficulty ?? 2) || a[1] - b[1]);
  for (const [r, i] of sorted) {
    if (accept && !accept(i)) continue;
    const cur = r.cells.map((c) => g.masks[c]!);
    const next = cur.slice();
    if (!r.propagate(next)) continue;
    const elims: [number, number][] = [];
    r.cells.forEach((c, k) => {
      if (!g.vals[c] && next[k] !== cur[k]) elims.push([c, cur[k]! & ~next[k]!]);
    });
    if (!elims.length) continue;
    return step(ruleLogic, {
      difficulty: r.difficulty ?? 2,
      place: [], eliminate: elims, cells: r.cells.slice(), areas: [r.cells.slice()],
      message: `${r.label} rules out ${describeElims(g, elims)}`,
      nudge: `think about what ${r.label} allows`,
    });
  }
  return null;
}

export const ruleLogic: Technique = {
  id: "constraint",
  name: "constraint logic",
  difficulty: 2,
  find: (g) => findRuleStep(g),
};

// --- intersections ---

export type LockedKind = "pointing" | "claiming" | "locked candidates";

/** First locked-candidates elimination, optionally only of one kind. */
export function findLocked(g: Grid, only?: LockedKind): Step | null {
  const m = g.m;
  for (const h of scanOrder(m)) {
    const house = m.houses[h]!;
    const empty = emptyCells(g, house.cells);
    let need = m.all & ~placedMask(g, house.cells);
    while (need) {
      const b = need & -need;
      need ^= b;
      const spots = empty.filter((c) => g.masks[c]! & b);
      if (spots.length < 2) continue;
      const targets = commonPeers(g, spots).filter((c) => !g.vals[c] && g.masks[c]! & b);
      if (!targets.length) continue;
      const d = lowDigit(b);
      const other = m.houseOf[spots[0]!]!.find((o) => o !== h && spots.every((c) => m.houseOf[c]!.includes(o)));
      const oh = other === undefined ? null : m.houses[other]!;
      const kind: LockedKind = oh && house.kind === "box" && (oh.kind === "row" || oh.kind === "col") ? "pointing"
        : oh && oh.kind === "box" && (house.kind === "row" || house.kind === "col") ? "claiming" : "locked candidates";
      if (only && kind !== only) continue;
      const where = oh ? `${d} must sit where ${house.label} meets ${oh.label}` : `every spot for ${d} sees ${list(targets.map((c) => name(g, c)))}`;
      return step(lockedCandidates, {
        name: kind,
        difficulty: oh ? 2.6 : 2.8,
        place: [], eliminate: targets.map((c) => [c, b]), cells: spots, areas: oh ? [house.cells.slice(), oh.cells.slice()] : [house.cells.slice()],
        message: `${kind}: in ${house.label}, ${where}, so ${list(targets.map((c) => name(g, c)))} can't be ${d}`,
        nudge: `look at where ${d} can go in ${house.label}`,
      });
    }
  }
  return null;
}

export const lockedCandidates: Technique = {
  id: "locked-candidates",
  name: "locked candidates",
  difficulty: 2.6,
  find: (g) => findLocked(g),
};

// --- subsets ---

const SUBSET = ["", "", "pair", "triple", "quad"];

export function nakedSubset(k: number, difficulty: number): Technique {
  const t: Technique = {
    id: `naked-${SUBSET[k]}`,
    name: `naked ${SUBSET[k]}`,
    difficulty,
    find(g) {
      const m = g.m;
      for (let h = 0; h < m.houses.length; h++) {
        const house = m.houses[h]!;
        const pool = emptyCells(g, house.cells).filter((c) => popcount(g.masks[c]!) <= k);
        if (pool.length < k) continue;
        for (const combo of combinations(pool, k)) {
          let union = 0;
          for (const c of combo) union |= g.masks[c]!;
          if (popcount(union) !== k) continue;
          const elims = commonPeers(g, combo).filter((c) => !g.vals[c] && g.masks[c]! & union).map((c): [number, number] => [c, g.masks[c]! & union]);
          if (!elims.length) continue;
          return step(t, {
            place: [], eliminate: elims, cells: combo, areas: [house.cells.slice()],
            message: `${t.name}: ${list(combo.map((c) => name(g, c)))} in ${house.label} hold exactly ${digitList(union)} between them, so remove ${describeElims(g, elims)}`,
            nudge: `${k} cells in ${house.label} share ${k} candidates`,
          });
        }
      }
      return null;
    },
  };
  return t;
}

export function hiddenSubset(k: number, difficulty: number): Technique {
  const t: Technique = {
    id: `hidden-${SUBSET[k]}`,
    name: `hidden ${SUBSET[k]}`,
    difficulty,
    find(g) {
      const m = g.m;
      for (const h of scanOrder(m)) {
        const house = m.houses[h]!;
        const empty = emptyCells(g, house.cells);
        const need = digits(m.all & ~placedMask(g, house.cells));
        const where = new Map(need.map((d) => [d, empty.filter((c) => g.masks[c]! & bit(d))]));
        const pool = need.filter((d) => where.get(d)!.length <= k);
        if (pool.length < k) continue;
        for (const combo of combinations(pool, k)) {
          const cells = [...new Set(combo.flatMap((d) => where.get(d)!))];
          if (cells.length !== k) continue;
          const keep = combo.reduce((a, d) => a | bit(d), 0);
          const elims = cells.filter((c) => g.masks[c]! & ~keep).map((c): [number, number] => [c, g.masks[c]! & ~keep]);
          if (!elims.length) continue;
          return step(t, {
            place: [], eliminate: elims, cells, areas: [house.cells.slice()],
            message: `${t.name}: in ${house.label}, ${digitList(keep)} only fit in ${list(cells.map((c) => name(g, c)))}, so those cells can't hold anything else`,
            nudge: `${k} digits in ${house.label} are confined to ${k} cells`,
          });
        }
      }
      return null;
    },
  };
  return t;
}

// --- fish ---

const FISH = ["", "", "x-wing", "swordfish", "jellyfish"];

export function fish(k: number, difficulty: number): Technique {
  const t: Technique = {
    id: FISH[k]!,
    name: FISH[k]!,
    difficulty,
    find(g) {
      const m = g.m;
      for (const [baseKind, coverKind] of [["row", "col"], ["col", "row"]] as const) {
        const bases = m.houses.map((_, i) => i).filter((i) => m.houses[i]!.kind === baseKind && m.houses[i]!.cells.length === m.n);
        for (let d = 1; d <= m.n; d++) {
          const b = bit(d);
          const spots = new Map<number, number[]>();
          for (const h of bases) {
            const cells = m.houses[h]!.cells;
            if (cells.some((c) => g.vals[c] === d)) continue;
            const s = cells.filter((c) => !g.vals[c] && g.masks[c]! & b);
            if (s.length >= 2 && s.length <= k) spots.set(h, s);
          }
          if (spots.size < k) continue;
          for (const combo of combinations([...spots.keys()], k)) {
            const cells = combo.flatMap((h) => spots.get(h)!);
            const covers = [...new Set(cells.map((c) => m.houseOf[c]!.find((x) => m.houses[x]!.kind === coverKind)!))];
            if (covers.length !== k) continue;
            const baseCells = new Set(combo.flatMap((h) => m.houses[h]!.cells));
            const elims = covers.flatMap((h) => m.houses[h]!.cells)
              .filter((c) => !baseCells.has(c) && !g.vals[c] && g.masks[c]! & b).map((c): [number, number] => [c, b]);
            if (!elims.length) continue;
            const bl = list(combo.map((h) => m.houses[h]!.label)), cl = list(covers.map((h) => m.houses[h]!.label));
            return step(t, {
              place: [], eliminate: elims, cells, areas: combo.map((h) => m.houses[h]!.cells.slice()),
              message: `${t.name}: in ${bl}, ${d} can only go in ${cl}, so remove ${d} from the rest of ${cl}`,
              nudge: `look at ${d} across ${bl}`,
            });
          }
        }
      }
      return null;
    },
  };
  return t;
}

// --- chains ---

const MAX_CHAIN = 12;

/**
 * Alternating inference chains: strong links (bivalue cells, digits with two spots in a full
 * house) alternate with weak links (same cell, or same digit in cells that see each other).
 * A chain that starts and ends on strong links proves one of its ends true, so any candidate
 * weakly linked to both ends goes. A chain returning to its start proves the start true.
 */
export interface ChainOptions {
  /** "x": one digit, strong links from houses only. "xy": strong links inside two-candidate cells, weak links between cells on one digit. "any": both. */
  links?: "x" | "xy" | "any";
  /** Chain length bounds, counted in candidates along the chain. */
  minLen?: number;
  maxLen?: number;
}

/** Shortest alternating inference chain allowed by `o` that proves something. */
export function findChain(g: Grid, o: ChainOptions = {}): Step | null {
  const links = o.links ?? "any";
  const minLen = Math.max(4, o.minLen ?? 4);
  const maxLen = o.maxLen ?? MAX_CHAIN;
  const m = g.m, n = m.n;
  {
    const node = (c: number, d: number) => c * n + d - 1;
    const cellOf = (x: number) => Math.floor(x / n), digOf = (x: number) => (x % n) + 1;
    const live = (x: number) => !g.vals[cellOf(x)] && (g.masks[cellOf(x)]! & bit(digOf(x))) !== 0;
    const strong = new Map<number, Set<number>>();
    const addStrong = (a: number, b: number) => {
      if (!strong.has(a)) strong.set(a, new Set());
      if (!strong.has(b)) strong.set(b, new Set());
      strong.get(a)!.add(b);
      strong.get(b)!.add(a);
    };
    for (let c = 0; c < m.size && links !== "x"; c++) {
      if (g.vals[c] || popcount(g.masks[c]!) !== 2) continue;
      const [d1, d2] = digits(g.masks[c]!);
      addStrong(node(c, d1!), node(c, d2!));
    }
    for (const h of links === "xy" ? [] : m.full) {
      const cells = m.houses[h]!.cells;
      for (let d = 1; d <= n; d++) {
        const s = cells.filter((c) => !g.vals[c] && g.masks[c]! & bit(d));
        if (s.length === 2) addStrong(node(s[0]!, d), node(s[1]!, d));
      }
    }
    if (!strong.size) return null;
    const weakOf = (x: number): number[] => {
      const c = cellOf(x), d = digOf(x);
      const out: number[] = [];
      if (links === "any") for (const e of digits(g.masks[c]!)) if (e !== d) out.push(node(c, e));
      for (const p of m.peers[c]!) if (!g.vals[p] && g.masks[p]! & bit(d)) out.push(node(p, d));
      return out;
    };
    const weakTo = (x: number, y: number) => x !== y && (cellOf(x) === cellOf(y)
      ? true : digOf(x) === digOf(y) && m.sees[cellOf(x) * m.size + cellOf(y)] === 1);

    let best: { path: number[]; elims: [number, number][]; place: [number, number][] } | null = null;
    for (const a of [...strong.keys()].sort((x, y) => x - y)) {
      if (!live(a)) continue;
      const aWeak = weakOf(a);
      const parent = new Map<number, number>();
      const depth = new Map<number, number>();
      const start = a * 2;
      depth.set(start, 1);
      const queue = [start];
      for (let qi = 0; qi < queue.length; qi++) {
        const s = queue[qi]!;
        const x = s >> 1, arrivedStrong = s & 1;
        const len = depth.get(s)!;
        if (best && len >= best.path.length) break;
        if (arrivedStrong && len >= minLen) {
          const path = [];
          for (let k: number | undefined = s; k !== undefined; k = parent.get(k)) path.unshift(k >> 1);
          if (x === a) {
            best = { path, elims: [], place: [[cellOf(a), digOf(a)]] };
            break;
          }
          const elims = aWeak.filter((z) => z !== x && weakTo(z, x)).map((z): [number, number] => [cellOf(z), bit(digOf(z))]);
          if (elims.length) {
            best = { path, elims, place: [] };
            break;
          }
        }
        if (len >= maxLen) continue;
        const next = arrivedStrong ? weakOf(x) : [...(strong.get(x) ?? [])];
        for (const y of next) {
          if (y === a && !arrivedStrong) continue;
          const ns = y * 2 + (arrivedStrong ? 0 : 1);
          if (depth.has(ns)) continue;
          depth.set(ns, len + 1);
          parent.set(ns, s);
          queue.push(ns);
        }
      }
      if (best && best.path.length <= minLen) break;
    }
    if (!best) return null;
    const { path, elims, place: pl } = best;
    const sameDigit = path.every((x) => digOf(x) === digOf(path[0]!));
    let allCells = true;
    for (let i = 0; i + 1 < path.length; i += 2) if (cellOf(path[i]!) !== cellOf(path[i + 1]!)) allCells = false;
    const kind = sameDigit ? "x-chain" : allCells ? (path.length === 6 ? "xy-wing" : "xy-chain") : "alternating chain";
    // read as a story: if the start isn't true, each strong link forces the next true, each weak link the next false
    const at = (x: number) => `${name(g, cellOf(x))} is ${digOf(x)}`;
    const isnt = (x: number) => `${name(g, cellOf(x))} isn't ${digOf(x)}`;
    const story = path.slice(1).map((x, i) => (i % 2 === 0 ? at(x) : isnt(x))).join(", so ");
    const text = `if ${isnt(path[0]!)}, then ${story}`;
    const cells = [...new Set(path.map(cellOf))];
    const linkCount = path.length - 1;
    const last = path[path.length - 1]!;
    const result = pl.length
      ? `which contradicts the start, so ${at(path[0]!)}`
      : `so either ${at(path[0]!)} or ${at(last)}; both rule out ${describeElims(g, elims)}`;
    return step(chains, {
      name: kind,
      difficulty: 4 + 0.3 * (linkCount - 3),
      place: pl, eliminate: elims, cells, areas: [],
      message: `${kind}: ${text}; ${result}`,
      nudge: `suppose ${isnt(path[0]!)} and follow what that forces`,
      nudgeCells: [cellOf(path[0]!)],
    });
  }
}

export const chains: Technique = {
  id: "chain",
  name: "chain",
  difficulty: 4,
  find: (g) => findChain(g),
};

// --- last resorts ---

export const trial: Technique = {
  id: "trial",
  name: "trial and error",
  difficulty: 8,
  find(g) {
    const m = g.m;
    const order = [...Array(m.size).keys()].filter((c) => !g.vals[c] && popcount(g.masks[c]!) > 1)
      .sort((a, b) => popcount(g.masks[a]!) - popcount(g.masks[b]!) || a - b);
    for (const c of order) {
      for (const d of digits(g.masks[c]!)) {
        const st = initialState(m, g.vals, g.masks);
        st.masks[c] = bit(d);
        if (propagate(m, st)) continue;
        return step(trial, {
          place: [], eliminate: [[c, bit(d)]], cells: [c], areas: [],
          message: `trial and error: putting ${d} in ${name(g, c)} leads to a contradiction, so it can't be ${d}`,
          nudge: `try a digit in ${name(g, c)} and see what breaks`,
          nudgeCells: [c],
        });
      }
    }
    return null;
  },
};

export const reveal: Technique = {
  id: "reveal",
  name: "no logical step found",
  difficulty: 10,
  find(g) {
    if (!g.solution) return null;
    let best = -1;
    for (let c = 0; c < g.m.size; c++) {
      if (g.vals[c]) continue;
      if (best < 0 || popcount(g.masks[c]!) < popcount(g.masks[best]!)) best = c;
    }
    if (best < 0) return null;
    const d = g.solution[best]!;
    return step(reveal, {
      place: [[best, d]], eliminate: [], cells: [best], areas: [],
      message: `no step found with the techniques i know; ${name(g, best)} is ${d}`,
      nudge: `no step found with the techniques i know; try ${name(g, best)}`,
    });
  },
};

/** Technique list, tried in order. Mods may push/splice; keep it sorted by difficulty. */
export const techniques: Technique[] = [
  fullHouse, hiddenSingle, nakedSingle, ruleLogic, lockedCandidates,
  nakedSubset(2, 3), hiddenSubset(2, 3.4), nakedSubset(3, 3.8), chains, hiddenSubset(3, 4.2), fish(2, 4.4),
  nakedSubset(4, 5), hiddenSubset(4, 5.4), fish(3, 5.6), fish(4, 6.5), trial, reveal,
];

export function findStep(g: Grid, maxDifficulty = Infinity): Step | null {
  for (const t of techniques) {
    if (t.difficulty > maxDifficulty) break;
    const s = t.find(g);
    if (s && s.difficulty <= maxDifficulty) return s;
  }
  return null;
}

export interface LogicalSolve {
  steps: Step[];
  solved: boolean;
  grid: Grid;
}

/** Apply steps until solved or stuck. `maxDifficulty` caps which techniques may be used. */
export function logicalSolve(g: Grid, maxDifficulty = Infinity, maxSteps = 2000): LogicalSolve {
  const steps: Step[] = [];
  while (steps.length < maxSteps) {
    if (g.vals.every((v) => v > 0)) return { steps, solved: true, grid: g };
    const s = findStep(g, maxDifficulty);
    if (!s) break;
    steps.push(s);
    applyStep(g, s);
  }
  return { steps, solved: g.vals.every((v) => v > 0), grid: g };
}

export interface Band {
  id: string;
  label: string;
  /** Hardest technique difficulty allowed. */
  max: number;
}

export const BANDS: readonly Band[] = [
  { id: "easy", label: "easy", max: 1.5 },
  { id: "medium", label: "medium", max: 2.8 },
  { id: "hard", label: "hard", max: 5 },
  { id: "expert", label: "expert", max: 7 },
  { id: "extreme", label: "extreme", max: Infinity },
];

export function bandOf(hardest: number): Band {
  return BANDS.find((b) => hardest <= b.max) ?? BANDS[BANDS.length - 1]!;
}

export interface Grade {
  band: Band;
  hardest: Step | null;
  score: number;
  steps: number;
  techniques: string[];
}

export function grade(m: Model, givens: readonly number[], solution?: readonly number[]): Grade {
  const r = logicalSolve(gridFrom(m, givens, solution));
  let hardest: Step | null = null;
  let total = 0;
  for (const s of r.steps) {
    total += s.difficulty;
    if (!hardest || s.difficulty > hardest.difficulty) hardest = s;
  }
  const h = r.solved ? (hardest?.difficulty ?? 0) : 10;
  return {
    band: bandOf(h),
    hardest,
    score: Math.round(h * 1000 + total),
    steps: r.steps.length,
    techniques: [...new Set(r.steps.map((s) => s.name))],
  };
}

