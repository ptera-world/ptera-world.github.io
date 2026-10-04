/**
 * Solids and arenas as Simon Tatham's Cube defines them: the same vertex and face tables, and
 * the same square enumeration order, so game ids carry over unchanged.
 */

export type SolidId = "tetrahedron" | "cube" | "octahedron" | "icosahedron";

export interface Solid {
  vertices: [number, number, number][];
  /** Vertex indices per face, in order round the face. */
  faces: number[][];
  /** Sides per face. */
  order: number;
}

const tri = (v: number[]): [number, number, number][] => Array.from({ length: v.length / 3 }, (_, i) => [v[3 * i]!, v[3 * i + 1]!, v[3 * i + 2]!]);
const chunk = (v: number[], k: number): number[][] => Array.from({ length: v.length / k }, (_, i) => v.slice(k * i, k * i + k));

export const SOLIDS: Record<SolidId, Solid> = {
  tetrahedron: {
    vertices: tri([0, -0.57735026919, -0.20412414523, -0.5, 0.28867513459, -0.20412414523, 0, 0, 0.6123724357, 0.5, 0.28867513459, -0.20412414523]),
    faces: chunk([0, 2, 1, 3, 1, 2, 2, 0, 3, 1, 3, 0], 3),
    order: 3,
  },
  cube: {
    vertices: tri([-0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5]),
    faces: chunk([0, 1, 3, 2, 1, 5, 7, 3, 5, 4, 6, 7, 4, 0, 2, 6, 0, 4, 5, 1, 3, 7, 6, 2], 4),
    order: 4,
  },
  octahedron: {
    vertices: tri([
      -0.5, -0.28867513459472505, 0.4082482904638664, 0.5, 0.28867513459472505, -0.4082482904638664,
      -0.5, 0.28867513459472505, -0.4082482904638664, 0.5, -0.28867513459472505, 0.4082482904638664,
      0, -0.57735026918945009, -0.4082482904638664, 0, 0.57735026918945009, 0.4082482904638664,
    ]),
    faces: chunk([4, 0, 2, 0, 5, 2, 0, 4, 3, 5, 0, 3, 1, 4, 2, 5, 1, 2, 4, 1, 3, 1, 5, 3], 3),
    order: 3,
  },
  icosahedron: {
    vertices: tri([
      0, 0.57735026919, 0.75576131408, 0, -0.93417235896, 0.17841104489, 0, 0.93417235896, -0.17841104489,
      0, -0.57735026919, -0.75576131408, -0.5, -0.28867513459, 0.75576131408, -0.5, 0.28867513459, -0.75576131408,
      0.5, -0.28867513459, 0.75576131408, 0.5, 0.28867513459, -0.75576131408, -0.80901699437, 0.46708617948, 0.17841104489,
      0.80901699437, 0.46708617948, 0.17841104489, -0.80901699437, -0.46708617948, -0.17841104489, 0.80901699437, -0.46708617948, -0.17841104489,
    ]),
    faces: chunk([
      8, 0, 2, 0, 9, 2, 1, 10, 3, 11, 1, 3, 0, 4, 6, 4, 1, 6, 5, 2, 7, 3, 5, 7, 4, 8, 10, 8, 5, 10,
      9, 6, 11, 7, 9, 11, 0, 8, 4, 9, 0, 6, 10, 1, 4, 1, 11, 6, 8, 2, 5, 2, 9, 7, 3, 10, 5, 11, 3, 7,
    ], 3),
    order: 3,
  },
};

export interface Square {
  x: number;
  y: number;
  /** Corners, in sgt's order. */
  points: [number, number][];
  /** Down-pointing triangle (the solid sits on it turned half round). */
  flip: boolean;
  /** For the tetrahedron: which face can ever land here. */
  tetraClass: number;
}

const THEIGHT = Math.sqrt(3) / 2;

