import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { applyStep, findPracticePosition, findStep, firstStep, isPartOfStep, stepsOf } from "../../core/techniques";
import { canSlide, game2048, gridFormat, slide, spawn, type Puzzle2048 } from "./logic";
import { buildSnake, claimCorner, farSide, fullEdge, growCorner, keepCorner, longestSnake, makeRoom, onlyMove, reachGoal, techniques2048, towardCorner } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(game2048, params, seed, sig()) as Promise<Puzzle2048>;
const e = (v: number) => (v ? Math.log2(v) : 0);

test("generation is deterministic and starts with two tiles", async () => {
  const a = await gen({}, "abc");
  expect(await gen({}, "abc")).toEqual(a);
  expect(await gen({}, "abd")).not.toEqual(a);
  expect(a.start.filter(Boolean).length).toBe(2);
});

test("slides merge each tile once, front first", () => {
  const r = slide(4, [2, 2, 2, 2, 2, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0].map(e), 3);
  expect(r.grid.slice(0, 8).map((v) => (v ? 2 ** v : 0))).toEqual([4, 4, 0, 0, 4, 4, 0, 0]);
  expect(r.gained).toBe(12);
  expect(slide(4, [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].map(e), 3).changed).toBe(false);
  expect(canSlide(2, [1, 2, 2, 1], 0)).toBe(false);
  expect(canSlide(2, [1, 2, 2, 1], 3)).toBe(false);
});

test("the same moves always bring the same tiles; replays are exact", async () => {
  const p = await gen({}, "replay");
  const play = () => {
    let s = game2048.init(p);
    for (let i = 0; i < 40; i++) s = game2048.reduce(p, s, { type: "slide", dir: i % 4 });
    return s;
  };
  expect(play()).toEqual(play());
  expect(spawn([0, 0, 0, 0], 7)).toEqual(spawn([0, 0, 0, 0], 7));
});

test("technique steps apply, and the game ends when nothing moves", async () => {
  const p = await gen({ size: 4, target: "256" }, "play");
  let s = game2048.init(p);
  for (let i = 0; i < 2000 && !game2048.isSolved(p, s); i++) {
    const st = firstStep(game2048, techniques2048, p, s);
    if (!st) break;
    s = applyStep(game2048, p, s, st.step);
  }
  const full = gridFormat.parse("2 4 2\n4 2 4\n2 4 2");
  expect(game2048.isLost!(full, game2048.init(full))).toBe(true);
});

test("techniques: only move, making the goal tile", () => {
  const one = gridFormat.parse("2 .\n4 .\ngoal 64");
  expect(findStep(game2048, onlyMove, one, game2048.init(one))?.actions as unknown).toEqual([{ type: "slide", dir: 1 }]);
  const goal = gridFormat.parse("32 32 .\n. . .\n. . .\ngoal 64");
  const st = findStep(game2048, reachGoal, goal, game2048.init(goal))!;
  expect([1, 3]).toContain((st.actions[0] as unknown as { dir: number }).dir);
});

test("the grid format round-trips with its goal and seed", async () => {
  const p = await gen({ size: 5, target: "4096" }, "fmt");
  expect(gridFormat.parse(gridFormat.serialize!(p))).toEqual(p);
  expect(gridFormat.parse("2 .\n. 4").seed).toBe(gridFormat.parse("2 .\n. 4").seed);
  expect(() => gridFormat.parse("3 .\n. 4")).toThrow();
  expect(() => gridFormat.parse("2 . .\n. 4")).toThrow();
});

const board = (rows: string) => gridFormat.parse(rows);
const dirsOf = (t: Parameters<typeof stepsOf>[1], p: Puzzle2048) => stepsOf(game2048, t, p, game2048.init(p)).map((s) => (s.actions[0] as unknown as { dir: number }).dir).sort();

