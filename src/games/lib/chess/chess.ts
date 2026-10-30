/**
 * Chess rules with no dependencies: positions (from the start or FEN), legal moves (castling, en
 * passant, promotion, check, pins), playing a move, and SAN in both directions.
 *
 * Positions are plain immutable data; `play` returns a new one. Squares are 0..63, a1 = 0, h1 = 7,
 * a8 = 56. A piece is its FEN letter (uppercase white, lowercase black); "" is an empty square.
 * Legality is decided by playing each candidate and asking whether the mover's king is attacked,
 * which covers pins, discovered checks and en passant across a pinned rank without special cases.
 */

export type Color = "w" | "b";
export type Square = number;
export type Promotion = "n" | "b" | "r" | "q";

export interface Position {
  /** 64 squares, a1 first. */
  readonly board: readonly string[];
  readonly turn: Color;
  /** Castling rights still held, a subset of "KQkq" in that order ("" for none). */
  readonly castling: string;
  /** The square a pawn just skipped over (en passant target), or null. */
  readonly ep: Square | null;
  readonly halfmove: number;
  readonly fullmove: number;
}

export interface Move {
  readonly from: Square;
  readonly to: Square;
  readonly promotion?: Promotion;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const FILES = "abcdefgh";
const fileOf = (s: Square) => s & 7;
const rankOf = (s: Square) => s >> 3;
export const squareName = (s: Square): string => FILES[fileOf(s)]! + (rankOf(s) + 1);
export function parseSquare(name: string): Square | null {
  const f = FILES.indexOf(name[0] ?? ""), r = Number(name[1]) - 1;
  return name.length === 2 && f >= 0 && r >= 0 && r < 8 ? r * 8 + f : null;
}

const colorOf = (pc: string): Color | null => (pc === "" ? null : pc === pc.toUpperCase() ? "w" : "b");
const typeOf = (pc: string) => pc.toLowerCase();
const other = (c: Color): Color => (c === "w" ? "b" : "w");
const piece = (type: string, c: Color) => (c === "w" ? type.toUpperCase() : type);

const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const KING_DIRS = [...ROOK_DIRS, ...BISHOP_DIRS];
const KNIGHT_JUMPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;

/** The square `df` files and `dr` ranks from `s`, or -1 off the board. */
function step(s: Square, df: number, dr: number): Square {
  const f = fileOf(s) + df, r = rankOf(s) + dr;
  return f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1;
}

export function fromFen(fen: string): Position {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const rows = placement?.split("/") ?? [];
  if (rows.length !== 8) throw new Error(`FEN needs 8 ranks: ${fen}`);
  const board: string[] = Array(64).fill("");
  rows.forEach((row, i) => {
    let f = 0;
    for (const c of row) {
      if (/[1-8]/.test(c)) f += Number(c);
      else if (/[pnbrqkPNBRQK]/.test(c) && f < 8) board[(7 - i) * 8 + f++] = c;
      else throw new Error(`bad FEN rank "${row}": ${fen}`);
    }
    if (f !== 8) throw new Error(`FEN rank "${row}" isn't 8 squares: ${fen}`);
  });
  if (board.filter((p) => p === "K").length !== 1 || board.filter((p) => p === "k").length !== 1) throw new Error(`FEN needs one king a side: ${fen}`);
  if (turn !== "w" && turn !== "b") throw new Error(`FEN side to move must be w or b: ${fen}`);
  if (castling === undefined || !/^(-|K?Q?k?q?)$/.test(castling)) throw new Error(`bad FEN castling "${castling}": ${fen}`);
  const epSq = ep === undefined || ep === "-" ? null : parseSquare(ep);
  if (ep !== undefined && ep !== "-" && epSq === null) throw new Error(`bad FEN en passant "${ep}": ${fen}`);
  return { board, turn, castling: castling === "-" ? "" : castling, ep: epSq, halfmove: Number(half ?? 0) || 0, fullmove: Number(full ?? 1) || 1 };
}

export function toFen(p: Position): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = "", empty = 0;
    for (let f = 0; f < 8; f++) {
      const pc = p.board[r * 8 + f]!;
      if (pc === "") empty++;
      else { row += (empty || "") + pc; empty = 0; }
    }
    rows.push(row + (empty || ""));
  }
  return `${rows.join("/")} ${p.turn} ${p.castling || "-"} ${p.ep === null ? "-" : squareName(p.ep)} ${p.halfmove} ${p.fullmove}`;
}

export const startPosition = (): Position => fromFen(START_FEN);

