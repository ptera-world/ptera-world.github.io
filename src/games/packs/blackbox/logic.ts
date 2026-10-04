import type { Rng } from "../../core/rng";
import { cellList, cellName } from "../../lib/grid-kit/names";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, PuzzleDef } from "../../core/types";
import { colName, rowName } from "../../core/names";
import { fireAt, hitCode, reflectCode } from "./beam";
import { obfuscateBitmap } from "../../lib/sha1";

export { cellList, cellName };

export const params = defineSchema({
  width: { type: "int", label: "width", default: 8, min: 2, max: 16 },
  height: { type: "int", label: "height", default: 8, min: 2, max: 16 },
  minBalls: { type: "int", label: "fewest balls", default: 5, min: 1, max: 20 },
  maxBalls: { type: "int", label: "most balls", default: 5, min: 1, max: 20, description: "the number of balls is picked between these; you're told the range" },
});

export interface BlackboxPuzzle {
  w: number;
  h: number;
  minBalls: number;
  maxBalls: number;
  /** Hidden ball cells, row-major, ascending. */
  balls: number[];
}

export interface BlackboxState {
  /** Outcome per entry: an exit entry, the hit or reflect code, or -1 if not fired. */
  shots: number[];
  /** Entries in the order they were fired (both ends of a beam share its number). */
  order: number[];
  /** Entries fired by a check to show a guess wrong. */
  revealed: number[];
  /** Entries a check showed to disagree with the guessed balls. */
  wrong: number[];
  /** Guessed ball per cell. */
  guesses: boolean[];
  /** Cells the player has marked as certainly empty. */
  locks: boolean[];
  checks: number;
  solved: boolean;
}

/** Taking a ball or a lock away undoes the player's own work, so it is a retraction. */
export type BlackboxAction =
  | { type: "fire"; entry: number }
  | { type: "ball"; cells: number[]; value: boolean }
  | { type: "lock"; cells: number[]; value: boolean }
  | { type: "check" };

export interface BlackboxInteraction {
  /** Cursor on the (w+2)×(h+2) board including the laser ring, as y*(w+2)+x. */
  cursor: number;
}

export const ballCount = (s: BlackboxState) => s.guesses.filter(Boolean).length;
export const canCheck = (p: BlackboxPuzzle, s: BlackboxState) => !s.solved && ballCount(s) >= p.minBalls && ballCount(s) <= p.maxBalls;

/** Fires entry e (and records its far end) on a copy of shots; returns the outcome. */
function record(p: BlackboxPuzzle, shots: number[], order: number[], e: number): number {
  const r = fireAt(p.w, p.h, new Set(p.balls), e);
  shots[e] = r;
  order.push(e);
  if (r < hitCode(p.w, p.h)) shots[r] = e;
  return r;
}

const guessed = (s: BlackboxState) => new Set(s.guesses.flatMap((g, c) => (g ? [c] : [])));

export function reduce(p: BlackboxPuzzle, s: BlackboxState, a: BlackboxAction): BlackboxState {
  if (s.solved) return s;
  const n = p.w * p.h, L = 2 * (p.w + p.h);
  switch (a.type) {
    case "fire": {
      if (a.entry < 0 || a.entry >= L || s.shots[a.entry] !== -1) return s;
      const shots = s.shots.slice(), order = s.order.slice();
      record(p, shots, order, a.entry);
      return { ...s, shots, order, wrong: [] };
    }
    case "ball":
    case "lock": {
      const key = a.type === "ball" ? "guesses" : "locks";
      let list: boolean[] | null = null;
      for (const c of a.cells) {
        if (c < 0 || c >= n || s[key][c] === a.value || (a.type === "ball" && s.locks[c])) continue;
        list ??= s[key].slice();
        list[c] = a.value;
      }
      return list ? { ...s, [key]: list } : s;
    }
    case "check": {
      if (!canCheck(p, s)) return s;
      const mine = guessed(s);
      const disagree = (e: number) => fireAt(p.w, p.h, mine, e) !== fireAt(p.w, p.h, new Set(p.balls), e);
      const checks = s.checks + 1;
      const firedWrong = s.order.find(disagree);
      if (firedWrong !== undefined) return { ...s, checks, wrong: [firedWrong] };
      for (let e = 0; e < L; e++) {
        if (s.shots[e] !== -1 || !disagree(e)) continue;
        const shots = s.shots.slice(), order = s.order.slice();
        record(p, shots, order, e);
        return { ...s, shots, order, checks, revealed: [...s.revealed, e], wrong: [e] };
      }
      return { ...s, checks, wrong: [], solved: true };
    }
    default:
      return s;
  }
}

