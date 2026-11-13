import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { resolve } from "../../core/schema";
import { applyStep, findStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import { work } from "../../lib/work";
import { gridFormat, sgtFormat } from "./formats";
import { goalTiles, spiral } from "./goal";
import { fifteen, type FifteenPuzzle, type FifteenState } from "./logic";
import { isReachable, shiftSpec, shiftGoal, type ShiftPuzzle } from "./shift";
import { applyMove, isSolvable, type SlidePuzzle } from "./slide";
import { fullPlan } from "./solver";
import { fifteenTechniques } from "./techniques";
import type { TurnPuzzle, TurnState } from "./turn";
import { solveAll } from "../../lib/perm";

const sig = () => new AbortController().signal;
const gen = <P extends FifteenPuzzle = FifteenPuzzle>(params: Record<string, unknown>, seed: string) => generate(fifteen, params, seed, sig()) as Promise<P>;
const play = (p: FifteenPuzzle, moves: readonly unknown[]): FifteenState => moves.reduce<FifteenState>((s, a) => fifteen.reduce(p, s, a as never), fifteen.init(p));

/** The setups the separate fifteen, sixteen and twiddle games offered as presets. */
const OLD_PRESETS: Record<string, Record<string, unknown>[]> = {
  fifteen: [{ width: 3, height: 3 }, { width: 4, height: 4 }, { width: 5, height: 5 }, { width: 4, height: 4, shuffle: 20 }],
  sixteen: [{ width: 3, height: 3 }, { width: 4, height: 4 }, { width: 5, height: 5 }, { width: 4, height: 4, shuffle: 10 }],
  twiddle: [
    { width: 3, height: 3, rowsOnly: true }, { width: 3, height: 3 }, { width: 3, height: 3, orientable: true },
    { width: 4, height: 4 }, { width: 4, height: 4, orientable: true }, { width: 6, height: 6 },
  ],
};
const MOVES: Record<string, string> = { fifteen: "slide", sixteen: "shift", twiddle: "turn" };
/** Old presets that only named a scramble or a size of their own, not a published setup: settings, not presets, here. */
const UNPUBLISHED = new Set(['fifteen {"width":4,"height":4,"shuffle":20}', 'sixteen {"width":4,"height":4,"shuffle":10}', 'twiddle {"width":6,"height":6}']);

/** An old game's setup in the merged game's settings. */
function translate(game: string, old: Record<string, unknown>): Record<string, unknown> {
  const { rowsOnly, ...rest } = old;
  return { moves: MOVES[game], ...rest, ...(game === "twiddle" ? { block: 2 } : {}), ...(rowsOnly ? { goal: "rows" } : {}) };
}

test("every old game's published setups are presets; the others are reachable as settings", () => {
  const presets = (fifteen.presets ?? []).map((pr) => JSON.stringify(resolve(fifteen.params, pr.params)));
  for (const [game, list] of Object.entries(OLD_PRESETS)) {
    for (const old of list) {
      const params = translate(game, old);
      const resolved = resolve(fifteen.params, params) as Record<string, unknown>;
      for (const [k, v] of Object.entries(params)) expect(resolved[k]).toEqual(v);
      if (!UNPUBLISHED.has(`${game} ${JSON.stringify(old)}`)) expect(presets).toContain(JSON.stringify(resolved));
    }
  }
});

test("every preset (and every old setup) generates a board that isn't solved, and its solve reaches the goal", async () => {
  const cases = [
    ...(fifteen.presets ?? []).map((pr) => pr.params as Record<string, unknown>),
    ...Object.entries(OLD_PRESETS).flatMap(([game, list]) => list.map((old) => translate(game, old))),
  ];
  for (const params of cases) {
    for (const seed of ["a", "b"]) {
      const p = await gen(params, seed);
      expect(fifteen.isSolved(p, fifteen.init(p))).toBe(false);
      const answer = fifteen.solve!(p, fifteen.init(p));
      expect(answer && "moves" in answer).toBe(true);
      expect(fifteen.isSolved(p, play(p, (answer as { moves: unknown[] }).moves))).toBe(true);
    }
  }
}, 120_000);

test("presets carry real published names only", () => {
  const known = /^(8-puzzle|15-puzzle|24-puzzle|sixteen \d×\d|loopover \d×\d|twiddle |gripple)/;
  for (const pr of fifteen.presets ?? []) expect(pr.label).toMatch(known);
});

test("generation is deterministic", async () => {
  for (const params of [{ width: 5, height: 4 }, { moves: "shift", width: 5, height: 3 }, { moves: "turn", width: 4, height: 3, orientable: true }]) {
    expect(await gen(params, "a")).toEqual(await gen(params, "a"));
    expect(await gen(params, "a")).not.toEqual(await gen(params, "b"));
  }
});

test("settings that don't fit the moves say why", async () => {
  await expect(gen({ moves: "slide", goal: "rows" }, "x")).rejects.toThrow();
  await expect(gen({ moves: "shift", goal: "gap-first" }, "x")).rejects.toThrow();
  await expect(gen({ moves: "turn", width: 3, height: 3, block: 4 }, "x")).rejects.toThrow();
  await expect(gen({ moves: "turn", width: 3, height: 4, goal: "quadrants" }, "x")).rejects.toThrow();
});

// --- sliding into the gap ---

test("slide: generation is always solvable, for every goal", async () => {
  for (let i = 0; i < 40; i++) {
    const goal = ["order", "gap-first", "spiral"][i % 3];
    const p = await gen<SlidePuzzle>({ width: 2 + (i % 6), height: 2 + ((i * 3) % 6), shuffle: i % 4 ? 0 : 30, goal }, `g${i}`);
    expect(isSolvable(p, p.tiles)).toBe(true);
    expect(fifteen.isSolved(p, fifteen.init(p))).toBe(false);
  }
});

test("slide: solvability matches reachability on 2×3 (breadth-first over every position)", () => {
  const w = 3, h = 2;
  const start = [1, 2, 3, 4, 5, 0];
  const seen = new Set([start.join()]);
  const queue = [start];
  while (queue.length) {
    const t = queue.pop()!;
    for (let c = 0; c < 6; c++) {
      const next = applyMove(w, { tiles: t, moves: 0 }, c).tiles;
      if (!seen.has(next.join())) { seen.add(next.join()); queue.push(next); }
    }
  }
  expect(seen.size).toBe(360);
  const perms = (xs: number[]): number[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
  for (const t of perms([0, 1, 2, 3, 4, 5])) {
    expect(isSolvable({ w, h, goal: "order" }, t)).toBe(seen.has(t.join()));
    expect(isSolvable({ w, h, goal: "spiral" }, t)).toBe(seen.has(t.join()) === seen.has(goalTiles({ w, h, goal: "spiral", gap: true }).join()));
  }
});

test("slide: the hint method solves every size and goal from random positions", async () => {
  const rng = createRng("plan");
  for (let i = 0; i < 30; i++) {
    const p = await gen<SlidePuzzle>({ width: rng.range(2, 7), height: rng.range(2, 7), goal: ["order", "gap-first", "spiral"][i % 3] }, `p${i}`);
    const moves = fullPlan(p, fifteen.init(p))!;
    expect(moves).not.toBeNull();
    let s = fifteen.init(p);
    for (const c of moves) {
      const next = fifteen.reduce(p, s, { type: "move", cell: c });
      expect(next).not.toBe(s);
      s = next;
    }
    expect(fifteen.isSolved(p, s)).toBe(true);
  }
});

test("slide: techniques alone solve, never undoing a finished tile, and rate the board", async () => {
  for (const goal of ["order", "spiral", "gap-first"]) {
    const p = await gen({ width: 4, height: 4, goal }, "tech");
    let s = fifteen.init(p);
    const seen = new Set<string>();
    for (let i = 0; i < 2000 && !fifteen.isSolved(p, s); i++) {
      const hit = firstStep(fifteen, fifteenTechniques, p, s)!;
      expect(hit).not.toBeNull();
      s = applyStep(fifteen, p, s, hit.step);
      seen.add(hit.technique.id);
    }
    expect(fifteen.isSolved(p, s)).toBe(true);
    expect([...seen].sort()).toEqual(["fifteen.last-square", "fifteen.line-end", "fifteen.place"]);
    expect(rateByTechniques(fifteen, fifteenTechniques, p)?.hardest.id).toBe("fifteen.last-square");
    expect(fifteen.rate!(p)?.score).toBeGreaterThan(20);
  }
});

test("slide: moving a line slides every tile between and counts each", () => {
  const p = gridFormat.parse("1 2 3\n4 5 6\n7 8 .");
  const s = fifteen.reduce(p, fifteen.init(p), { type: "move", cell: 6 });
  expect(s.tiles).toEqual([1, 2, 3, 4, 5, 6, 0, 7, 8]);
  expect(s.moves).toBe(2);
  expect(fifteen.reduce(p, s, { type: "move", cell: 4 })).toBe(s);
});

test("goals: spiral runs round the edge and inwards", () => {
  expect(spiral(3, 3)).toEqual([0, 1, 2, 5, 8, 7, 6, 3, 4]);
  expect(goalTiles({ w: 3, h: 3, goal: "spiral", gap: true })).toEqual([1, 2, 3, 8, 0, 4, 7, 6, 5]);
  expect(goalTiles({ w: 3, h: 3, goal: "gap-first", gap: true })).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(goalTiles({ w: 4, h: 2, goal: "quadrants", gap: false })).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
});

// --- shifting rows and columns ---

test("shift: generation is reachable and the placement method solves every size, parity included", async () => {
  for (let w = 2; w <= 6; w++) for (let h = 2; h <= 6; h++) {
    for (const seed of ["a", "b"]) {
      const p = await gen<ShiftPuzzle>({ moves: "shift", width: w, height: h }, `${seed}${w}${h}`);
      expect(isReachable(p, p.tiles)).toBe(true);
      const moves = solveAll(shiftSpec(p), shiftGoal(p), { values: p.tiles });
      expect(moves).not.toBeNull();
      expect(fifteen.isSolved(p, play(p, moves!))).toBe(true);
    }
  }
});

test("shift: 8×8 solves within its work budget", async () => {
  const p = await gen<ShiftPuzzle>({ moves: "shift", width: 8, height: 8 }, "big");
  const before = work.units;
  expect(solveAll(shiftSpec(p), shiftGoal(p), { values: p.tiles })).not.toBeNull();
  expect(work.units - before).toBeLessThan(80_000);
});

test("shift: shifts wrap, and a full-length shift is a no-op", () => {
  const p = gridFormat.parse("1 2 3\n4 5 6\n7 8 9");
  const s = fifteen.init(p);
  expect(fifteen.reduce(p, s, { type: "shift", line: "row", index: 0, by: 1 }).tiles.slice(0, 3)).toEqual([3, 1, 2]);
  expect(fifteen.reduce(p, s, { type: "shift", line: "col", index: 1, by: -1 }).tiles).toEqual([1, 5, 3, 4, 8, 6, 7, 2, 9]);
  expect(fifteen.reduce(p, s, { type: "shift", line: "row", index: 0, by: 3 })).toBe(s);
  expect(fifteen.reduce(p, s, { type: "move", cell: 0 })).toBe(s);
});

// --- turning blocks ---

test("turn: a turn and its reverse cancel; orientation follows the block", () => {
  const p = gridFormat.parse("twiddle block=2 orientable\n1 2 3\n4 5 6\n7 8 9") as TurnPuzzle;
  const s = fifteen.init(p) as TurnState;
  const ccw = fifteen.reduce(p, s, { type: "rotate", x: 0, y: 0, clockwise: false }) as TurnState;
  expect(ccw.tiles).toEqual([2, 5, 3, 1, 4, 6, 7, 8, 9]);
  expect(ccw.turns.slice(0, 2)).toEqual([1, 1]);
  const back = fifteen.reduce(p, ccw, { type: "rotate", x: 0, y: 0, clockwise: true }) as TurnState;
  expect(back.tiles).toEqual(s.tiles);
  expect(back.turns).toEqual(s.turns);
});

test("turn: only the corner and middle blocks turn in gripple", async () => {
  const p = await gen({ moves: "turn", width: 4, height: 4, blocks: "corners" }, "g");
  const s = fifteen.init(p);
  expect(fifteen.reduce(p, s, { type: "rotate", x: 1, y: 0, clockwise: false })).toBe(s);
  for (const [x, y] of [[0, 0], [2, 0], [0, 2], [2, 2], [1, 1]]) expect(fifteen.reduce(p, s, { type: "rotate", x: x!, y: y!, clockwise: false })).not.toBe(s);
});

test("turn: big blocks, upright tiles and other goals solve from generated boards", async () => {
  for (const params of [
    { width: 4, height: 4, block: 3, orientable: true }, { width: 5, height: 5, block: 3, goal: "spiral" },
    { width: 5, height: 3, orientable: true }, { width: 2, height: 5, goal: "rows" }, { width: 7, height: 6 }, { width: 3, height: 3, block: 3 },
    { width: 8, height: 8, block: 3, orientable: true }, { width: 8, height: 8, block: 5 }, { width: 4, height: 4, blocks: "corners", orientable: true },
  ]) {
    const p = await gen({ moves: "turn", ...params }, "big");
    const answer = fifteen.solve!(p, fifteen.init(p)) as { moves: unknown[] } | null;
    expect(answer).not.toBeNull();
    expect(fifteen.isSolved(p, play(p, answer!.moves))).toBe(true);
  }
}, 120_000);

// --- every kind ---

test("technique steps apply for every kind of move, and practice positions exist for every technique", async () => {
  for (const params of [{ moves: "shift", width: 4, height: 4 }, { moves: "turn", width: 4, height: 4 }, { moves: "turn", width: 4, height: 4, block: 3 }]) {
    const p = await gen(params, "tech");
    let s = fifteen.init(p);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const hit = firstStep(fifteen, fifteenTechniques, p, s);
      if (!hit) break;
      s = applyStep(fifteen, p, s, hit.step);
      seen.add(hit.technique.id);
    }
    expect(seen.size).toBeGreaterThan(0);
    expect([...seen].every((id) => id.startsWith(params.moves === "shift" ? "fifteen.shift-" : "fifteen.turn-"))).toBe(true);
  }
  for (const t of fifteenTechniques) {
    const pos = await findPracticePosition(fifteen, fifteenTechniques, t, "x", sig());
    expect(pos && findStep(fifteen, t, pos.puzzle, pos.state)?.actions.length).toBeGreaterThan(0);
  }
}, 120_000);

test("formats round-trip every kind; sgt fifteen, sixteen and twiddle ids parse; bad ids are refused", async () => {
  for (const params of [
    { width: 4, height: 3 }, { width: 3, height: 3, goal: "spiral" }, { moves: "shift", width: 4, height: 3 }, { moves: "shift", width: 4, height: 4, goal: "rows" },
    { moves: "turn", width: 4, height: 3 }, { moves: "turn", width: 3, height: 3, orientable: true }, { moves: "turn", width: 3, height: 3, goal: "rows" },
    { moves: "turn", width: 4, height: 4, blocks: "corners", goal: "quadrants" }, { moves: "turn", width: 5, height: 5, block: 3 },
  ]) {
    const p = await gen(params, "fmt");
    const text = gridFormat.serialize!(p);
    expect(gridFormat.detect!(text)).toBe(true);
    expect(gridFormat.parse(text)).toEqual(p);
    const sgtable = (p.goal === "order" || (p.moves === "turn" && p.goal === "rows")) && (p.moves !== "turn" || p.blocks === "all");
    if (sgtable) expect(sgtFormat.parse(sgtFormat.serialize!(p))).toEqual(p);
    else expect(() => sgtFormat.serialize!(p)).toThrow();
  }
  expect(sgtFormat.parse("2x2:1,2,0,3")).toMatchObject({ moves: "slide", tiles: [1, 2, 0, 3] });
  expect(() => sgtFormat.parse("2x2:2,1,3,0")).toThrow();
  expect(() => sgtFormat.parse("2x2:1,1,3,0")).toThrow();
  expect(sgtFormat.parse("3x3m5:1,2,3,4,5,6,8,9,7")).toMatchObject({ moves: "shift", tiles: [1, 2, 3, 4, 5, 6, 8, 9, 7] });
  expect(() => sgtFormat.parse("3x3:2,1,3,4,5,6,7,8,9")).toThrow();
  const o = sgtFormat.parse("3x3n2o:1u2l3d4r5u6u7u8u9u") as TurnPuzzle;
  expect(o.turns.slice(0, 4)).toEqual([0, 1, 2, 3]);
  expect((sgtFormat.parse("3x3n2rm20:1,1,1,2,2,2,3,3,3") as TurnPuzzle).goal).toBe("rows");
  expect((sgtFormat.parse("4x4n3:1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16") as TurnPuzzle).n).toBe(3);
  expect(gridFormat.parse("2 1\n3 4").tiles).toEqual([2, 1, 3, 4]);
});
