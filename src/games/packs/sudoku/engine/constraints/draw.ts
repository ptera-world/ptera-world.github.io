import type { RenderCtx } from "../types";

/** SVG path for an outline of `cells` drawn `inset` units inside its boundary. */
export function insetOutline(n: number, S: number, cells: readonly number[], inset: number): string {
  const set = new Set(cells);
  const has = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && set.has(r * n + c);
  const i = inset;
  const segs: string[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number) => segs.push(`M${x1} ${y1}L${x2} ${y2}`);
  for (const cell of cells) {
    const r = Math.floor(cell / n), c = cell % n;
    const x0 = c * S, x1 = (c + 1) * S, y0 = r * S, y1 = (r + 1) * S;
    const L = has(r, c - 1), R = has(r, c + 1), U = has(r - 1, c), D = has(r + 1, c);
    if (!U) seg(L ? (has(r - 1, c - 1) ? x0 - i : x0) : x0 + i, y0 + i, R ? (has(r - 1, c + 1) ? x1 + i : x1) : x1 - i, y0 + i);
    if (!D) seg(L ? (has(r + 1, c - 1) ? x0 - i : x0) : x0 + i, y1 - i, R ? (has(r + 1, c + 1) ? x1 + i : x1) : x1 - i, y1 - i);
    if (!L) seg(x0 + i, U ? (has(r - 1, c - 1) ? y0 - i : y0) : y0 + i, x0 + i, D ? (has(r + 1, c - 1) ? y1 + i : y1) : y1 - i);
    if (!R) seg(x1 - i, U ? (has(r - 1, c + 1) ? y0 - i : y0) : y0 + i, x1 - i, D ? (has(r + 1, c + 1) ? y1 + i : y1) : y1 - i);
  }
  return segs.join("");
}

/** Top-left-most cell (smallest row, then column), where cage labels go. */
export const anchorCell = (cells: readonly number[]): number => Math.min(...cells);

export function cornerLabel(ctx: RenderCtx, cell: number, text: string, cls: string, scale = 1): void {
  const { S, n } = ctx;
  const x = (cell % n) * S + S * 0.05, y = Math.floor(cell / n) * S + S * 0.05;
  const w = (Math.max(1, text.length) * S * 0.12 + S * 0.04) * scale;
  ctx.layer.over.append(
    ctx.svg("rect", { x, y, width: w, height: S * 0.24 * scale, class: "sdk-label-bg" }),
    ctx.svg("text", { x: x + S * 0.02, y: y + S * 0.2 * scale, class: `sdk-label ${cls}`, style: scale === 1 ? null : `font-size:${S * 0.19 * scale}px` }, text));
  ctx.reserveCorner(cell);
}

export function polyline(ctx: RenderCtx, cells: readonly number[]): string {
  return cells.map((c, i) => {
    const [x, y] = ctx.center(c);
    return `${i ? "L" : "M"}${x} ${y}`;
  }).join("");
}

/** Midpoint between two cells' centers. */
export function midpoint(ctx: RenderCtx, a: number, b: number): [number, number] {
  const [ax, ay] = ctx.center(a), [bx, by] = ctx.center(b);
  return [(ax + bx) / 2, (ay + by) / 2];
}