/** The number shown at both ends of each beam that came out somewhere else: 1, 2, … in firing order. */
export function beamLabels(p: BlackboxPuzzle, s: BlackboxState): Map<number, number> {
  const out = new Map<number, number>();
  let next = 1;
  for (const e of s.order) {
    const r = s.shots[e]!;
    if (r >= hitCode(p.w, p.h) || out.has(e)) continue;
    out.set(e, next);
    out.set(r, next);
    next++;
  }
  return out;
}

// --- formats ---

const SGT_RE = /^((?:[whmM]\d+)*)[^:]*:([0-9a-fA-F]+)$/;

/** Simon Tatham's Black Box game id: `w8h8m5M5:hex`, the balls hidden the same way as the original. */
export const sgtFormat: Format<BlackboxPuzzle> = {
  id: "sgt",
  label: "game id (w8h8m5M5:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected params:hex, e.g. w8h8m5M5:1a2b…");
    const opts = { w: 8, h: 8, m: 5, M: 5 };
    for (const [, k, v] of m[1]!.matchAll(/([whmM])(\d+)/g)) opts[k as keyof typeof opts] = Number(v);
    const hex = m[2]!;
    if (hex.length < 4 || hex.length % 4) throw new Error("the game id is the wrong length");
    const count = hex.length / 4 - 1;
    if (count < opts.m || count > opts.M) throw new Error(`the game id has ${count} balls, not between ${opts.m} and ${opts.M}`);
    const bmp = Uint8Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16));
    obfuscateBitmap(bmp, bmp.length * 8, true);
    if (bmp[0] !== opts.w || bmp[1] !== opts.h) throw new Error("the game id is corrupted");
    const balls: number[] = [];
    for (let i = 0; i < count; i++) {
      const x = bmp[2 + 2 * i]!, y = bmp[3 + 2 * i]!;
      if (x >= opts.w || y >= opts.h) throw new Error("the game id is corrupted");
      balls.push(y * opts.w + x);
    }
    if (new Set(balls).size !== balls.length) throw new Error("the game id is corrupted");
    return { w: opts.w, h: opts.h, minBalls: opts.m, maxBalls: opts.M, balls: balls.sort((a, b) => a - b) };
  },
  serialize(p) {
    const bmp = Uint8Array.from([p.w, p.h, ...p.balls.flatMap((c) => [c % p.w, Math.floor(c / p.w)])]);
    obfuscateBitmap(bmp, bmp.length * 8, false);
    const hex = Array.from(bmp, (v) => v.toString(16).padStart(2, "0")).join("");
    return `w${p.w}h${p.h}m${p.minBalls}M${p.maxBalls}:${hex}`;
  },
};

// --- definition ---

/** Focus payload understood by the blackbox view. */
export interface BlackboxFocus {
  /** Arena cells. */
  cells: number[];
  /** Laser entries. */
  entries: number[];
}

function generate(v: Values<typeof params>, rng: Rng): BlackboxPuzzle {
  const lo = Math.min(v.minBalls, v.maxBalls, v.width * v.height), hi = Math.min(Math.max(v.minBalls, v.maxBalls), v.width * v.height);
  const count = lo + rng.int(hi - lo + 1);
  const balls = rng.shuffle(Array.from({ length: v.width * v.height }, (_, i) => i)).slice(0, count).sort((a, b) => a - b);
  return { w: v.width, h: v.height, minBalls: lo, maxBalls: hi, balls };
}

