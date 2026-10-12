import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { applyStep, findStep, firstStep } from "../../core/techniques";
import { canSlide, game2048, gridFormat, slide, spawn, type Puzzle2048 } from "./logic";
import { onlyMove, reachGoal, techniques2048 } from "./techniques";

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
