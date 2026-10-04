import type { Rng } from "../../core/rng";
import { cellList, cellName } from "../../lib/grid-kit/names";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { chains, geometry, type Chains, type SignpostPuzzle } from "./grid";
import { LEVEL_NAMES, analyze, freshKnowledge, generatePuzzle, look, valid, type Level } from "./solver";

export { cellList, cellName };

export type { SignpostPuzzle } from "./grid";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 4, min: 2, max: 10 },
  height: { type: "int", label: "height", default: 4, min: 2, max: 10 },
  corners: { type: "bool", label: "start and end in opposite corners", default: true },
  difficulty: {
    type: "enum", label: "difficulty", default: "medium",
    options: [
      { value: "easy", label: "easy", description: "consecutive numbers, and cells with only one way in or out" },
      { value: "medium", label: "medium", description: "also links that would push numbers into ones already placed" },
      { value: "hard", label: "hard", description: "also trying each option and seeing all but one fail" },
    ],
  },
});

export interface SignpostState {
  /** Successor per cell, -1 where not linked. */
  next: number[];
}

/** unlink, cut and cut-chain only remove links, so they are retractions. */
export type SignpostAction =
  | { type: "link"; from: number; to: number }
  | { type: "unlink"; from: number[] }
  | { type: "cut"; cell: number }
  | { type: "cut-chain"; cell: number };

export interface SignpostInteraction {
  cursor: number;
  /** Cell a keyboard or tap link starts from, and which way it links. */
  pending: { cell: number; back: boolean } | null;
}

export function prevOf(next: readonly number[]): Int32Array {
  const prev = new Int32Array(next.length).fill(-1);
  next.forEach((t, c) => { if (t >= 0) prev[t] = c; });
  return prev;
}

const chainCache = new WeakMap<SignpostState, Chains>();

/** Chains of the player's links, with the numbers they give. */
export function stateChains(p: SignpostPuzzle, s: SignpostState): Chains {
  const hit = chainCache.get(s);
  if (hit) return hit;
  const ch = chains(geometry(p), s.next, prevOf(s.next));
  chainCache.set(s, ch);
  return ch;
}

/** Whether the player may link a→b: along a's arrow, not out of the end or into the start, not within one chain, and numbers (if both known) one apart. */
export function canLink(p: SignpostPuzzle, s: SignpostState, a: number, b: number): boolean {
  const g = geometry(p);
  if (a === b || !g.ray[a]?.includes(b)) return false;
  const ch = stateChains(p, s);
  if (ch.head[a] === ch.head[b]) return false;
  const na = ch.num[a]!, nb = ch.num[b]!;
  return !(na && nb && nb !== na + 1);
}

export function reduce(p: SignpostPuzzle, s: SignpostState, a: SignpostAction): SignpostState {
  const n = p.w * p.h;
  switch (a.type) {
    case "link": {
      if (s.next[a.from] === a.to || !canLink(p, s, a.from, a.to)) return s;
      const next = s.next.slice();
      for (let c = 0; c < n; c++) if (next[c] === a.to) next[c] = -1;
      next[a.from] = a.to;
      for (let x = a.to; x !== -1; x = next[x]!) if (x === a.from) return s;
      return { next };
    }
    case "unlink": {
      const list = a.from.filter((c) => c >= 0 && c < n && s.next[c] !== -1);
      if (!list.length) return s;
      const next = s.next.slice();
      for (const c of list) next[c] = -1;
      return { next };
    }
    case "cut": {
      if (a.cell < 0 || a.cell >= n) return s;
      const into = s.next.indexOf(a.cell);
      if (s.next[a.cell] === -1 && into < 0) return s;
      const next = s.next.slice();
      next[a.cell] = -1;
      if (into >= 0) next[into] = -1;
      return { next };
    }
    case "cut-chain": {
      if (a.cell < 0 || a.cell >= n) return s;
      const ch = stateChains(p, s);
      const head = ch.head[a.cell];
      if (ch.length[head!]! < 2) return s;
      const next = s.next.slice();
      for (let c = 0; c < n; c++) if (ch.head[c] === head) next[c] = -1;
      return { next };
    }
    default:
      return s;
  }
}

export function isSolved(p: SignpostPuzzle, s: SignpostState): boolean {
  const g = geometry(p);
  let c = g.first;
  for (let v = 1; v <= g.n; v++) {
    if (c < 0 || (g.nums[c]! > 0 && g.nums[c] !== v)) return false;
    if (v === g.n) return c === g.last;
    c = s.next[c]!;
  }
  return false;
}

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?[^:]*:((?:\d*[a-h])+)$/;

