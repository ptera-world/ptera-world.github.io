/**
 * Finished arrangements. Every one is a value per cell; tiles carry those values, and 0 is the gap
 * (only when the tiles slide into one).
 */
export type Goal = "order" | "gap-first" | "spiral" | "rows" | "quadrants";

export interface Shape {
  w: number;
  h: number;
  goal: Goal;
  /** One cell is a gap. */
  gap: boolean;
}

/** Cells of a w×h board in a clockwise spiral from the top-left corner. */
export function spiral(w: number, h: number): number[] {
  const out: number[] = [];
  let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
  while (x0 <= x1 && y0 <= y1) {
    for (let x = x0; x <= x1; x++) out.push(y0 * w + x);
    for (let y = y0 + 1; y <= y1; y++) out.push(y * w + x1);
    if (y0 < y1) for (let x = x1 - 1; x >= x0; x--) out.push(y1 * w + x);
    if (x0 < x1) for (let y = y1 - 1; y > y0; y--) out.push(y * w + x0);
    x0++; y0++; x1--; y1--;
  }
  return out;
}

const cache = new Map<string, number[]>();

/** The value each cell holds when finished. */
export function goalTiles(s: Shape): number[] {
  const key = `${s.w}x${s.h}${s.goal}${s.gap ? "g" : ""}`;
  let g = cache.get(key);
  if (g) return g;
  const n = s.w * s.h;
  g = Array.from({ length: n }, () => 0);
  switch (s.goal) {
    case "rows":
      for (let c = 0; c < n; c++) g[c] = Math.floor(c / s.w) + 1;
      break;
    case "quadrants":
      for (let c = 0; c < n; c++) g[c] = 1 + (Math.floor(c / s.w) >= s.h / 2 ? 2 : 0) + ((c % s.w) >= s.w / 2 ? 1 : 0);
      break;
    case "spiral":
      spiral(s.w, s.h).forEach((c, i) => { g![c] = s.gap && i === n - 1 ? 0 : i + 1; });
      break;
    case "gap-first":
      for (let c = 0; c < n; c++) g[c] = c;
      break;
    default:
      for (let c = 0; c < n; c++) g[c] = s.gap && c === n - 1 ? 0 : c + 1;
  }
  cache.set(key, g);
  return g;
}

/** Why a goal can't be used on this board, or null if it can. */
export function goalProblem(s: Shape): string | null {
  if (s.goal === "gap-first" && !s.gap) return "only a board with a gap can have the gap first";
  if ((s.goal === "rows" || s.goal === "quadrants") && s.gap) return "sliding into a gap needs every tile numbered differently";
  if (s.goal === "quadrants" && (s.w % 2 || s.h % 2)) return "quarters need an even number of tiles each way";
  return null;
}

/** Every value appears once (so the arrangement's parity means something). */
export const distinct = (goal: Goal): boolean => goal !== "rows" && goal !== "quadrants";

/** How the finished board reads, for the rules. */
export function goalText(s: Shape): string {
  switch (s.goal) {
    case "rows": return "every tile is numbered with the row it belongs in: get each row filled with its own number.";
    case "quadrants": return "every tile is numbered with the quarter of the board it belongs in (1 top left, 2 top right, 3 bottom left, 4 bottom right): get each quarter filled with its own number.";
    case "spiral": return s.gap
      ? "get the tiles in order in a spiral: along the top from the left, down the right side, back along the bottom and round inwards, with the gap where the spiral ends."
      : "get the numbers in order in a spiral: along the top from the left, down the right side, back along the bottom and round inwards.";
    case "gap-first": return "get the gap into the top-left corner and the tiles in order after it, reading left to right and top to bottom.";
    default: return s.gap
      ? "get the tiles in order, reading left to right and top to bottom, with the gap in the bottom-right corner."
      : "get the numbers in order, reading left to right and top to bottom.";
  }
}
