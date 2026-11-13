import { isRed, rankOf, suitOf } from "../../lib/cards/deck";

/** How a card goes on another in a column: one rank lower and… */
export type Build = "alternate" | "suit" | "any" | "color" | "other";
/**
 * What moves together out of a column: built = any run that follows the build rule; suit = a
 * run in one suit; any = any face-up cards; space = a built run as long as the free cells and
 * empty columns could move one card at a time; one = one card at a time.
 */
export type Runs = "built" | "suit" | "any" | "space" | "one";
export type Empty = "any" | "kings" | "none";

export interface Rules {
  build: Build;
  /** Builds up as well as down. */
  updown: boolean;
  runs: Runs;
  /** What may go into an empty column. */
  empty: Empty;
  /** cards: foundations built up ace to king a card at a time; runs: only a whole king-to-ace run in one suit goes home, by itself. */
  home: "cards" | "runs";
  /** Cards may come back down from a foundation (cards home only). */
  takeBack: boolean;
  /** What a click on the stock does: turn cards onto the waste, or deal a card onto every column. */
  stock: "waste" | "row";
  /** Waste: cards turned per click. */
  draw: number;
  /** Waste: passes through the stock allowed; 0 for no limit. */
  passes: number;
  /** Row: no deal while a column is empty. */
  fillFirst: boolean;
}

/**
 * Pile numbers of a table: the stock and waste when there are any (-1 otherwise), then the free
 * cells, the foundations and the columns, each a block starting at the given number.
 */
export interface Idx {
  stock: number;
  waste: number;
  cells: number;
  found: number;
  cols: number;
  total: number;
}

/** Everything about a deal that play depends on but the position doesn't. */
export interface Ctx {
  rules: Rules;
  /** Face of each card id. */
  faces: readonly number[];
  idx: Idx;
  /** Suit each foundation is built in. */
  fsuit: readonly number[];
  /** Copies of each face in the deck. */
  copies: readonly number[];
}

/** A position: card ids, bottom first. */
export interface Pos {
  /** The last card is drawn or dealt next. */
  stock: number[];
  /** The last card is the one in play. */
  waste: number[];
  /** -1 for an empty cell. */
  cells: number[];
  found: number[][];
  cols: number[][];
  /** Face-down cards at the bottom of each column. */
  down: number[];
  /** Times the waste has gone back into the stock. */
  recycles: number;
}

/** One step of a plan: click the stock `draws` times, then move `n` cards (none when 0). */
export interface Move {
  draws: number;
  from: number;
  to: number;
  n: number;
}

export interface Search {
  path: Move[] | null;
  /** The search ended without a budget cut: no win exists among the moves it tries. */
  impossible: boolean;
  nodes: number;
}

/** Foundations in deck order (clubs, diamonds, hearts, spades for each deck), one per 13 cards of a suit. */
export function foundationSuits(faces: readonly number[]): number[] {
  const aces = [0, 0, 0, 0];
  for (const f of faces) if (rankOf(f) === 1) aces[suitOf(f)]!++;
  const out: number[] = [];
  for (let k = 0; k < Math.max(...aces); k++) for (let s = 0; s < 4; s++) if (aces[s]! > k) out.push(s);
  return out;
}

export function makeCtx(rules: Rules, faces: readonly number[], idx: Idx): Ctx {
  const copies = Array<number>(52).fill(0);
  for (const f of faces) copies[f]!++;
  return { rules, faces, idx, fsuit: foundationSuits(faces), copies };
}

export const clonePos = (p: Pos): Pos => ({
  stock: p.stock.slice(), waste: p.waste.slice(), cells: p.cells.slice(), found: p.found.map((f) => f.slice()),
  cols: p.cols.map((c) => c.slice()), down: p.down.slice(), recycles: p.recycles,
});

const face = (c: Ctx, id: number) => c.faces[id]!;
export const sameSuit = (c: Ctx, a: number, b: number): boolean => suitOf(face(c, a)) === suitOf(face(c, b));