/** True if any piece of color `by` attacks `sq`. */
export function attacked(board: readonly string[], sq: Square, by: Color): boolean {
  const is = (s: Square, type: string) => s >= 0 && board[s] === piece(type, by);
  // a pawn of `by` attacks diagonally forward, so it stands diagonally behind `sq`
  const back = by === "w" ? -1 : 1;
  if (is(step(sq, -1, back), "p") || is(step(sq, 1, back), "p")) return true;
  if (KNIGHT_JUMPS.some(([df, dr]) => is(step(sq, df, dr), "n"))) return true;
  if (KING_DIRS.some(([df, dr]) => is(step(sq, df, dr), "k"))) return true;
  const slides = (dirs: readonly (readonly [number, number])[], types: string) =>
    dirs.some(([df, dr]) => {
      for (let s = step(sq, df, dr); s >= 0; s = step(s, df, dr)) {
        if (board[s] === "") continue;
        return colorOf(board[s]!) === by && types.includes(typeOf(board[s]!));
      }
      return false;
    });
  return slides(ROOK_DIRS, "rq") || slides(BISHOP_DIRS, "bq");
}

export function inCheck(p: Position): boolean {
  return attacked(p.board, p.board.indexOf(piece("k", p.turn)), other(p.turn));
}

/** Moves that follow how the pieces move, ignoring whether they leave the mover's king attacked (castling is fully checked here). */
function pseudoMoves(p: Position): Move[] {
  const { board, turn } = p;
  const out: Move[] = [];
  const mine = (s: Square) => colorOf(board[s]!) === turn;
  const theirs = (s: Square) => colorOf(board[s]!) === other(turn);
  for (let from = 0; from < 64; from++) {
    if (!mine(from)) continue;
    const type = typeOf(board[from]!);
    if (type === "p") {
      const fwd = turn === "w" ? 1 : -1;
      const startRank = turn === "w" ? 1 : 6, lastRank = turn === "w" ? 7 : 0;
      const add = (to: Square) => {
        if (rankOf(to) === lastRank) for (const promotion of ["q", "r", "b", "n"] as const) out.push({ from, to, promotion });
        else out.push({ from, to });
      };
      const one = step(from, 0, fwd);
      if (one >= 0 && board[one] === "") {
        add(one);
        const two = step(from, 0, 2 * fwd);
        if (rankOf(from) === startRank && board[two] === "") out.push({ from, to: two });
      }
      for (const df of [-1, 1]) {
        const to = step(from, df, fwd);
        if (to >= 0 && (theirs(to) || to === p.ep)) add(to);
      }
      continue;
    }
    const targets = (dirs: readonly (readonly [number, number])[], slide: boolean) => {
      for (const [df, dr] of dirs) {
        for (let to = step(from, df, dr); to >= 0; to = step(to, df, dr)) {
          if (mine(to)) break;
          out.push({ from, to });
          if (!slide || board[to] !== "") break;
        }
      }
    };
    if (type === "n") targets(KNIGHT_JUMPS, false);
    else if (type === "b") targets(BISHOP_DIRS, true);
    else if (type === "r") targets(ROOK_DIRS, true);
    else if (type === "q") targets(KING_DIRS, true);
    else {
      targets(KING_DIRS, false);
      // castling: rights held, rook home, squares between empty, king not in check and not passing an attacked square
      const home = turn === "w" ? 4 : 60;
      if (from !== home) continue;
      const enemy = other(turn);
      const sides = [{ right: "K", rook: home + 3, to: home + 2, between: [home + 1, home + 2] }, { right: "Q", rook: home - 4, to: home - 2, between: [home - 1, home - 2, home - 3] }];
      for (const { right, rook, to, between } of sides) {
        if (!p.castling.includes(turn === "w" ? right : right.toLowerCase())) continue;
        if (board[rook] !== piece("r", turn) || between.some((s) => board[s] !== "")) continue;
        if ([home, home + Math.sign(to - home)].some((s) => attacked(board, s, enemy))) continue;
        out.push({ from, to });
      }
    }
  }
  return out;
}

/** Every legal move for the side to move. */
export function legalMoves(p: Position): Move[] {
  return pseudoMoves(p).filter((m) => {
    const next = play(p, m);
    return !attacked(next.board, next.board.indexOf(piece("k", p.turn)), next.turn);
  });
}

const CORNER_RIGHTS: Record<number, string> = { 0: "Q", 7: "K", 56: "q", 63: "k" };

