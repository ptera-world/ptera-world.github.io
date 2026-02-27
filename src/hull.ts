/**
 * hull.ts - Convex hull and hull-based separation utilities for layout tools.
 *
 * All functions are pure and side-effect free. Used by both gen-graph.ts (build-time
 * placement scoring) and inspect-layout.ts (collision reporting).
 */

export type Point = { x: number; y: number };

// ---------------------------------------------------------------------------
// Convex hull (Andrew's monotone chain, O(n log n), returns CCW order)
// ---------------------------------------------------------------------------

export function convexHull(pts: readonly Point[]): Point[] {
  if (pts.length <= 2) return [...pts];
  const s = [...pts].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Point[] = [], hi: Point[] = [];
  for (const p of s) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, p) <= 0) lo.pop();
    lo.push(p);
  }
  for (const p of [...s].reverse()) {
    while (hi.length >= 2 && cross(hi[hi.length - 2]!, hi[hi.length - 1]!, p) <= 0) hi.pop();
    hi.push(p);
  }
  lo.pop(); hi.pop();
  return [...lo, ...hi];
}

// ---------------------------------------------------------------------------
// Outlier filtering
// ---------------------------------------------------------------------------

/**
 * Remove points whose distance from the centroid exceeds `mean + k * stddev`.
 * k=1.5 is the default (fairly aggressive). k=2.0 is more lenient.
 * Preserves all points if fewer than 4.
 */
export function filterOutliers(pts: readonly Point[], k = 1.5): Point[] {
  if (pts.length <= 3) return [...pts];
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const dists = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const mean = dists.reduce((s, d) => s + d, 0) / dists.length;
  const variance = dists.reduce((s, d) => s + (d - mean) ** 2, 0) / dists.length;
  const std = Math.sqrt(variance);
  return pts.filter((_, i) => dists[i]! <= mean + k * std);
}

// ---------------------------------------------------------------------------
// Hull expansion (approximate Minkowski sum with a disk)
// ---------------------------------------------------------------------------

/**
 * Expand a convex hull outward by `r` units by pushing each vertex away from
 * the hull centroid. This is an approximation of the Minkowski sum with a
 * disk — exact at the vertices, slightly conservative at edge midpoints.
 */
export function expandHull(hull: Point[], r: number): Point[] {
  if (hull.length === 0) return hull;
  if (hull.length === 1) return [{ x: hull[0]!.x + r, y: hull[0]!.y }]; // degenerate
  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
  return hull.map((p) => {
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < 1e-9) return { x: p.x + r, y: p.y };
    return { x: cx + (p.x - cx) * (d + r) / d, y: cy + (p.y - cy) * (d + r) / d };
  });
}

// ---------------------------------------------------------------------------
// Hull separation (Separating Axis Theorem, O(n + m))
// ---------------------------------------------------------------------------

/**
 * Signed separation between two convex hulls using the Separating Axis Theorem.
 *
 *   > 0  →  hulls don't overlap; value is the gap along the best separating axis
 *   ≤ 0  →  hulls overlap; |value| is the minimum overlap depth
 *
 * Hulls must be in CCW order (as returned by convexHull).
 * Accounts for edges of both hulls as candidate separating axes.
 *
 * Note: the returned gap is the exact separation only when the closest feature is
 * a pair of parallel edges. For vertex–vertex closest features it slightly under-
 * estimates the Euclidean gap, which is conservative (safe for collision detection).
 */
export function hullSeparation(h1: Point[], h2: Point[]): number {
  if (h1.length === 0 || h2.length === 0) return Infinity;
  let maxGap = -Infinity;
  const checkAxes = (hull: Point[]) => {
    const n = hull.length;
    for (let i = 0; i < n; i++) {
      const a = hull[i]!, b = hull[(i + 1) % n]!;
      // Outward normal for a CCW hull edge (a→b)
      const nx = b.y - a.y, ny = -(b.x - a.x);
      const len = Math.hypot(nx, ny);
      if (len < 1e-10) continue;
      const ux = nx / len, uy = ny / len;
      let min1 = Infinity, max1 = -Infinity;
      for (const p of h1) { const v = p.x * ux + p.y * uy; if (v < min1) min1 = v; if (v > max1) max1 = v; }
      let min2 = Infinity, max2 = -Infinity;
      for (const p of h2) { const v = p.x * ux + p.y * uy; if (v < min2) min2 = v; if (v > max2) max2 = v; }
      // Signed gap between the two projected intervals
      const gap = Math.max(min1 - max2, min2 - max1);
      if (gap > maxGap) maxGap = gap;
    }
  };
  checkAxes(h1);
  checkAxes(h2);
  return maxGap;
}

// ---------------------------------------------------------------------------
// Point-vs-hull separation
// ---------------------------------------------------------------------------

/**
 * Signed separation from a point to a convex hull.
 *   > 0  →  point is outside the hull (distance to nearest edge)
 *   ≤ 0  →  point is inside or on the hull (negative depth)
 */
export function pointToHullSep(p: Point, hull: Point[]): number {
  if (hull.length === 0) return Infinity;
  if (hull.length === 1) return Math.hypot(p.x - hull[0]!.x, p.y - hull[0]!.y);
  // For a single point vs hull, wrap the point in a degenerate hull
  return hullSeparation([p], hull);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Centroid of a point set. */
export function centroid(pts: readonly Point[]): Point {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

/** Bounding circle (centroid + max radius to any point). */
export function boundingCircle(pts: readonly Point[]): { cx: number; cy: number; r: number } {
  const c = centroid(pts);
  const r = Math.max(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
  return { cx: c.x, cy: c.y, r };
}
