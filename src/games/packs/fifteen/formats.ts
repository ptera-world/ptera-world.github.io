import type { Format } from "../../core/types";
import { goalProblem, type Goal } from "./goal";
import type { FifteenPuzzle } from "./logic";
import { checkShift } from "./shift";
import { checkSlide } from "./slide";
import { checkTurn, type Blocks } from "./turn";

const LETTERS = "uldr";
const GOALS: readonly Goal[] = ["order", "gap-first", "spiral", "rows", "quadrants"];

function checkSize(w: number, h: number, max = 16): void {
  if (!(w >= 2 && h >= 2 && w <= max && h <= max)) throw new Error(`each side must be between 2 and ${max}`);
}

/** Every board is checked against its own kind's rules. */
export function check(p: FifteenPuzzle): FifteenPuzzle {
  const problem = goalProblem({ w: p.w, h: p.h, goal: p.goal ?? "order", gap: (p.moves ?? "slide") === "slide" });
  if (problem) throw new Error(problem);
  switch (p.moves) {
    case "shift": return checkShift(p);
    case "turn": return checkTurn(p);
    default: return checkSlide(p);
  }
}

const SLIDE_RE = /^(\d+)(?:x(\d+))?:([\d,\s]+)$/;
const SHIFT_RE = /^(\d+)(?:x(\d+))?(?:m\d+)?:([\d,\s]+)$/;
const TURN_RE = /^(\d+)(?:x(\d+))?n(\d+)([rom\d]*):([\d,uldr]+)$/;

const numbers = (s: string) => s.split(",").map((x) => Number(x.trim()));

/**
 * Simon Tatham's Fifteen (`WxH:` then every cell, 0 for the gap), Sixteen (`WxH[mN]:` then every
 * tile, the move limit ignored) and Twiddle (`WxHnN[r][o][mK]:` then the numbers, separated by
 * commas or, orientable, by u/l/d/r) game ids. Fifteen and Sixteen ids differ only in the 0.
 */
export const sgtFormat: Format<FifteenPuzzle> = {
  id: "sgt",
  label: "sgt game id (fifteen, sixteen or twiddle)",
  detect: (t) => [SLIDE_RE, SHIFT_RE, TURN_RE].some((re) => re.test(t.trim())),
  parse(text) {
    const t = text.trim();
    const turn = TURN_RE.exec(t);
    if (turn) {
      const w = Number(turn[1]), h = Number(turn[2] ?? turn[1]), n = Number(turn[3]);
      checkSize(w, h, 12);
      const flags = turn[4]!.replace(/m\d*/, "");
      const orientable = flags.includes("o");
      const tiles: number[] = [], turns: number[] = [];
      const re = orientable ? /(\d+)([uldr])/y : /(\d+)(,|$)/y;
      const body = turn[5]!;
      while (re.lastIndex < body.length) {
        const m = re.exec(body);
        if (!m) throw new Error(orientable ? "each number must be followed by an orientation letter (u, l, d or r)" : "expected numbers separated by commas");
        tiles.push(Number(m[1]));
        turns.push(orientable ? LETTERS.indexOf(m[2]!) : 0);
      }
      return check({ moves: "turn", w, h, n, blocks: "all", goal: flags.includes("r") ? "rows" : "order", orientable, tiles, turns });
    }
    const m = SHIFT_RE.exec(t);
    if (!m) throw new Error("expected an sgt id like 4x4:1,2,3,…,0 (fifteen), 4x4:1,2,…,16 (sixteen) or 3x3n2:1,2,… (twiddle)");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    checkSize(w, h);
    const tiles = numbers(m[3]!);
    if (tiles.includes(0) && SLIDE_RE.test(t)) return check({ moves: "slide", w, h, goal: "order", tiles });
    return check({ moves: "shift", w, h, goal: "order", tiles });
  },
  serialize(p) {
    const size = `${p.w}x${p.h}`;
    if (p.moves === "turn") {
      if (p.blocks !== "all" || (p.goal !== "order" && p.goal !== "rows")) throw new Error("sgt twiddle ids only hold every block turning, in order or rows only");
      const body = p.orientable ? p.tiles.map((t, c) => `${t}${LETTERS[p.turns[c]!]}`).join("") : p.tiles.join(",");
      return `${size}n${p.n}${p.goal === "rows" ? "r" : ""}${p.orientable ? "o" : ""}:${body}`;
    }
    if ((p.goal ?? "order") !== "order") throw new Error("sgt fifteen and sixteen ids only hold boards finished in reading order");
    return `${size}:${p.tiles.join(",")}`;
  },
};

