import { SOLIDS } from "./geometry";
import { arena, type CubePuzzle, type CubeState } from "./logic";

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V3): V3 => scale(a, 1 / Math.hypot(...a));

/** Frame (three orthonormal axes) from three points: along p→q, then toward r. */
function frame(p: V3, q: V3, r: V3): [V3, V3, V3] {
  const e1 = norm(sub(q, p));
  const t = sub(r, p);
  const e2 = norm(sub(t, scale(e1, dot(t, e1))));
  return [e1, e2, cross(e1, e2)];
}

/**
 * Where every vertex of the solid is in the world (x, y on the arena, z up), with the face
 * down resting on the current square. The rigid motion is fixed by the bottom face's corners.
 */
export function pose(p: CubePuzzle, s: Pick<CubeState, "square" | "key">): V3[] {
  const solid = SOLIDS[p.solid];
  const sq = arena(p).squares[s.square]!;
  const m = s.key.slice(0, 3).map((v) => solid.vertices[v]!) as V3[];
  const w = sq.points.slice(0, 3).map(([x, y]) => [x, y, 0] as V3);
  const [e1, e2, e3] = frame(m[0]!, m[1]!, m[2]!);
  const [g1, g2, g3] = frame(w[0]!, w[1]!, w[2]!);
  return solid.vertices.map((v) => {
    const d = sub(v as V3, m[0]!);
    const a = dot(d, e1), b = dot(d, e2), c = dot(d, e3);
    return [w[0]![0] + a * g1[0] + b * g2[0] + c * g3[0], w[0]![1] + a * g1[1] + b * g2[1] + c * g3[1], a * g1[2] + b * g2[2] + c * g3[2]];
  });
}