/** The position after `m`, which must be legal (see legalMoves); not checked here. */
export function play(p: Position, m: Move): Position {
  const board = p.board.slice();
  const pc = board[m.from]!;
  const type = typeOf(pc);
  const capture = board[m.to] !== "" || (type === "p" && m.to === p.ep);
  if (type === "p" && m.to === p.ep) board[m.to + (p.turn === "w" ? -8 : 8)] = "";
  board[m.to] = m.promotion ? piece(m.promotion, p.turn) : pc;
  board[m.from] = "";
  let castling = p.castling;
  if (type === "k") {
    if (m.to - m.from === 2) { board[m.from + 1] = board[m.from + 3]!; board[m.from + 3] = ""; }
    if (m.from - m.to === 2) { board[m.from - 1] = board[m.from - 4]!; board[m.from - 4] = ""; }
    castling = castling.replace(p.turn === "w" ? /[KQ]/g : /[kq]/g, "");
  }
  for (const s of [m.from, m.to]) if (CORNER_RIGHTS[s]) castling = castling.replace(CORNER_RIGHTS[s]!, "");
  return {
    board,
    turn: other(p.turn),
    castling,
    ep: type === "p" && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : null,
    halfmove: type === "p" || capture ? 0 : p.halfmove + 1,
    fullmove: p.fullmove + (p.turn === "b" ? 1 : 0),
  };
}

/** `m` in standard algebraic notation (e.g. "Nbd7", "exd5", "e8=Q+", "O-O-O#"). `m` must be legal. */
export function toSan(p: Position, m: Move, legal: readonly Move[] = legalMoves(p)): string {
  const pc = p.board[m.from]!;
  const type = typeOf(pc);
  let san: string;
  if (type === "k" && Math.abs(m.to - m.from) === 2) san = m.to > m.from ? "O-O" : "O-O-O";
  else {
    const capture = p.board[m.to] !== "" || (type === "p" && m.to === p.ep);
    if (type === "p") san = (capture ? FILES[fileOf(m.from)] + "x" : "") + squareName(m.to) + (m.promotion ? "=" + m.promotion.toUpperCase() : "");
    else {
      const rivals = legal.filter((o) => o.to === m.to && o.from !== m.from && p.board[o.from] === pc);
      const dis = !rivals.length ? ""
        : rivals.every((o) => fileOf(o.from) !== fileOf(m.from)) ? FILES[fileOf(m.from)]!
        : rivals.every((o) => rankOf(o.from) !== rankOf(m.from)) ? String(rankOf(m.from) + 1)
        : squareName(m.from);
      san = type.toUpperCase() + dis + (capture ? "x" : "") + squareName(m.to);
    }
  }
  const next = play(p, m);
  return inCheck(next) ? san + (legalMoves(next).length ? "+" : "#") : san;
}

const SAN_RE = /^([NBRQK])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=?([NBRQ]))?$/;

/**
 * The legal move `san` names, or null if it names none or more than one. Accepts what people
 * write beyond strict SAN: check marks and annotations (+ # ! ?) are ignored, 0-0 means O-O, extra
 * disambiguation is allowed, and a piece's capture may leave out the x. A pawn named without a
 * file moves straight ahead, and a promotion must name its piece.
 */
export function parseSan(p: Position, san: string): Move | null {
  const s = san.trim().replace(/[+#!?]+$/, "").replace(/0/g, "O");
  const legal = legalMoves(p);
  const king = p.board.indexOf(piece("k", p.turn));
  const one = (ms: Move[]) => (ms.length === 1 ? ms[0]! : null);
  if (s === "O-O" || s === "O-O-O") return one(legal.filter((m) => m.from === king && m.to - m.from === (s === "O-O" ? 2 : -2)));
  const g = SAN_RE.exec(s);
  if (!g) return null;
  const [, pt, file, rank, x, to, promo] = g;
  const type = (pt ?? "p").toLowerCase();
  const toSq = parseSquare(to!)!;
  return one(legal.filter((m) => {
    if (m.to !== toSq || p.board[m.from] !== piece(type, p.turn)) return false;
    if (type === "k" && Math.abs(m.to - m.from) === 2) return false;
    const capture = p.board[m.to] !== "" || (type === "p" && m.to === p.ep);
    if (x && !capture) return false;
    const fromFile = file ?? (type === "p" ? to![0] : undefined);
    if (fromFile && FILES[fileOf(m.from)] !== fromFile) return false;
    if (rank && String(rankOf(m.from) + 1) !== rank) return false;
    return (m.promotion ?? "") === (promo?.toLowerCase() ?? "");
  }));
}

/** UCI notation, e.g. "e2e4", "e7e8q". */
export const toUci = (m: Move): string => squareName(m.from) + squareName(m.to) + (m.promotion ?? "");

/** Plays SAN moves in order from `p` (default: the start). Throws naming the first move that isn't legal. */
export function playSan(sans: readonly string[], p: Position = startPosition()): { position: Position; moves: Move[] } {
  const moves: Move[] = [];
  for (const [i, s] of sans.entries()) {
    const m = parseSan(p, s);
    if (!m) throw new Error(`move ${i + 1} "${s}" isn't legal in ${toFen(p)}`);
    moves.push(m);
    p = play(p, m);
  }
  return { position: p, moves };
}