/** Reads one tile: a number, `.` or `_` for the gap, and (orientable) u/l/d/r for the way it points. */
function cell(t: string, orientable: boolean): { t: number; o: number } {
  if (t === "." || t === "_") return { t: 0, o: 0 };
  const m = /^(\d+)([uldr]?)$/.exec(t);
  if (!m) throw new Error(`can't read "${t}"`);
  if (m[2] && !orientable) throw new Error("orientation letters need 'orientable' in the header");
  return { t: Number(m[1]), o: m[2] ? LETTERS.indexOf(m[2]) : 0 };
}

/**
 * One row per line. Headerless rows are fifteen (a `.`, `_` or 0 for the gap) or sixteen boards
 * finished in reading order; `twiddle block=N [rows] [orientable]` starts a twiddle board, and
 * `fifteen slide|shift|turn [block=N] [blocks=all|corners] [goal=…] [orientable]` any board.
 */
export const gridFormat: Format<FifteenPuzzle> = {
  id: "grid",
  label: "grid (rows of numbers, . for the gap; or a fifteen / twiddle header line first)",
  detect: (t) => /^\s*(twiddle|fifteen)\b/.test(t) || (t.trim().includes("\n") && /^[\d\s._,]+$/.test(t.trim())),
  parse(text) {
    const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const head = /^(twiddle|fifteen)((?:\s+\S+)*)$/.exec(lines[0] ?? "");
    const words = head ? head[2]!.trim().split(/\s+/).filter(Boolean) : [];
    const opt = (k: string) => words.find((x) => x.startsWith(`${k}=`))?.slice(k.length + 1);
    const moves = head?.[1] === "twiddle" ? "turn" : head ? words[0] : undefined;
    if (head && head[1] === "fifteen" && moves !== "slide" && moves !== "shift" && moves !== "turn") throw new Error("the header should name the moves: fifteen slide, fifteen shift or fifteen turn");
    const orientable = words.includes("orientable");
    if (orientable && moves !== "turn") throw new Error("only turning blocks can make tiles point another way");
    const rows = lines.slice(head ? 1 : 0).map((r) => r.split(/[\s,]+/));
    const h = rows.length, w = rows[0]?.length ?? 0;
    if (rows.some((r) => r.length !== w)) throw new Error("rows have different lengths");
    checkSize(w, h);
    const cells = rows.flat().map((t) => cell(t, orientable));
    const tiles = cells.map((c) => c.t);
    const goalWord = opt("goal") ?? (words.includes("rows") ? "rows" : "order");
    if (!GOALS.includes(goalWord as Goal)) throw new Error(`unknown goal "${goalWord}" (${GOALS.join(", ")})`);
    const goal = goalWord as Goal;
    if (moves === "turn") {
      const blocks = (opt("blocks") ?? "all") as Blocks;
      if (blocks !== "all" && blocks !== "corners") throw new Error(`unknown blocks "${blocks}" (all, corners)`);
      return check({ moves: "turn", w, h, n: Number(opt("block") ?? 2), blocks, goal, orientable, tiles, turns: cells.map((c) => c.o) });
    }
    const slide = moves ? moves === "slide" : tiles.includes(0);
    return check(slide ? { moves: "slide", w, h, goal, tiles } : { moves: "shift", w, h, goal, tiles });
  },
  serialize(p) {
    const width = String(Math.max(...p.tiles)).length + (p.moves === "turn" && p.orientable ? 1 : 0);
    const text = (c: number) => {
      const t = p.tiles[c]!;
      if (p.moves === "turn") return `${t}${p.orientable && p.turns[c] ? LETTERS[p.turns[c]!] : ""}`.padEnd(width);
      return (p.moves !== "shift" && t === 0 ? "." : String(t)).padStart(width);
    };
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) rows.push(Array.from({ length: p.w }, (_, x) => text(y * p.w + x)).join(" ").trimEnd());
    const goal = p.goal ?? "order";
    let head: string | null = null;
    if (p.moves === "turn") {
      head = p.blocks === "all" && (goal === "order" || goal === "rows")
        ? `twiddle block=${p.n}${goal === "rows" ? " rows" : ""}${p.orientable ? " orientable" : ""}`
        : `fifteen turn block=${p.n} blocks=${p.blocks} goal=${goal}${p.orientable ? " orientable" : ""}`;
    } else if (goal !== "order") head = `fifteen ${p.moves ?? "slide"} goal=${goal}`;
    return [...(head ? [head] : []), ...rows].join("\n");
  },
};

