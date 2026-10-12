import { expect, test } from "bun:test";
import { work } from "../../lib/work";
import { generate } from "../../core/generate";
import { applyStep, findStep, findPracticePosition, firstStep } from "../../core/techniques";
import { goal, gridFormat, isReachable, sgtFormat, sixteen, spec, type SixteenPuzzle } from "./logic";
import { solveAll } from "../../lib/perm";
import { sixteenTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(sixteen, params, seed, sig()) as Promise<SixteenPuzzle>;

test("generation is deterministic and reachable", async () => {
  expect(await gen({ width: 5, height: 3 }, "a")).toEqual(await gen({ width: 5, height: 3 }, "a"));
  expect(await gen({ width: 5, height: 3 }, "a")).not.toEqual(await gen({ width: 5, height: 3 }, "b"));
  for (let i = 0; i < 30; i++) {
    const p = await gen({ width: 2 + (i % 5), height: 2 + ((i * 3) % 5) }, `g${i}`);
    expect(isReachable(p.w, p.h, p.tiles)).toBe(true);
    expect(sixteen.isSolved(p, sixteen.init(p))).toBe(false);
  }
});

test("the placement method solves every size, parity included", async () => {
  for (let w = 2; w <= 6; w++) for (let h = 2; h <= 6; h++) {
    for (const seed of ["a", "b"]) {
      const p = await gen({ width: w, height: h }, `${seed}${w}${h}`);
      const moves = solveAll(spec(w, h), goal(w * h), { values: p.tiles });
      expect(moves).not.toBeNull();
      let s = sixteen.init(p);
      for (const a of moves!) s = sixteen.reduce(p, s, a);
      expect(sixteen.isSolved(p, s)).toBe(true);
    }
  }
});

test("8×8 solves within its work budget", async () => {
  const p = await gen({ width: 8, height: 8 }, "big");
  const before = work.units;
  const moves = solveAll(spec(8, 8), goal(64), { values: p.tiles });
  expect(moves).not.toBeNull();
  expect(work.units - before).toBeLessThan(80_000);
});

test("technique steps apply, and practice positions exist", async () => {
  const p = await gen({ width: 4, height: 4 }, "tech");
  let s = sixteen.init(p);
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const hit = firstStep(sixteen, sixteenTechniques, p, s);
    if (!hit) break;
    s = applyStep(sixteen, p, s, hit.step);
    seen.add(hit.technique.id);
  }
  expect(seen.has("sixteen.slide-home")).toBe(true);
  for (const t of sixteenTechniques.slice(0, 2)) {
    const pos = await findPracticePosition(sixteen, sixteenTechniques, t, "x", sig());
    expect(pos && findStep(sixteen, t, pos.puzzle, pos.state)?.actions.length).toBeGreaterThan(0);
  }
});

test("formats round-trip; unreachable odd-by-odd ids are refused", async () => {
  const p = await gen({ width: 4, height: 3 }, "fmt");
  for (const f of sixteen.formats) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(p);
  }
  expect(sgtFormat.parse("3x3m5:1,2,3,4,5,6,8,9,7").tiles).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 7]);
  expect(() => sgtFormat.parse("3x3:2,1,3,4,5,6,7,8,9")).toThrow();
  expect(gridFormat.parse("2 1\n3 4").tiles).toEqual([2, 1, 3, 4]);
});

test("shifts wrap, and a full-length shift is a no-op", () => {
  const p = gridFormat.parse("1 2 3\n4 5 6\n7 8 9");
  const s = sixteen.init(p);
  expect(sixteen.reduce(p, s, { type: "shift", line: "row", index: 0, by: 1 }).tiles.slice(0, 3)).toEqual([3, 1, 2]);
  expect(sixteen.reduce(p, s, { type: "shift", line: "col", index: 1, by: -1 }).tiles).toEqual([1, 5, 3, 4, 8, 6, 7, 2, 9]);
  expect(sixteen.reduce(p, s, { type: "shift", line: "row", index: 0, by: 3 })).toBe(s);
});