function checkPuzzle(w: number, h: number, dirs: number[], nums: number[]): SignpostPuzzle {
  const n = w * h;
  if (!(w >= 1 && h >= 1 && w * h >= 2 && w <= 30 && h <= 30)) throw new Error("size must be between 1×2 and 30×30");
  if (dirs.length !== n) throw new Error(`expected ${n} cells, got ${dirs.length}`);
  const seen = new Set<number>();
  for (const v of nums) {
    if (v < 0 || v > n) throw new Error(`numbers must be between 1 and ${n}`);
    if (v && seen.has(v)) throw new Error(`${v} appears twice`);
    seen.add(v);
  }
  if (!seen.has(1) || !seen.has(n)) throw new Error(`the first and last numbers (1 and ${n}) must both be shown`);
  return { w, h, dirs, nums };
}

/** Simon Tatham's Signpost game id: `WxH[c]:desc`; per cell an optional number then an arrow letter, a = north, clockwise to h = north-west. */
export const sgtFormat: Format<SignpostPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:desc, e.g. 3x3:1ccb…");
    const w = Number(m[1]), h = m[2] ? Number(m[2]) : w;
    const dirs: number[] = [], nums: number[] = [];
    for (const [, num, d] of m[3]!.matchAll(/(\d*)([a-h])/g)) {
      nums.push(num ? Number(num) : 0);
      dirs.push(d!.charCodeAt(0) - 97);
    }
    return checkPuzzle(w, h, dirs, nums);
  },
  serialize: (p) => `${p.w}x${p.h}:${p.dirs.map((d, c) => `${p.nums[c] || ""}${String.fromCharCode(97 + d)}`).join("")}`,
};

const ARROWS: Record<string, number> = { "↑": 0, "↗": 1, "→": 2, "↘": 3, "↓": 4, "↙": 5, "←": 6, "↖": 7, "*": 0, "■": 0 };
const ARROW_CHARS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];

/** One text row per board row: each cell an optional number then an arrow (↑ ↗ → ↘ ↓ ↙ ← ↖, or * for the end), separated by spaces. */
export const gridFormat: Format<SignpostPuzzle> = {
  id: "grid",
  label: "grid (3→ ↓ …)",
  detect: (t) => /[↑↗→↘↓↙←↖]/.test(t) && t.trim().includes("\n"),
  parse(t) {
    const rows = t.trim().split(/\r?\n/).map((r) => r.trim().split(/\s+/)).filter((r) => r.length > 0 && r[0] !== "");
    const h = rows.length, w = rows[0]?.length ?? 0;
    const dirs: number[] = [], nums: number[] = [];
    rows.forEach((r, y) => {
      if (r.length !== w) throw new Error(`row ${y + 1} has ${r.length} cells, expected ${w}`);
      for (const tok of r) {
        const m = /^(\d*)(.)$/u.exec(tok);
        const d = m ? ARROWS[m[2]!] : undefined;
        if (!m || d === undefined) throw new Error(`can't read "${tok}" in row ${y + 1}`);
        nums.push(m[1] ? Number(m[1]) : 0);
        dirs.push(d);
      }
    });
    return checkPuzzle(w, h, dirs, nums);
  },
  serialize(p) {
    const n = p.w * p.h;
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) {
      const r: string[] = [];
      for (let x = 0; x < p.w; x++) {
        const c = y * p.w + x;
        r.push(`${p.nums[c] || ""}${p.nums[c] === n ? "*" : ARROW_CHARS[p.dirs[c]!]}`);
      }
      rows.push(r.join(" "));
    }
    return rows.join("\n");
  },
};

// --- names, conflicts, hints ---

/** Focus payload understood by the signpost view. */
export interface SignpostFocus {
  /** Links the hint makes or removes, as [from, to]. */
  links: [number, number][];
  /** Cells explaining why. */
  because: number[];
  /** Other cells it mentions (options it rules out). */
  related?: number[];
}

/** Rule breaks visible without knowing the answer. */
export interface Conflicts {
  /** Cells whose number clashes (twice on the board, or past 1..n). */
  numbers: number[];
  /** Cells with nowhere left to link to. */
  stuckOut: number[];
  /** Cells nothing can link into any more. */
  stuckIn: number[];
}