/** Faces `upper` can go on `lower` under a build rule. */
export function buildsOn(build: Build, updown: boolean, upper: number, lower: number): boolean {
  const d = rankOf(lower) - rankOf(upper);
  if (d !== 1 && !(updown && d === -1)) return false;
  switch (build) {
    case "alternate": return isRed(upper) !== isRed(lower);
    case "suit": return suitOf(upper) === suitOf(lower);
    case "color": return isRed(upper) === isRed(lower);
    case "other": return suitOf(upper) !== suitOf(lower);
    case "any": return true;
  }
}

/** Card `upper` can go on card `lower` in a column. */
export const onto = (c: Ctx, upper: number, lower: number): boolean => buildsOn(c.rules.build, c.rules.updown, face(c, upper), face(c, lower));

/** Cards at the top of a column that may be picked up together under the run rule, ignoring free space. */
export function movable(c: Ctx, col: readonly number[], down: number): number {
  if (col.length <= down) return 0;
  const runs = c.rules.runs;
  if (runs === "any") return col.length - down;
  if (runs === "one") return 1;
  let k = 1;
  while (col.length - k - 1 >= down) {
    const a = col[col.length - k]!, b = col[col.length - k - 1]!;
    if (!onto(c, a, b) || (runs === "suit" && !sameSuit(c, a, b))) break;
    k++;
  }
  return k;
}

/** How many cards free space lets move at once (space and one only): (free cells + 1) doubled per spare empty column that takes any card. */
export function capacity(c: Ctx, p: Pos, toEmpty: boolean): number {
  if (c.rules.runs === "one") return 1;
  if (c.rules.runs !== "space") return Infinity;
  const free = p.cells.filter((x) => x < 0).length;
  const empty = c.rules.empty === "any" ? p.cols.filter((col) => !col.length).length - (toEmpty ? 1 : 0) : 0;
  return (free + 1) * 2 ** Math.max(0, empty);
}

export function fillsEmpty(c: Ctx, lead: number): boolean {
  return c.rules.empty === "any" || (c.rules.empty === "kings" && rankOf(face(c, lead)) === 13);
}

/** The foundation a card can go on now (cards home), or -1. */
export function homeFor(c: Ctx, p: Pos, id: number): number {
  if (c.rules.home !== "cards") return -1;
  const f = face(c, id);
  for (let i = 0; i < p.found.length; i++) if (c.fsuit[i] === suitOf(f) && p.found[i]!.length === rankOf(f) - 1) return i;
  return -1;
}

/** Cards of a face already on the foundations. */
function homeCount(c: Ctx, p: Pos, f: number): number {
  let n = 0;
  for (let i = 0; i < p.found.length; i++) if (c.fsuit[i] === suitOf(f) && p.found[i]!.length >= rankOf(f)) n++;
  return n;
}

/**
 * A card nothing could ever need to build on again, that can go home now: aces and twos, and any
 * other card once every card that could go on it is home. Never with up-or-down building above two.
 */
export function isSafeHome(c: Ctx, p: Pos, id: number): boolean {
  if (homeFor(c, p, id) < 0) return false;
  const f = face(c, id), r = rankOf(f);
  if (r <= 2) return true;
  if (c.rules.updown) return false;
  for (let s = 0; s < 4; s++) {
    const below = s * 13 + r - 2;
    if (c.copies[below] && buildsOn(c.rules.build, false, below, f) && homeCount(c, p, below) < c.copies[below]!) return false;
  }
  return true;
}

export const canRecycle = (r: Rules, recycles: number): boolean => r.passes === 0 || recycles < r.passes - 1;

/** One click on the stock, in place: draw, deal a row, or turn the waste over. False if none is possible. */
export function click(c: Ctx, p: Pos): boolean {
  const r = c.rules;
  if (r.stock === "row") {
    if (!p.stock.length || (r.fillFirst && p.cols.some((col) => !col.length))) return false;
    for (let j = 0; j < p.cols.length && p.stock.length; j++) p.cols[j]!.push(p.stock.pop()!);
    collect(c, p);
    return true;
  }
  if (p.stock.length) {
    for (let i = 0; i < r.draw && p.stock.length; i++) p.waste.push(p.stock.pop()!);
    return true;
  }
  if (p.waste.length && canRecycle(r, p.recycles)) {
    p.stock = p.waste.reverse();
    p.waste = [];
    p.recycles++;
    return true;
  }
  return false;
}

