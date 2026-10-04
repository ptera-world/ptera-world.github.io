/**
 * Tile layouts. A spot is [x, y, z] in half-tile steps (a tile covers x…x+2, y…y+2) on layer z.
 * Every layout has an even number of spots.
 */

export type Spot = readonly [number, number, number];

export interface Layout {
  id: string;
  name: string;
  spots: Spot[];
}

function rect(x0: number, x1: number, y0: number, y1: number, z: number): Spot[] {
  const out: Spot[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x * 2, y * 2, z]);
  return out;
}

function rows(spec: [number, number][], z: number): Spot[] {
  return spec.flatMap(([x0, x1], y) => rect(x0, x1, y, y, z));
}

/** The classic 144-tile turtle. */
const turtle: Spot[] = [
  ...rows([[1, 12], [3, 10], [2, 11], [1, 12], [1, 12], [2, 11], [3, 10], [1, 12]], 0),
  [0, 7, 0], [26, 7, 0], [28, 7, 0],
  ...rect(4, 9, 1, 6, 1),
  ...rect(5, 8, 2, 5, 2),
  ...rect(6, 7, 3, 4, 3),
  [13, 7, 4],
];

/** 72 tiles, stepped. */
const pyramid: Spot[] = [
  ...rect(0, 7, 0, 4, 0),
  ...rect(1, 6, 1, 3, 1),
  ...rect(2, 5, 1, 3, 2),
  ...rect(3, 4, 2, 2, 3),
];

/** 36 tiles: one layer of 24 with two rows of six laid across the joins. */
const small: Spot[] = [
  ...rect(0, 7, 0, 2, 0),
  ...[1, 3].flatMap((y) => [1, 2, 3, 4, 5, 6].map((x): Spot => [x * 2, y, 1])),
];

export const LAYOUTS: Layout[] = [
  { id: "turtle", name: "turtle (144 tiles)", spots: turtle },
  { id: "pyramid", name: "pyramid (72 tiles)", spots: pyramid },
  { id: "small", name: "small (36 tiles)", spots: small },
];
