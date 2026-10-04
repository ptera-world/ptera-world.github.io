import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, PuzzleDef, Rating } from "../../core/types";
import { LAYOUTS, type Spot } from "./layouts";
import { boardOf, clearingOrder, freePairs, isFree, remaining } from "./solver";
import { groupName, matchKey, parseTile, tileCode, tileName, tileSet } from "./tiles";

export const params = defineSchema({
  layout: {
    type: "enum", label: "layout", default: "turtle",
    options: LAYOUTS.map((l) => ({ value: l.id, label: l.name })),
  },
});

export interface MahjongPuzzle {
  layout: string;
  spots: Spot[];
  /** Tile kind at each spot. */
  tiles: number[];
  /** Pairs of spots that clear the board in this order. */
  solution?: [number, number][];
}

export interface MahjongState {
  /** 1 once the tile at that spot has been matched away. */
  gone: number[];
  moves: number;
}

export type MahjongAction = { type: "match"; a: number; b: number };

export interface MahjongInteraction {
  /** Spot picked as the first of a pair, or -1. */
  selected: number;
  cursor: number;
}

/** Hint highlight: tiles to match, and tiles to look at. */
export interface MahjongFocus {
  tiles?: number[];
  look?: number[];
}

async function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<MahjongPuzzle> {
  const layout = LAYOUTS.find((l) => l.id === v.layout) ?? LAYOUTS[0]!;
  const spots = layout.spots;
  let order: [number, number][] | null = null;
  for (let attempt = 0; !order; attempt++) {
    order = clearingOrder(spots, rng);
    if (attempt % 8 === 7) await ctx.yield();
  }
  const kinds = rng.shuffle(Array.from({ length: 34 }, (_, k) => k));
  const set = tileSet(spots.length, kinds);
  const groups = new Map<number, number[]>();
  for (const t of set) {
    const k = matchKey(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  const pairs: [number, number][] = [];
  for (const g of groups.values()) for (let i = 0; i + 1 < g.length; i += 2) pairs.push([g[i]!, g[i + 1]!]);
  rng.shuffle(pairs);
  const tiles = Array.from({ length: spots.length }, () => 0);
  order.forEach(([a, b], i) => {
    const [x, y] = rng.bool() ? pairs[i]! : [pairs[i]![1], pairs[i]![0]];
    tiles[a] = x;
    tiles[b] = y;
  });
  return { layout: layout.id, spots, tiles, solution: order };
}

// --- formats ---

/**
 * Plain deal: the layout name on the first line (turtle, pyramid, small), then one tile code per
 * spot in the layout's own order (3D, 7B, 9C, EW, RD, F1, S4 …).
 */
export const dealFormat: Format<MahjongPuzzle> = {
  id: "deal",
  label: "deal (layout name, then a tile code per spot)",
  detect: (t) => LAYOUTS.some((l) => t.trim().toLowerCase().startsWith(l.id)),
  parse(text) {
    const [head, ...rest] = text.trim().split(/\s+/);
    const layout = LAYOUTS.find((l) => l.id === head?.toLowerCase());
    if (!layout) throw new Error(`unknown layout "${head}" (expected ${LAYOUTS.map((l) => l.id).join(", ")})`);
    const tiles = rest.map(parseTile);
    if (tiles.length !== layout.spots.length) throw new Error(`the ${layout.id} layout has ${layout.spots.length} spots, got ${tiles.length} tiles`);
    const counts = new Map<number, number>();
    for (const t of tiles) counts.set(matchKey(t), (counts.get(matchKey(t)) ?? 0) + 1);
    for (const [k, n] of counts) if (n % 2) throw new Error(`${groupName(k)}: ${n} tiles, which can't all pair up`);
    return { layout: layout.id, spots: layout.spots, tiles };
  },
  serialize: (p) => `${p.layout}\n${p.tiles.map(tileCode).join(" ")}`,
};

// --- rules ---

export function canMatch(p: MahjongPuzzle, s: MahjongState, a: number, b: number): boolean {
  if (a === b || a < 0 || b < 0 || a >= p.tiles.length || b >= p.tiles.length) return false;
  const board = boardOf(p.spots);
  return matchKey(p.tiles[a]!) === matchKey(p.tiles[b]!) && isFree(board, s.gone, a) && isFree(board, s.gone, b);
}

export const tileAt = (p: MahjongPuzzle, i: number): string => tileName(p.tiles[i]!);

/** Difficulty by how often the stored line meets a real choice: a group with three or more free tiles but not all of its tiles free. */
function rate(p: MahjongPuzzle): Rating | null {
  if (!p.solution) return null;
  const b = boardOf(p.spots);
  const gone = p.tiles.map(() => 0);
  let choices = 0;
  for (const [x, y] of p.solution) {
    for (const [, idx] of remaining(p.tiles, gone)) {
      const free = idx.filter((i) => isFree(b, gone, i)).length;
      if (free >= 3 && free < idx.length) choices++;
    }
    gone[x] = 1;
    gone[y] = 1;
  }
  const per = choices / p.solution.length;
  return { label: per < 0.15 ? "easy" : per < 0.3 ? "medium" : "hard", score: Math.round(per * 1000) };
}

export const mahjong: PuzzleDef<MahjongPuzzle, MahjongState, MahjongAction, MahjongInteraction, typeof params> = {
  id: "mahjong",
  name: "mahjong solitaire",
  aliases: ["mahjong", "shanghai", "mahjongg", "taipei", "tile matching"],
  tags: ["tiles", "solitaire", "moves", "matching"],
  description: "clear the stack two matching tiles at a time. only free tiles can be taken: nothing on top, and nothing on its left or nothing on its right.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "small", params: { layout: "small" } },
    { label: "pyramid", params: { layout: "pyramid" } },
    { label: "turtle", params: { layout: "turtle" } },
  ],
  generate,
  formats: [dealFormat],
  init: (p) => ({ gone: p.tiles.map(() => 0), moves: 0 }),
  initInteraction: () => ({ selected: -1, cursor: 0 }),
  reduce(p, s, a) {
    if (a.type !== "match" || !canMatch(p, s, a.a, a.b)) return s;
    const gone = s.gone.slice();
    gone[a.a] = 1;
    gone[a.b] = 1;
    return { gone, moves: s.moves + 1 };
  },
  isSolved: (_p, s) => s.gone.every(Boolean),
  isLost: (p, s) => !s.gone.every(Boolean) && freePairs(boardOf(p.spots), p.tiles, s.gone).length === 0,
  rate,
  rules: () => [
    "take away two matching tiles at a time. any flower matches any flower, and any season any season; every other tile matches only its own kind.",
    "a tile can be taken only when it is free: no tile lies on it, even partly, and its left side or its right side is open.",
    "clear every tile to win. the game is lost when no two free tiles match.",
  ],
  describe: (p) => `${LAYOUTS.find((l) => l.id === p.layout)?.name ?? p.layout}`,
  describeAction: (p, a) => (matchKey(p.tiles[a.a]!) === matchKey(p.tiles[a.b]!) && p.tiles[a.a] === p.tiles[a.b]
    ? `${tileName(p.tiles[a.a]!)} pair`
    : `${tileName(p.tiles[a.a]!)} and ${tileName(p.tiles[a.b]!)}`),
};