const flip = (p: Pos, j: number) => {
  const col = p.cols[j]!;
  if (p.down[j]! >= col.length) p.down[j] = Math.max(0, col.length - 1);
};

/** Face-up cards at the top of a column running down in one suit. */
function suitRun(c: Ctx, col: readonly number[], down: number): number {
  if (col.length <= down) return 0;
  let k = 1;
  while (col.length - k - 1 >= down) {
    const a = face(c, col[col.length - k]!), b = face(c, col[col.length - k - 1]!);
    if (rankOf(b) !== rankOf(a) + 1 || suitOf(a) !== suitOf(b)) break;
    k++;
  }
  return k;
}

/** Runs home: every column topped by a face-up king-to-ace run in one suit sends it home. Returns how many. */
export function collect(c: Ctx, p: Pos): number {
  if (c.rules.home !== "runs") return 0;
  let n = 0;
  for (let j = 0; j < p.cols.length; j++) {
    const col = p.cols[j]!;
    if (col.length < 13 || suitRun(c, col, p.down[j]!) < 13 || rankOf(face(c, col[col.length - 13]!)) !== 13) continue;
    const suit = suitOf(face(c, col[col.length - 1]!));
    const f = p.found.findIndex((pl, i) => !pl.length && c.fsuit[i] === suit);
    if (f < 0) continue;
    p.found[f] = col.splice(col.length - 13, 13).reverse();
    flip(p, j);
    n++;
  }
  return n;
}

/** Apply a move in place (no checks). */
export function applyMove(c: Ctx, p: Pos, m: Move): void {
  for (let i = 0; i < m.draws; i++) click(c, p);
  if (m.n === 0) return;
  const I = c.idx;
  let cards: number[];
  if (m.from === I.waste) cards = [p.waste.pop()!];
  else if (m.from < I.found) { const i = m.from - I.cells; cards = [p.cells[i]!]; p.cells[i] = -1; }
  else if (m.from < I.cols) cards = [p.found[m.from - I.found]!.pop()!];
  else {
    const j = m.from - I.cols;
    const col = p.cols[j]!;
    cards = col.splice(col.length - m.n, m.n);
    flip(p, j);
  }
  if (m.to < I.found) p.cells[m.to - I.cells] = cards[0]!;
  else if (m.to < I.cols) p.found[m.to - I.found]!.push(cards[0]!);
  else p.cols[m.to - I.cols]!.push(...cards);
  collect(c, p);
}

/** The cards a pile holds, top last. */
function cardsAt(c: Ctx, p: Pos, pile: number): readonly number[] {
  const I = c.idx;
  if (pile === I.stock) return p.stock;
  if (pile === I.waste) return p.waste;
  if (pile < I.found) { const x = p.cells[pile - I.cells]; return x === undefined || x < 0 ? [] : [x]; }
  if (pile < I.cols) return p.found[pile - I.found] ?? [];
  return p.cols[pile - I.cols] ?? [];
}

/** Whether a player's move is allowed. */
export function isLegal(c: Ctx, p: Pos, m: { from: number; to: number; n: number }): boolean {
  const I = c.idx, R = c.rules;
  if (m.from === m.to || m.n < 1 || m.from < 0 || m.to < I.cells || m.from >= I.total || m.to >= I.total || m.from === I.stock) return false;
  const src = cardsAt(c, p, m.from);
  if (m.n > src.length) return false;
  const fromCol = m.from >= I.cols;
  if (!fromCol && m.n !== 1) return false;
  if (m.from >= I.found && m.from < I.cols && (R.home !== "cards" || !R.takeBack || m.to < I.cols)) return false;
  const j = m.from - I.cols;
  if (fromCol && m.n > movable(c, p.cols[j]!, p.down[j]!)) return false;
  const lead = src[src.length - m.n]!;
  if (m.to < I.found) return m.n === 1 && p.cells[m.to - I.cells]! < 0;
  if (m.to < I.cols) return m.n === 1 && homeFor(c, p, lead) === m.to - I.found;
  const dst = p.cols[m.to - I.cols]!;
  if (!dst.length) return fillsEmpty(c, lead) && (!fromCol || m.n <= capacity(c, p, true));
  return onto(c, lead, dst[dst.length - 1]!) && (!fromCol || m.n <= capacity(c, p, false));
}

