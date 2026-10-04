/** Tile and barrier masks: R=1, U=2, L=4, D=8, the same encoding as Simon Tatham's net and netslide. */
export const R = 1, U = 2, L = 4, D = 8;
export const DIRS = [R, U, L, D] as const;

export const opp = (d: number): number => (d < 4 ? d << 2 : d >> 2);
export const degree = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

export interface Geometry {
  w: number;
  h: number;
  wrap: boolean;
}

/** Cell across side d of cell i; -1 off the edge of a board that doesn't wrap. */
export function neighbour(g: Geometry, i: number, d: number): number {
  let x = i % g.w, y = Math.floor(i / g.w);
  if (d === R) x++;
  else if (d === L) x--;
  else if (d === U) y--;
  else y++;
  if (g.wrap) {
    x = (x + g.w) % g.w;
    y = (y + g.h) % g.h;
  } else if (x < 0 || y < 0 || x >= g.w || y >= g.h) return -1;
  return y * g.w + x;
}

/** The middle cell (rounded down): it never moves, and everything must connect to it. */
export const centre = (g: Pick<Geometry, "w" | "h">): number => Math.floor(g.h / 2) * g.w + Math.floor(g.w / 2);

/** Make barriers symmetric and drop ones that face off the board. */
export function normalizeBarriers(g: Geometry, barriers: readonly number[]): number[] {
  const out = barriers.map(() => 0);
  barriers.forEach((b, i) => {
    for (const d of DIRS) {
      if (!(b & d)) continue;
      const j = neighbour(g, i, d);
      if (j < 0) continue;
      out[i]! |= d;
      out[j]! |= opp(d);
    }
  });
  return out;
}

/** Cells joined to the centre through matching pipe ends that no barrier blocks. */
export function connected(g: Geometry, barriers: readonly number[], tiles: readonly number[]): Uint8Array {
  const on = new Uint8Array(tiles.length);
  const start = centre(g);
  on[start] = 1;
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    for (const d of DIRS) {
      if (!(tiles[i]! & d) || barriers[i]! & d) continue;
      const j = neighbour(g, i, d);
      if (j < 0 || on[j] || !(tiles[j]! & opp(d))) continue;
      on[j] = 1;
      stack.push(j);
    }
  }
  return on;
}
