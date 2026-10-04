import { edgeGrid } from "./edges";
import { cellName } from "./grid-kit/names";

/** "A", "A and B", "A, B and C", "A, B, C and 3 more": at most three names spelled out. */
export function listOf<T>(items: readonly T[], name: (item: T) => string): string {
  const names = items.slice(0, 3).map(name);
  const rest = items.length - names.length;
  if (rest > 0) return `${names.join(", ")} and ${rest} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
}

/** "C5-D5": an edge of the w×h edge grid, by the two cells it separates. */
export function edgeName(p: { w: number; h: number }, e: number): string {
  const g = edgeGrid(p.w, p.h);
  return `${cellName(p, g.ea[e]!)}-${cellName(p, g.eb[e]!)}`;
}

/** "C5-D5, D5-D6 and 2 more". */
export const edgeList = (p: { w: number; h: number }, edges: readonly number[]): string => listOf(edges, (e) => edgeName(p, e));
