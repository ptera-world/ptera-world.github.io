import { cellName } from "../../ui/board";
import type { Grid } from "./grid";

/**
 * How hint text refers to cells, dots and edges. On tilings with rows and columns things are
 * named by cell ("the 3 in C5", "the top edge of C5"), matching the board labels; elsewhere the
 * text says "this" and relies on the hint highlighting the same thing.
 */

export function faceName(g: Grid, f: number): string | null {
  const c = f >= 0 ? g.cells?.[f] : undefined;
  return c ? cellName(c[0], c[1]) : null;
}

/** "the 3 in C5", or "this 3". */
export function clueRef(g: Grid, clue: number, f: number): string {
  const n = faceName(g, f);
  return n ? `the ${clue} in ${n}` : `this ${clue}`;
}

/** "C5", or "this cell". */
export function cellRef(g: Grid, f: number): string {
  return faceName(g, f) ?? "this cell";
}

const EPS = 1e-6;

/** Which side of face f edge e is, when the face is an axis-aligned square cell. */
function side(g: Grid, f: number, e: number): string | null {
  const a = g.ev[2 * e]!, b = g.ev[2 * e + 1]!;
  const mx = (g.vx[a]! + g.vx[b]!) / 2, my = (g.vy[a]! + g.vy[b]!) / 2;
  if (Math.abs(g.vy[a]! - g.vy[b]!) < EPS) return my < g.fcy[f]! ? "top" : "bottom";
  if (Math.abs(g.vx[a]! - g.vx[b]!) < EPS) return mx < g.fcx[f]! ? "left" : "right";
  return null;
}

/** "the top edge of C5", or "this edge". Prefers the cell the edge is a top or left side of. */
export function edgeRef(g: Grid, e: number): string {
  let best: string | null = null;
  for (const f of [g.ef[2 * e + 1]!, g.ef[2 * e]!]) {
    const n = faceName(g, f);
    const s = n ? side(g, f, e) : null;
    if (!n || !s) continue;
    const text = `the ${s} edge of ${n}`;
    if (s === "top" || s === "left") return text;
    best ??= text;
  }
  return best ?? "this edge";
}

/** "the top-left corner of C5", or "this dot". Prefers the cell the dot is the top-left corner of. */
export function dotRef(g: Grid, v: number): string {
  let best: string | null = null;
  for (const f of g.vf[v]!) {
    const n = faceName(g, f);
    if (!n) continue;
    const dy = g.vy[v]! < g.fcy[f]! ? "top" : "bottom", dx = g.vx[v]! < g.fcx[f]! ? "left" : "right";
    const text = `the ${dy}-${dx} corner of ${n}`;
    if (dy === "top" && dx === "left") return text;
    best ??= text;
  }
  return best ?? "this dot";
}

/** Edge references for a list: one named edge, or "these edges". */
export function edgesRef(g: Grid, es: readonly number[]): string {
  return es.length === 1 ? edgeRef(g, es[0]!) : "these edges";
}
