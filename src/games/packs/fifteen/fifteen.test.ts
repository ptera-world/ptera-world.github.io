import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { applyStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import { applyMove, fifteen, gridFormat, isSolvable, sgtFormat, type FifteenPuzzle } from "./logic";
import { fullPlan } from "./solver";
import { fifteenTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(fifteen, params, seed, sig()) as Promise<FifteenPuzzle>;

test("generation is deterministic and always solvable", async () => {
  expect(await gen({ width: 5, height: 4 }, "a")).toEqual(await gen({ width: 5, height: 4 }, "a"));
  expect(await gen({ width: 5, height: 4 }, "a")).not.toEqual(await gen({ width: 5, height: 4 }, "b"));
  for (let i = 0; i < 40; i++) {
    const p = await gen({ width: 2 + (i % 6), height: 2 + ((i * 3) % 6), shuffle: i % 3 ? 0 : 30 }, `g${i}`);
    expect(isSolvable(p.w, p.h, p.tiles)).toBe(true);
    expect(fifteen.isSolved(p, fifteen.init(p))).toBe(false);
  }
});

test("solvability matches reachability on 2×3 (breadth-first over every position)", () => {
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
  for (const t of perms([0, 1, 2, 3, 4, 5])) expect(isSolvable(w, h, t)).toBe(seen.has(t.join()));
});

test("the hint method solves every size from random positions", async () => {
  const rng = createRng("plan");
  for (let i = 0; i < 30; i++) {
    const p = await gen({ width: rng.range(2, 7), height: rng.range(2, 7) }, `p${i}`);
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

test("techniques alone solve, never undoing a finished tile, and rate the board", async () => {
  const p = await gen({ width: 4, height: 4 }, "tech");
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
});

test("practice positions exist for every technique", async () => {
  for (const t of fifteenTechniques) {
    const pos = await findPracticePosition(fifteen, fifteenTechniques, t, "x", sig());
    expect(pos?.step.actions.length).toBeGreaterThan(0);
  }
});

test("moving a line slides every tile between and counts each", () => {
  const p = gridFormat.parse("1 2 3\n4 5 6\n7 8 .");
  const s = fifteen.reduce(p, fifteen.init(p), { type: "move", cell: 6 });
  expect(s.tiles).toEqual([1, 2, 3, 4, 5, 6, 0, 7, 8]);
  expect(s.moves).toBe(2);
  expect(fifteen.reduce(p, s, { type: "move", cell: 4 })).toBe(s);
});

test("formats round-trip; sgt ids parse; unsolvable ids are refused", async () => {
  const p = await gen({ width: 4, height: 3 }, "fmt");
  for (const f of fifteen.formats) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(p);
  }
  expect(sgtFormat.parse("2x2:1,2,0,3").tiles).toEqual([1, 2, 0, 3]);
  expect(() => sgtFormat.parse("2x2:2,1,3,0")).toThrow();
  expect(() => sgtFormat.parse("2x2:1,1,3,0")).toThrow();
});