export const blackbox: PuzzleDef<BlackboxPuzzle, BlackboxState, BlackboxAction, BlackboxInteraction, typeof params> = {
  id: "blackbox",
  name: "black box",
  aliases: ["blackbox", "black box", "lasers"],
  tags: ["deduction", "grid"],
  description: "balls are hidden in a box. fire lasers in from the edges and watch where they come out to work out where the balls are.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "5×5, 3 balls", params: { width: 5, height: 5, minBalls: 3, maxBalls: 3 } },
    { label: "8×8, 5 balls", params: { width: 8, height: 8, minBalls: 5, maxBalls: 5 } },
    { label: "8×8, 3 to 6 balls", params: { width: 8, height: 8, minBalls: 3, maxBalls: 6 } },
    { label: "10×10, 5 balls", params: { width: 10, height: 10, minBalls: 5, maxBalls: 5 } },
  ],
  generate,
  formats: [sgtFormat],
  init: (p) => ({
    shots: Array.from({ length: 2 * (p.w + p.h) }, () => -1), order: [], revealed: [], wrong: [],
    guesses: Array.from({ length: p.w * p.h }, () => false), locks: Array.from({ length: p.w * p.h }, () => false), checks: 0, solved: false,
  }),
  initInteraction: (p) => ({ cursor: p.w + 2 + 1 }),
  reduce,
  isRetraction: (a) => (a.type === "ball" || a.type === "lock") && !a.value,
  describeAction: (p, a, _before, after) => {
    switch (a.type) {
      case "fire": {
        const out = after.shots[a.entry]!;
        const what = out === hitCode(p.w, p.h) ? "hit" : out === reflectCode(p.w, p.h) || out === a.entry ? "came back" : out >= 0 ? `came out at ${entryName(p, out).replace(/^the laser /, "")}` : "";
        return `fire ${entryName(p, a.entry).replace(/^the /, "")}${what ? `: ${what}` : ""}`;
      }
      case "ball": return `${a.value ? "ball" : "no ball"} ${cellList(p, a.cells)}`;
      case "lock": return `${a.value ? "lock" : "unlock"} ${cellList(p, a.cells)}`;
      case "check": return after.solved ? "check: right" : "check";
    }
  },
  isSolved: (_p, s) => s.solved,
  rules: (p) => [
    `${p.minBalls === p.maxBalls ? p.minBalls : `between ${p.minBalls} and ${p.maxBalls}`} balls are hidden in the box. fire lasers in from the edges to find them.`,
    "a laser travels straight until something is in its way. a ball straight ahead absorbs it (H, a hit).",
    "a ball diagonally ahead to one side turns the laser away from it, 90°. if balls are diagonally ahead on both sides, it turns round and comes back out where it went in (R, a reflection).",
    "a ball diagonally ahead right at the edge, before the laser even enters, also counts as a reflection.",
    "a laser that comes out somewhere else gets a number, shown at both ends.",
    "place your guesses and check them. any layout that gives the same results for every possible laser counts as right.",
  ],
  solve: (p) => {
    const s = blackbox.init(p);
    return { ...s, guesses: s.guesses.map((_, c) => p.balls.includes(c)), solved: true };
  },
  describe: (p) => `${p.w}×${p.h}, ${p.minBalls === p.maxBalls ? p.minBalls : `${p.minBalls}-${p.maxBalls}`} balls`,
};

/** "the laser above column C". */
export function entryName(p: BlackboxPuzzle, e: number): string {
  const { w, h } = p;
  if (e < w) return `the laser above column ${colName(e)}`;
  if (e < w + h) return `the laser right of row ${rowName(e - w)}`;
  if (e < 2 * w + h) return `the laser below column ${colName(w - 1 - (e - w - h))}`;
  return `the laser left of row ${rowName(h - 1 - (e - 2 * w - h))}`;
}