/** Calls `visit` with every safe move home among the waste card, the free cells and the column tops, until it returns true. */
export function eachSafeHomeMove(c: Ctx, p: Pos, visit: (m: Move) => boolean | void): void {
  if (c.rules.home !== "cards") return;
  const I = c.idx;
  const tryCard = (id: number | undefined, from: number) => id !== undefined && id >= 0 && isSafeHome(c, p, id) && visit({ draws: 0, from, to: I.found + homeFor(c, p, id), n: 1 }) === true;
  if (I.waste >= 0 && tryCard(p.waste[p.waste.length - 1], I.waste)) return;
  for (let i = 0; i < p.cells.length; i++) if (tryCard(p.cells[i], I.cells + i)) return;
  for (let j = 0; j < p.cols.length; j++) if (tryCard(p.cols[j]![p.cols[j]!.length - 1], I.cols + j)) return;
}

export function safeHomeMove(c: Ctx, p: Pos): Move | null {
  let found: Move | null = null;
  eachSafeHomeMove(c, p, (m) => { found = m; return true; });
  return found;
}

/**
 * Moves worth searching. A run moves off the card it is built on only when that card can then go
 * home or the run lands on its own suit; whole columns never move into an empty one, and only the
 * first empty column and free cell are tried. Cards reachable by turning the stock come as one
 * step with their clicks.
 */
export function moves(c: Ctx, p: Pos): Move[] {
  const R = c.rules, I = c.idx;
  const out: Move[] = [];
  const firstEmpty = p.cols.findIndex((col) => !col.length);
  const firstCell = p.cells.indexOf(-1);
  const plays = (id: number, from: number, draws: number, toCell: boolean) => {
    const h = homeFor(c, p, id);
    if (h >= 0) out.push({ draws, from, to: I.found + h, n: 1 });
    for (let j = 0; j < p.cols.length; j++) {
      const col = p.cols[j]!;
      if (col.length && onto(c, id, col[col.length - 1]!)) out.push({ draws, from, to: I.cols + j, n: 1 });
    }
    if (firstEmpty >= 0 && fillsEmpty(c, id)) out.push({ draws, from, to: I.cols + firstEmpty, n: 1 });
    if (toCell && firstCell >= 0) out.push({ draws, from, to: I.cells + firstCell, n: 1 });
  };
  for (let i = 0; i < p.cells.length; i++) if (p.cells[i]! >= 0) plays(p.cells[i]!, I.cells + i, 0, false);
  const freeSpace = R.runs === "space" || R.runs === "one";
  const capTo = capacity(c, p, false), capEmpty = capacity(c, p, true);
  for (let i = 0; i < p.cols.length; i++) {
    const col = p.cols[i]!;
    if (!col.length) continue;
    const top = col[col.length - 1]!;
    const h = homeFor(c, p, top);
    if (h >= 0) out.push({ draws: 0, from: I.cols + i, to: I.found + h, n: 1 });
    const u = p.down[i]!;
    const run = movable(c, col, u);
    if (freeSpace) {
      for (let j = 0; j < p.cols.length; j++) {
        if (j === i) continue;
        const dst = p.cols[j]!;
        if (dst.length) {
          for (let k = 1; k <= Math.min(run, capTo); k++) if (onto(c, col[col.length - k]!, dst[dst.length - 1]!)) out.push({ draws: 0, from: I.cols + i, to: I.cols + j, n: k });
        } else if (j === firstEmpty) {
          for (let k = Math.min(run, capEmpty, col.length - 1); k >= 1; k--) if (fillsEmpty(c, col[col.length - k]!)) out.push({ draws: 0, from: I.cols + i, to: I.cols + j, n: k });
        }
      }
    } else {
      for (let n = run; n >= 1; n--) {
        const k = col.length - n, lead = col[k]!;
        const held = k - 1 >= u && onto(c, lead, col[k - 1]!);
        const parentHome = held && homeFor(c, p, col[k - 1]!) >= 0;
        const whole = n === run;
        for (let j = 0; j < p.cols.length; j++) {
          if (j === i) continue;
          const dst = p.cols[j]!;
          if (dst.length) {
            const t = dst[dst.length - 1]!;
            if (onto(c, lead, t) && (!held || parentHome || sameSuit(c, lead, t))) out.push({ draws: 0, from: I.cols + i, to: I.cols + j, n });
          } else if (j === firstEmpty && k > 0 && (whole || !held || parentHome) && fillsEmpty(c, lead)) {
            out.push({ draws: 0, from: I.cols + i, to: I.cols + j, n });
          }
        }
      }
    }
    if (firstCell >= 0) out.push({ draws: 0, from: I.cols + i, to: I.cells + firstCell, n: 1 });
  }
  if (R.home === "cards" && R.takeBack) {
    for (let f = 0; f < p.found.length; f++) {
      const pl = p.found[f]!;
      if (pl.length < 3) continue;
      const card = pl[pl.length - 1]!;
      for (let j = 0; j < p.cols.length; j++) {
        const col = p.cols[j]!;
        if (col.length && onto(c, card, col[col.length - 1]!)) out.push({ draws: 0, from: I.found + f, to: I.cols + j, n: 1 });
      }
    }
  }
  if (I.stock >= 0 && R.stock === "waste") {
    const t = clonePos(p);
    const seen = new Set<number>();
    const limit = Math.ceil(p.stock.length / R.draw) + 1 + Math.ceil((p.stock.length + p.waste.length) / R.draw) + 1;
    for (let k = 0; k <= limit; k++) {
      if (k > 0 && !click(c, t)) break;
      const w = t.waste[t.waste.length - 1];
      if (w === undefined || seen.has(w)) continue;
      seen.add(w);
      plays(w, I.waste, k, true);
    }
  } else if (I.stock >= 0 && click(c, clonePos(p))) {
    out.push({ draws: 1, from: I.stock, to: I.stock, n: 0 });
  }
  return out;
}

