import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { applyStep, findStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import { centre, connected } from "./grid";
import { findArrangement, gridFormat, netslide, sgtFormat, type NetslidePuzzle } from "./logic";
import { netslideTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(netslide, params, seed, sig()) as Promise<NetslidePuzzle>;

test("generation is deterministic; the stored solution is a whole network of the same pieces", async () => {
  expect(await gen({ width: 5, height: 4, wrap: true }, "a")).toEqual(await gen({ width: 5, height: 4, wrap: true }, "a"));
  expect(await gen({ width: 5, height: 4 }, "a")).not.toEqual(await gen({ width: 5, height: 4 }, "b"));
  for (const params of [...netslide.presets!.map((x) => x.params), { width: 7, height: 6, wrap: true, barriers: 30 }]) {
    const p = await gen(params, "x");
    expect(connected(p, p.barriers, p.solution!).every(Boolean)).toBe(true);
    expect(p.solution!.slice().sort().join()).toBe(p.tiles.slice().sort().join());
    expect(p.solution![centre(p)]).toBe(p.tiles[centre(p)]);
    expect(netslide.isSolved(p, netslide.init(p))).toBe(false);
    expect(p.solution!.every((m) => m !== 15)).toBe(true);
  }
});

test("following hints joins up every preset", async () => {
  for (const params of [...netslide.presets!.map((x) => x.params), { width: 7, height: 7, barriers: 0 }]) {
    for (const seed of ["s1", "s2"]) {
      const p = await gen(params, seed);
      let s = netslide.init(p);
      for (let i = 0; i < 500 && !netslide.isSolved(p, s); i++) {
        const hit = firstStep(netslide, netslideTechniques, p, s);
        expect(hit).not.toBeNull();
        s = applyStep(netslide, p, s, hit!.step);
      }
      expect(netslide.isSolved(p, s)).toBe(true);
    }
  }
}, 60000);

test("an imported board without a stored solution still gets one, and hints", async () => {
  const p = await gen({ width: 5, height: 5, barriers: 0 }, "imp");
  const q = sgtFormat.parse(sgtFormat.serialize!(p));
  expect(q.solution).toBeUndefined();
  const arr = findArrangement(q)!;
  expect(connected(q, q.barriers, arr).every(Boolean)).toBe(true);
  expect(firstStep(netslide, netslideTechniques, q, netslide.init(q))).not.toBeNull();
});

test("rating and practice", async () => {
  const p = await gen({ width: 4, height: 4 }, "r");
  expect(netslide.rate!(p)?.score).toBeGreaterThan(0);
  expect(rateByTechniques(netslide, netslideTechniques, p)).not.toBeNull();
  for (const t of netslideTechniques) {
    const pos = await findPracticePosition(netslide, netslideTechniques, t, "x", sig());
    expect(pos && findStep(netslide, t, pos.puzzle, pos.state)?.actions.length).toBeGreaterThan(0);
  }
});

test("the center row and column don't slide", async () => {
  const p = await gen({ width: 3, height: 3 }, "c");
  const s = netslide.init(p);
  expect(netslide.reduce(p, s, { type: "shift", line: "row", index: 1, by: 1 })).toBe(s);
  expect(netslide.reduce(p, s, { type: "shift", line: "col", index: 1, by: 1 })).toBe(s);
  expect(netslide.reduce(p, s, { type: "shift", line: "row", index: 0, by: 1 })).not.toBe(s);
});

test("formats round-trip (without the stored solution); sgt ids with barriers and options parse", async () => {
  const p = await gen({ width: 4, height: 3, wrap: true, barriers: 50 }, "fmt");
  const { solution: _, ...bare } = p;
  for (const f of netslide.formats) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(bare);
  }
  const small = await gen({ width: 3, height: 3 }, "id");
  const body = sgtFormat.serialize!(small).split(":")[1]!;
  const q = sgtFormat.parse(`3x3b1m2:${body}`);
  expect(q.wrap).toBe(false);
  expect(q.tiles).toEqual(small.tiles);
  expect(q.barriers).toEqual(small.barriers);
  expect(() => sgtFormat.parse("3x3:111111111")).toThrow();
  expect(gridFormat.parse("netslide 2x2\n┌╴\n└╴").tiles).toEqual([9, 4, 3, 4]);
});