/** Every arena square in sgt's order (game ids index squares by it). */
export function squares(solid: SolidId, d1: number, d2: number): Square[] {
  const out: Square[] = [];
  if (SOLIDS[solid].order === 4) {
    for (let y = 0; y < d2; y++) for (let x = 0; x < d1; x++) {
      out.push({ x, y, points: [[x - 0.5, y - 0.5], [x - 0.5, y + 0.5], [x + 0.5, y + 0.5], [x + 0.5, y - 0.5]], flip: false, tetraClass: 0 });
    }
    return out;
  }
  let firstix = -1;
  for (let row = 0; row < d1 + d2; row++) {
    const other = row < d2 ? 1 : -1;
    const rowlen = row < d2 ? row + d1 : 2 * d2 + d1 - row;
    const y = THEIGHT * row;
    for (let i = 0; i < rowlen; i++) {
      let ix = 2 * i - (rowlen - 1);
      const x = ix * 0.5;
      if (firstix < 0) firstix = ix & 3;
      ix -= firstix;
      out.push({ x, y: y + THEIGHT / 3, points: [[x - 0.5, y], [x, y + THEIGHT], [x + 0.5, y]], flip: true, tetraClass: ((row + (ix & 1)) & 2) ^ (ix & 3) });
    }
    for (let i = 0; i < rowlen + other; i++) {
      let ix = 2 * i - (rowlen + other - 1);
      const x = ix * 0.5;
      if (firstix < 0) firstix = (ix - 1) & 3;
      ix -= firstix;
      out.push({ x, y: y + (2 * THEIGHT) / 3, points: [[x + 0.5, y + THEIGHT], [x, y], [x - 0.5, y + THEIGHT]], flip: false, tetraClass: ((row + (ix & 1)) & 2) ^ (ix & 3) });
    }
  }
  return out;
}

export const area = (solid: SolidId, d1: number, d2: number): number => (SOLIDS[solid].order === 4 ? d1 * d2 : d1 * d1 + d2 * d2 + 4 * d1 * d2);

/** Squares sharing an edge: for each, the neighbour and which corners of each square coincide. */
export interface Link {
  to: number;
  /** Corner indices in this square of the shared edge. */
  mine: [number, number];
  /** The same two corners, as indices in the neighbour. */
  theirs: [number, number];
}

export function links(sqs: Square[]): Link[][] {
  const near = (a: [number, number], b: [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 < 1e-6;
  return sqs.map((s, i) => {
    const out: Link[] = [];
    sqs.forEach((t, j) => {
      if (i === j) return;
      const pairs: [number, number][] = [];
      s.points.forEach((pa, a) => t.points.forEach((pb, b) => { if (near(pa, pb)) pairs.push([a, b]); }));
      if (pairs.length === 2) out.push({ to: j, mine: [pairs[0]![0], pairs[1]![0]], theirs: [pairs[0]![1], pairs[1]![1]] });
    });
    return out;
  });
}

/** Which solid vertex sits on each corner of `sq` when the solid is set down on it untouched; null if it doesn't fit. */
export function align(solid: Solid, sq: Square): number[] | null {
  const flip = sq.flip ? -1 : 1;
  const zmin = Math.min(0, ...solid.vertices.map((v) => v[2]));
  const key: number[] = [];
  for (const [px, py] of sq.points) {
    const hits = solid.vertices.flatMap((v, i) => ((v[0] * flip - px + sq.x) ** 2 + (v[1] * flip - py + sq.y) ** 2 + (v[2] - zmin) ** 2 < 0.1 ? [i] : []));
    if (hits.length !== 1) return null;
    key.push(hits[0]!);
  }
  return key;
}

/** The face whose vertices are exactly the key's (the one face down). */
export function faceOf(solid: Solid, key: readonly number[]): number {
  return solid.faces.findIndex((f) => f.length === key.length && f.every((v) => key.includes(v)));
}

/**
 * The key after rolling across `link` from a square with `key`: the shared edge keeps its two
 * vertices, and the neighbour's other corners take the rest of the face on the far side of that
 * edge, matched by adjacency round the face.
 */
export function rollKey(solid: Solid, sqs: Square[], key: readonly number[], link: Link): number[] {
  const va = key[link.mine[0]]!, vb = key[link.mine[1]]!;
  const down = faceOf(solid, key);
  const next = solid.faces.findIndex((f, i) => i !== down && f.includes(va) && f.includes(vb));
  const face = solid.faces[next]!;
  const target = sqs[link.to]!;
  const n = target.points.length;
  const out = Array.from({ length: n }, () => -1);
  out[link.theirs[0]] = va;
  out[link.theirs[1]] = vb;
  const fa = face.indexOf(va), fb = face.indexOf(vb);
  const faceDir = (fb - fa + face.length) % face.length === 1 ? 1 : -1;
  const sa = link.theirs[0], sb = link.theirs[1];
  const sqDir = (sb - sa + n) % n === 1 ? 1 : -1;
  for (let k = 2; k < n; k++) {
    const corner = (((sa + sqDir * k) % n) + n) % n;
    out[corner] = face[(((fa + faceDir * k) % face.length) + face.length) % face.length]!;
  }
  return out;
}