const homeCards = (p: Pos) => p.found.reduce((n, f) => n + f.length, 0);
export const isWon = (c: Ctx, p: Pos): boolean => homeCards(p) === c.faces.length;

const str = (c: Ctx, ids: readonly number[]) => String.fromCharCode(...ids.map((x) => c.faces[x]! + 48));

function key(c: Ctx, p: Pos): string {
  const cols = p.cols.map((col, j) => `${p.down[j]}:${str(c, col)}`).sort();
  const cells = str(c, p.cells.filter((x) => x >= 0).sort((a, b) => c.faces[a]! - c.faces[b]!));
  const stock = c.rules.stock === "row" ? String(p.stock.length) : `${str(c, p.stock)}|${str(c, p.waste)}|${c.rules.passes ? p.recycles : ""}`;
  return `${p.found.map((f) => f.length).join(",")}|${cells}|${stock}|${cols.join(",")}`;
}

/** Search settings per kind of game, tuned on the games they come from. */
interface Tuning {
  score(c: Ctx, p: Pos): number;
  /** Weight of the moves made so far against the estimate. */
  g: number;
  /** Extra cost of one stock click against one move. */
  click: number;
}

/** Spider-like: complete runs, few face-down cards, columns in order. */
const RUNS_TUNING: Tuning = {
  g: 0.05, click: 0,
  score(c, p) {
    let h = (p.found.length - p.found.filter((f) => f.length).length) * 40 + p.stock.length * 2;
    for (let j = 0; j < p.cols.length; j++) {
      const col = p.cols[j]!;
      h += p.down[j]! * 4;
      if (!col.length) { h -= 3; continue; }
      for (let i = Math.max(1, p.down[j]!); i < col.length; i++) {
        if (!onto(c, col[i]!, col[i - 1]!)) h += 2;
        else if (!sameSuit(c, col[i]!, col[i - 1]!)) h += 1;
      }
    }
    return h;
  },
};

