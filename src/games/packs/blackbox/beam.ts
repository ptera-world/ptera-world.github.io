/**
 * Laser rules. Entry numbers go clockwise from the top-left: the top edge left to right (0..w-1),
 * the right edge top to bottom, the bottom edge right to left, the left edge bottom to top.
 */

export const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

/** Outcome codes beyond exit numbers: absorbed by a ball, or sent back out where it came in. */
export const hitCode = (w: number, h: number) => 2 * (w + h);
export const reflectCode = (w: number, h: number) => 2 * (w + h) + 1;

/** Ring position (x, y in 0..w+1 × 0..h+1, arena at 1..w × 1..h) and inward direction of entry i. */
export function entryAt(w: number, h: number, i: number): { x: number; y: number; dir: number } {
  if (i < w) return { x: i + 1, y: 0, dir: DOWN };
  i -= w;
  if (i < h) return { x: w + 1, y: i + 1, dir: LEFT };
  i -= h;
  if (i < w) return { x: w - i, y: h + 1, dir: UP };
  i -= w;
  return { x: 0, y: h - i, dir: RIGHT };
}

/** Entry number of a ring position, or -1 inside the arena, in a corner or off the ring. */
export function entryOf(w: number, h: number, x: number, y: number): number {
  if (x > 0 && x <= w && y > 0 && y <= h) return -1;
  if (x < 0 || y < 0 || x > w + 1 || y > h + 1) return -1;
  if ((x === 0 || x === w + 1) && (y === 0 || y === h + 1)) return -1;
  if (y === 0) return x - 1;
  if (x === w + 1) return y - 1 + w;
  if (y === h + 1) return w - x + w + h;
  return h - y + 2 * w + h;
}

/** Ball knowledge per arena cell for partial simulation. */
export const UNKNOWN = 0, BALL = 1, EMPTY = 2;

/**
 * Where a laser fired from entry i ends up: an exit entry number, hitCode or reflectCode; or -1 if
 * it needs a cell whose contents are UNKNOWN (that cell's index then goes in `need[0]`). `cell(x, y)` is
 * in arena coordinates (1-based) and is only asked about cells inside the arena. `path`, if given,
 * collects the arena cells passed.
 */
export function fire(w: number, h: number, i: number, cell: (x: number, y: number) => number, path?: number[], need?: number[]): number {
  let { x, y, dir } = entryAt(w, h, i);
  /** BALL, EMPTY or UNKNOWN at the square ahead, ahead-left (side -1) or ahead-right (side 1). */
  const look = (side: number): number => {
    let nx = x + DX[dir]!, ny = y + DY[dir]!;
    if (side) {
      const d = (dir + side + 4) % 4;
      nx += DX[d]!;
      ny += DY[d]!;
    }
    if (nx < 1 || ny < 1 || nx > w || ny > h) return EMPTY;
    const v = cell(nx, ny);
    if (v === UNKNOWN && need) need[0] = (ny - 1) * w + (nx - 1);
    return v;
  };
  const ahead = look(0);
  if (ahead === UNKNOWN) return -1;
  if (ahead === BALL) return hitCode(w, h);
  const l = look(-1), r = look(1);
  if (l === BALL || r === BALL) return reflectCode(w, h);
  if (l === UNKNOWN || r === UNKNOWN) return -1;
  x += DX[dir]!;
  y += DY[dir]!;
  for (let guard = 0; guard < 4 * (w + 2) * (h + 2); guard++) {
    const out = entryOf(w, h, x, y);
    if (out >= 0) return out === i ? reflectCode(w, h) : out;
    path?.push((y - 1) * w + (x - 1));
    const f = look(0);
    if (f === UNKNOWN) return -1;
    if (f === BALL) return hitCode(w, h);
    const left = look(-1);
    if (left === UNKNOWN) return -1;
    if (left === BALL) { dir = (dir + 1) % 4; continue; }
    const right = look(1);
    if (right === UNKNOWN) return -1;
    if (right === BALL) { dir = (dir + 3) % 4; continue; }
    x += DX[dir]!;
    y += DY[dir]!;
  }
  return reflectCode(w, h);
}

/** Outcome of entry i with balls at the given cells. */
export function fireAt(w: number, h: number, balls: ReadonlySet<number> | readonly boolean[], i: number, path?: number[]): number {
  const has = Array.isArray(balls) ? (c: number) => !!balls[c] : (c: number) => (balls as ReadonlySet<number>).has(c);
  return fire(w, h, i, (x, y) => (has((y - 1) * w + (x - 1)) ? BALL : EMPTY), path);
}