export function findConflicts(p: SignpostPuzzle, s: SignpostState): Conflicts {
  const g = geometry(p);
  const k = freshKnowledge(g);
  const prev = prevOf(s.next);
  k.next.set(s.next);
  k.prev.set(prev);
  const v = look(g, k);
  const byNum = new Map<number, number[]>();
  const numbers: number[] = [];
  for (let c = 0; c < g.n; c++) {
    const n = v.ch.num[c]!;
    if (!n) continue;
    if (n < 1 || n > g.n) numbers.push(c);
    byNum.set(n, [...(byNum.get(n) ?? []), c]);
  }
  for (const list of byNum.values()) if (list.length > 1) numbers.push(...list);
  const stuckOut: number[] = [], stuckIn: number[] = [];
  for (let c = 0; c < g.n; c++) {
    if (c !== g.last && s.next[c] === -1 && !g.ray[c]!.some((o) => valid(g, k, v, c, o, 0))) stuckOut.push(c);
    if (c !== g.first && prev[c] === -1 && !g.from[c]!.some((o) => valid(g, k, v, o, c, 0))) stuckIn.push(c);
  }
  return { numbers: [...new Set(numbers)], stuckOut, stuckIn };
}

/** Links that disagree with the unique solution, as a hint that removes them. */
export function wrongLinksHint(p: SignpostPuzzle, s: SignpostState): Hint<SignpostAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const wrong = s.next.flatMap((t, c) => (t >= 0 && sol[c] !== t ? [c] : []));
  if (!wrong.length) return null;
  const one = wrong.length === 1;
  return {
    message: `the ${one ? "link" : "links"} out of ${cellList(p, wrong)} ${one ? "is" : "are"} wrong`,
    focus: { links: wrong.map((c) => [c, s.next[c]!] as [number, number]), because: [] } satisfies SignpostFocus,
    actions: [{ type: "unlink", from: wrong }],
  };
}

export function hint(p: SignpostPuzzle, s: SignpostState): Hint<SignpostAction> | null {
  const c = findConflicts(p, s);
  if (c.numbers.length) return { message: `the numbers on ${cellList(p, c.numbers)} can't all be right`, focus: { links: [], because: c.numbers } satisfies SignpostFocus };
  if (c.stuckOut.length) return { message: `${cellList(p, c.stuckOut)} can't link anywhere any more`, focus: { links: [], because: c.stuckOut } satisfies SignpostFocus };
  if (c.stuckIn.length) return { message: `nothing can link into ${cellList(p, c.stuckIn)} any more`, focus: { links: [], because: c.stuckIn } satisfies SignpostFocus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: SignpostPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level], score: a.level };
}

function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<SignpostPuzzle> {
  return generatePuzzle({
    w: v.width, h: v.height, corners: v.corners,
    level: LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level,
  }, rng, ctx);
}

export const signpost: PuzzleDef<SignpostPuzzle, SignpostState, SignpostAction, SignpostInteraction, typeof params> = {
  id: "signpost",
  name: "signpost",
  aliases: ["pfeilpfad", "arrow path", "arrows"],
  tags: ["logic", "grid", "numbers", "path"],
  description: "link every cell into one numbered path from 1 to the last number. each cell's arrow points the way to the next cell, which can be any distance along it.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "4×4 easy", params: { width: 4, height: 4, difficulty: "easy" } },
    { label: "5×5 medium", params: { width: 5, height: 5, difficulty: "medium" } },
    { label: "6×6 medium", params: { width: 6, height: 6, difficulty: "medium" } },
    { label: "6×6 hard, free ends", params: { width: 6, height: 6, difficulty: "hard", corners: false } },
    { label: "7×7 hard", params: { width: 7, height: 7, difficulty: "hard" } },
  ],
  generate,
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ next: Array.from({ length: p.w * p.h }, () => -1) }),
  initInteraction: (p) => ({ cursor: geometry(p).first, pending: null }),
  reduce,
  isRetraction: (a) => a.type !== "link",
  rules: (p) => [
    `number every cell from 1 to ${p.w * p.h}, each number once, so that each cell's arrow points at the cell with the next number.`,
    "the next cell can be any distance away, as long as it's somewhere along the arrow (straight or diagonal).",
    `the numbers already shown are fixed. 1 is the start and ${p.w * p.h} (no arrow) is the end.`,
    "linked cells without a shown number in their chain get letters (a, a+1, a+2, …) until the chain joins a number.",
  ],
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { next: a.solution.slice() } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};