/** FreeCell-like: cards home, the next cards for each foundation near the top, cells free, columns in order. */
const SPACE_TUNING: Tuning = {
  g: 0.5, click: 2,
  score(c, p) {
    let h = (c.faces.length - homeCards(p)) * 4;
    for (let f = 0; f < p.found.length; f++) {
      const r = p.found[f]!.length;
      if (r === 13) continue;
      const want = c.fsuit[f]! * 13 + r;
      for (const col of p.cols) {
        const at = col.findIndex((id) => c.faces[id] === want);
        if (at >= 0) { h += (col.length - 1 - at) * 2; break; }
      }
    }
    for (const x of p.cells) if (x >= 0) h += 1;
    for (const col of p.cols) {
      if (!col.length) { h -= 2; continue; }
      for (let i = 1; i < col.length; i++) if (!onto(c, col[i]!, col[i - 1]!)) h += 1;
    }
    return h;
  },
};

/** Klondike-like: cards home, face-down cards turned over. */
const DIG_TUNING: Tuning = {
  g: 0.5, click: 2,
  score(c, p) {
    let h = (c.faces.length - homeCards(p)) * 4;
    for (const d of p.down) h += d * 3;
    for (let j = 0; j < p.cols.length; j++) {
      const col = p.cols[j]!;
      if (!col.length) { h -= 1; continue; }
      for (let i = p.down[j]! + 1; i < col.length; i++) if (!onto(c, col[i]!, col[i - 1]!)) h += 1;
    }
    for (const x of p.cells) if (x >= 0) h += 1;
    return h;
  },
};

const tuningOf = (r: Rules): Tuning => (r.home === "runs" ? RUNS_TUNING : r.runs === "space" || r.runs === "one" ? SPACE_TUNING : DIG_TUNING);

/** Nodes a search may expand: for dealing, for a hint, and by default. */
export function budgets(r: Rules): { deal: number; hint: number; full: number } {
  if (r.home === "runs") return { deal: 40_000, hint: 20_000, full: 40_000 };
  if (r.runs === "space" || r.runs === "one") return { deal: 150_000, hint: 40_000, full: 150_000 };
  return { deal: 30_000, hint: 30_000, full: 60_000 };
}

interface Node { pos: Pos; moves: Move[]; parent: Node | null; f: number; g: number }

class Heap {
  private a: Node[] = [];
  get size() { return this.a.length; }
  push(n: Node): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (a[j]!.f <= n.f) break;
      a[i] = a[j]!;
      i = j;
    }
    a[i] = n;
  }
  pop(): Node {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mf = last.f;
        if (l < a.length && a[l]!.f < mf) { m = l; mf = a[l]!.f; }
        if (r < a.length && a[r]!.f < mf) m = r;
        if (m === i) break;
        a[i] = a[m]!;
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

function autoHome(c: Ctx, p: Pos): Move[] {
  const out: Move[] = [];
  for (let m = safeHomeMove(c, p); m; m = safeHomeMove(c, p)) { applyMove(c, p, m); out.push(m); }
  return out;
}

/** Best-first search for a win, safe moves home taken as soon as they appear. Deterministic per budget (nodes expanded). */
export function solve(c: Ctx, start: Pos, budget = budgets(c.rules).full): Search {
  const t = tuningOf(c.rules);
  const pos = clonePos(start);
  const first = autoHome(c, pos);
  const seen = new Set<string>([key(c, pos)]);
  const open = new Heap();
  open.push({ pos, moves: first, parent: null, f: t.score(c, pos), g: 0 });
  let nodes = 0;
  while (open.size) {
    const n = open.pop();
    if (isWon(c, n.pos)) {
      const path: Move[] = [];
      for (let x: Node | null = n; x; x = x.parent) path.unshift(...x.moves);
      return { path, impossible: false, nodes };
    }
    if (++nodes > budget) return { path: null, impossible: false, nodes };
    for (const m of moves(c, n.pos)) {
      const q = clonePos(n.pos);
      applyMove(c, q, m);
      const auto = autoHome(c, q);
      const k = key(c, q);
      if (seen.has(k)) continue;
      seen.add(k);
      const g = n.g + 1 + (m.n ? m.draws * t.click : 0);
      open.push({ pos: q, moves: [m, ...auto], parent: n, f: t.score(c, q) + g * t.g, g });
    }
  }
  return { path: null, impossible: true, nodes };
}
