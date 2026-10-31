import type { Space } from "./similarity";
import { normalize } from "./tsne";

/**
 * A 2D map of a pool by classical MDS on the same distances the ranks use: double-centre the
 * squared distances and keep the top two eigenvectors (subspace iteration from a fixed start, so
 * the same pool and weights always give the same map). Coordinates are scaled into [0, 1] keeping
 * the aspect, centred.
 *
 * The map is a projection of a ~25-dimensional likeness onto a plane, so map distance only roughly
 * agrees with rank; the ranks are the truth, the map is for finding your way. This is the start
 * tsne.ts refines, which pulls neighbourhoods together.
 */
export function embed(space: Space): Float64Array {
  const n = space.n;
  if (n < 3) return Float64Array.from({ length: 2 * n }, (_, k) => (k % 2 || n === 1 ? 0.5 : k / 2));
  // B = -1/2 J D² J, kept as a dense symmetric matrix
  const B = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = space.dist(i, j);
      B[i * n + j] = B[j * n + i] = d * d;
    }
  }
  const rowMean = new Float64Array(n);
  let all = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += B[i * n + j]!;
    rowMean[i] = s / n;
    all += s;
  }
  all /= n * n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) B[i * n + j] = -0.5 * (B[i * n + j]! - rowMean[i]! - rowMean[j]! + all);

  // subspace iteration with three vectors (the third speeds up the top two's convergence)
  const k = 3;
  let V: Float64Array[] = Array.from({ length: k }, (_, c) => Float64Array.from({ length: n }, (_, i) => Math.sin((i + 1) * (c + 1) * 0.7) + (c === 0 ? 1 : 0)));
  orthonormalize(V);
  for (let it = 0; it < 120; it++) {
    const W = V.map((v) => mul(B, v, n));
    orthonormalize(W);
    const moved = W.reduce((m, w, c) => Math.max(m, 1 - Math.abs(dot(w, V[c]!))), 0);
    V = W;
    if (moved < 1e-10) break;
  }
  // Rayleigh–Ritz on the subspace, so the axes are the leading eigenvectors in order
  const BV = V.map((v) => mul(B, v, n));
  const H = V.map((v) => BV.map((w) => dot(v, w)));
  const { values, vectors } = jacobi(H);
  const order = [0, 1, 2].sort((a, b) => values[b]! - values[a]!);
  const axes = order.slice(0, 2).map((e) => {
    const lam = Math.max(0, values[e]!);
    const v = new Float64Array(n);
    for (let c = 0; c < k; c++) for (let i = 0; i < n; i++) v[i]! += vectors[c]![e]! * V[c]![i]!;
    // a fixed sign: the heavier tail points right / down
    let skew = 0;
    for (let i = 0; i < n; i++) skew += v[i]! ** 3;
    const sgn = skew < 0 ? -1 : 1;
    return v.map((x) => x * sgn * Math.sqrt(lam));
  });
  const xy = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) { xy[2 * i] = axes[0]![i]!; xy[2 * i + 1] = axes[1]![i]!; }
  return normalize(xy);
}

function mul(B: Float64Array, v: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const row = i * n;
    for (let j = 0; j < n; j++) s += B[row + j]! * v[j]!;
    out[i] = s;
  }
  return out;
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function orthonormalize(V: Float64Array[]): void {
  for (let c = 0; c < V.length; c++) {
    const v = V[c]!;
    for (let p = 0; p < c; p++) {
      const d = dot(v, V[p]!);
      for (let i = 0; i < v.length; i++) v[i]! -= d * V[p]![i]!;
    }
    const len = Math.sqrt(dot(v, v)) || 1;
    for (let i = 0; i < v.length; i++) v[i]! /= len;
  }
}

/** Eigen-decomposition of a small symmetric matrix (cyclic Jacobi): vectors[row][eigen]. */
function jacobi(M: number[][]): { values: number[]; vectors: number[][] } {
  const n = M.length;
  const A = M.map((r) => r.slice());
  const Vt: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p]![q]! ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (A[p]![q]! === 0) continue;
        const theta = (A[q]![q]! - A[p]![p]!) / (2 * A[p]![q]!);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let r = 0; r < n; r++) {
          const arp = A[r]![p]!, arq = A[r]![q]!;
          A[r]![p] = c * arp - s * arq;
          A[r]![q] = s * arp + c * arq;
        }
        for (let r = 0; r < n; r++) {
          const apr = A[p]![r]!, aqr = A[q]![r]!;
          A[p]![r] = c * apr - s * aqr;
          A[q]![r] = s * apr + c * aqr;
        }
        for (let r = 0; r < n; r++) {
          const vrp = Vt[r]![p]!, vrq = Vt[r]![q]!;
          Vt[r]![p] = c * vrp - s * vrq;
          Vt[r]![q] = s * vrp + c * vrq;
        }
      }
    }
  }
  return { values: A.map((r, i) => r[i]!), vectors: Vt };
}
