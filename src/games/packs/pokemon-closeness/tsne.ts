import type { Space } from "./similarity";

/**
 * Refine a starting layout (classical MDS, see mds.ts) with exact t-SNE on the same distances, so
 * pokémon that are alike sit next to each other on the map. Classical MDS alone keeps the overall
 * shape but few neighbourhoods: on every species under the balanced weights, about 1 of each
 * pokémon's 10 nearest stays among its 10 nearest on the map; after this, about 4 or 5 do. That
 * matters more here, since the player navigates by what is near their best guesses.
 *
 * No randomness: the start is the MDS layout, so the same pool and weights give the same map (on
 * one JS engine; engines may differ in the last bits of Math.exp, which can move points slightly).
 * `pause` is awaited between iterations so a page can stay responsive.
 */
export async function tsne(space: Space, start: Float64Array, opts: { perplexity?: number; iterations?: number; pause?: () => Promise<void> } = {}): Promise<Float64Array> {
  const n = space.n;
  if (n < 4) return Float64Array.from(start);
  const perp = Math.min(opts.perplexity ?? 20, (n - 1) / 3);
  const iters = opts.iterations ?? 400;
  const P = new Float64Array(n * n);
  const D2 = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) D2[i * n + j] = D2[j * n + i] = space.dist(i, j) ** 2;
  // conditional probabilities with each point's bandwidth set to the perplexity by bisection
  const target = Math.log(perp);
  for (let i = 0; i < n; i++) {
    let lo = 0, hi = Infinity, beta = 1;
    for (let t = 0; t < 64; t++) {
      let sum = 0, sd = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const d2 = D2[i * n + j]!;
        const p = Math.exp(-beta * d2);
        P[i * n + j] = p;
        sum += p;
        sd += beta * d2 * p;
      }
      const H = Math.log(sum || Number.MIN_VALUE) + sd / (sum || Number.MIN_VALUE);
      if (Math.abs(H - target) < 1e-5) break;
      if (H > target) { lo = beta; beta = hi === Infinity ? beta * 2 : (beta + hi) / 2; } else { hi = beta; beta = (beta + lo) / 2; }
    }
    let sum = 0;
    for (let j = 0; j < n; j++) sum += P[i * n + j]!;
    for (let j = 0; j < n; j++) P[i * n + j]! /= sum || 1;
    if (i % 64 === 63) await opts.pause?.();
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const v = Math.max((P[i * n + j]! + P[j * n + i]!) / (2 * n), 1e-12);
    P[i * n + j] = P[j * n + i] = v;
  }
  const Y = Float64Array.from(start, (v) => (v - 0.5) * 0.1);
  const grad = new Float64Array(2 * n), step = new Float64Array(2 * n), gains = new Float64Array(2 * n).fill(1);
  const Q = new Float64Array(n * n);
  const eta = Math.max(n / 12, 50);
  for (let it = 0; it < iters; it++) {
    const exaggerate = it < 100 ? 12 : 1, momentum = it < 100 ? 0.5 : 0.8;
    let Z = 0;
    for (let i = 0; i < n; i++) {
      const xi = Y[2 * i]!, yi = Y[2 * i + 1]!;
      for (let j = i + 1; j < n; j++) {
        const q = 1 / (1 + (xi - Y[2 * j]!) ** 2 + (yi - Y[2 * j + 1]!) ** 2);
        Q[i * n + j] = Q[j * n + i] = q;
        Z += 2 * q;
      }
    }
    for (let i = 0; i < n; i++) {
      let gx = 0, gy = 0;
      const xi = Y[2 * i]!, yi = Y[2 * i + 1]!;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const q = Q[i * n + j]!;
        const m = (exaggerate * P[i * n + j]! - q / Z) * q;
        gx += m * (xi - Y[2 * j]!);
        gy += m * (yi - Y[2 * j + 1]!);
      }
      grad[2 * i] = 4 * gx;
      grad[2 * i + 1] = 4 * gy;
    }
    for (let k = 0; k < 2 * n; k++) {
      gains[k] = Math.sign(grad[k]!) !== Math.sign(step[k]!) ? gains[k]! + 0.2 : Math.max(0.01, gains[k]! * 0.8);
      step[k] = momentum * step[k]! - eta * gains[k]! * grad[k]!;
      Y[k]! += step[k]!;
    }
    if (it % 4 === 3) await opts.pause?.();
  }
  return normalize(Y);
}

/** Scale points into [0, 1] keeping the aspect, centred. */
export function normalize(xy: Float64Array): Float64Array {
  const n = xy.length / 2;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xy[2 * i]!); maxX = Math.max(maxX, xy[2 * i]!);
    minY = Math.min(minY, xy[2 * i + 1]!); maxY = Math.max(maxY, xy[2 * i + 1]!);
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const offX = (1 - (maxX - minX) / span) / 2, offY = (1 - (maxY - minY) / span) / 2;
  const out = new Float64Array(xy.length);
  for (let i = 0; i < n; i++) {
    out[2 * i] = offX + (xy[2 * i]! - minX) / span;
    out[2 * i + 1] = offY + (xy[2 * i + 1]! - minY) / span;
  }
  return out;
}