test("strategies fire on the boards they describe", () => {
  const cases: [typeof growCorner, string, number[]][] = [
    [growCorner, ". . . .\n. . . .\n. . . .\n16 16 . .", [1, 3]],
    [claimCorner, ". . . .\n. . . .\n. . . .\n. 8 . 2", [3]],
    [keepCorner, "64 32 16 8\n4 . . .\n. . . .\n. . . .", [1]],
    [buildSnake, "64 32 . .\n. . 16 .\n. . . .\n. . . .", [0]],
    [farSide, "64 32 . .\n. . . .\n. . . .\n4 4 . .", [3]],
    [fullEdge, "64 32 16 8\n. . . .\n. . 4 .\n. . . .", [0, 3]],
    [makeRoom, "64 . . .\n. . . .\n4 4 . .\n2 2 . .", [3]],
    [towardCorner, "64 . . .\n. . . .\n. . . .\n. . . 2", [0, 3]],
  ];
  for (const [t, rows, want] of cases) {
    const p = board(rows);
    const got = dirsOf(t, p);
    expect(got.length).toBeGreaterThan(0);
    expect({ id: t.id, got: want.filter((d) => got.includes(d)) }).toEqual({ id: t.id, got: want });
  }
});

test("strategies stay quiet where they don't apply", () => {
  const stuck = board("64 32 16 8\n4 . . .\n. . . .\n. . . .");
  expect(dirsOf(keepCorner, board(". . . .\n. . . .\n. . . .\n. 8 . 2"))).toEqual([]);
  expect(dirsOf(towardCorner, stuck)).toEqual([]);
  expect(dirsOf(claimCorner, stuck)).toEqual([]);
  expect(longestSnake(4, stuck.start)).toEqual([0, 1, 2, 3]);
  const pulled = board("64 . . .\n. . . .\n. . . .\n. . . 2");
  expect(dirsOf(keepCorner, pulled)).toEqual([]);
});

test("a hand move a strategy accounts for is part of one of its steps", () => {
  const p = board("64 32 . .\n. . 16 .\n. . . .\n. . . .");
  const s = game2048.init(p);
  const up = game2048.reduce(p, s, { type: "slide", dir: 0 });
  expect(isPartOfStep(game2048, p, s, up, stepsOf(game2048, buildSnake, p, s))).toBe(true);
  const left = game2048.reduce(p, s, { type: "slide", dir: 3 });
  expect(isPartOfStep(game2048, p, s, left, stepsOf(game2048, buildSnake, p, s))).toBe(false);
});

test("strategies read the board, not the seed", () => {
  const p = board("64 32 . .\n. . 16 .\n. . . .\n4 4 . .");
  const q = { ...p, seed: p.seed + 1 };
  for (const t of techniques2048) {
    const a = stepsOf(game2048, t, p, game2048.init(p)).map((s) => [s.message, s.actions]);
    const b = stepsOf(game2048, t, q, game2048.init(q)).map((s) => [s.message, s.actions]);
    expect(b).toEqual(a);
  }
});

test("every technique has a board to watch and practice on", async () => {
  const all = techniques2048.slice().sort((a, b) => a.level - b.level);
  expect(new Set(all.map((t) => t.level)).size).toBe(all.length);
  for (const t of all) {
    expect(t.practice).not.toBe(false);
    const pos = await findPracticePosition(game2048, all, t, "watch", sig(), 24);
    expect(pos).not.toBeNull();
    expect(findStep(game2048, t, pos!.puzzle, pos!.state)).not.toBeNull();
  }
});

test("every technique on auto plays to the end of the game without stalling, and well beyond random play", async () => {
  const all = techniques2048.slice().sort((a, b) => a.level - b.level);
  let total = 0;
  const runs = 20;
  for (let i = 0; i < runs; i++) {
    const p = await gen({ size: 4, target: "8192" }, `auto${i}`);
    let s = game2048.init(p);
    for (let m = 0; m < 20000; m++) {
      const hit = firstStep(game2048, all, p, s);
      if (!hit) break;
      s = applyStep(game2048, p, s, hit.step);
    }
    expect(game2048.isLost!(p, s)).toBe(true);
    total += 2 ** Math.max(...s.grid);
  }
  expect(total / runs).toBeGreaterThan(192);
}, 60000);
