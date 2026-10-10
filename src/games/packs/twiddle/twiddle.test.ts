import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { applyStep, findStep, findPracticePosition, firstStep } from "../../core/techniques";
import { gridFormat, sgtFormat, twiddle, type TwiddlePuzzle } from "./logic";
import { hint, twiddleTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(twiddle, params, seed, sig()) as Promise<TwiddlePuzzle>;

test("generation is deterministic and never already solved", async () => {
  expect(await gen({ width: 4, height: 3, orientable: true }, "a")).toEqual(await gen({ width: 4, height: 3, orientable: true }, "a"));
  expect(await gen({ width: 4, height: 3 }, "a")).not.toEqual(await gen({ width: 4, height: 3 }, "b"));
  for (const pr of twiddle.presets!) {
    const p = await gen(pr.params, "x");
    expect(twiddle.isSolved(p, twiddle.init(p))).toBe(false);
  }
});

test("following hints solves every preset and other sizes", async () => {
  const cases = [...twiddle.presets!.map((x) => x.params), { width: 2, height: 2 }, { width: 5, height: 3, orientable: true }, { width: 2, height: 5, rowsOnly: true }, { width: 7, height: 6 }];
  for (const params of cases) {
    for (const seed of ["s1", "s2"]) {
      const p = await gen(params, seed);
      let s = twiddle.init(p);
      for (let i = 0; i < 400 && !twiddle.isSolved(p, s); i++) {
        const hit = firstStep(twiddle, twiddleTechniques, p, s);
        const h = hit ? null : hint(p, s);
        expect(hit ?? h).not.toBeNull();
        s = hit ? applyStep(twiddle, p, s, hit.step) : h!.actions!.reduce((t, a) => twiddle.reduce(p, t, a), s);
      }
      expect(twiddle.isSolved(p, s)).toBe(true);
    }
  }
}, 60000);

test("rating and practice", async () => {
  const p = await gen({ width: 4, height: 4 }, "r");
  expect(twiddle.rate!(p)?.score).toBeGreaterThan(0);
  for (const t of twiddleTechniques) {
    const pos = await findPracticePosition(twiddle, twiddleTechniques, t, "x", sig());
    expect(pos && findStep(twiddle, t, pos.puzzle, pos.state)?.actions.length).toBeGreaterThan(0);
  }
});

test("a turn and its reverse cancel; orientation follows the block", () => {
  const p = gridFormat.parse("twiddle block=2 orientable\n1 2 3\n4 5 6\n7 8 9");
  const s = twiddle.init(p);
  const ccw = twiddle.reduce(p, s, { type: "rotate", x: 0, y: 0, clockwise: false });
  expect(ccw.tiles).toEqual([2, 5, 3, 1, 4, 6, 7, 8, 9]);
  expect(ccw.turns.slice(0, 2)).toEqual([1, 1]);
  const back = twiddle.reduce(p, ccw, { type: "rotate", x: 0, y: 0, clockwise: true });
  expect(back.tiles).toEqual(s.tiles);
  expect(back.turns).toEqual(s.turns);
});

test("formats round-trip and read sgt ids", async () => {
  for (const params of [{ width: 4, height: 3 }, { width: 3, height: 3, orientable: true }, { width: 3, height: 3, rowsOnly: true }]) {
    const p = await gen(params, "fmt");
    for (const f of twiddle.formats) {
      const text = f.serialize!(p);
      expect(f.detect!(text)).toBe(true);
      expect(f.parse(text)).toEqual(p);
    }
  }
  const o = sgtFormat.parse("3x3n2o:1u2l3d4r5u6u7u8u9u");
  expect(o.turns.slice(0, 4)).toEqual([0, 1, 2, 3]);
  expect(sgtFormat.parse("3x3n2rm20:1,1,1,2,2,2,3,3,3").rowsOnly).toBe(true);
  expect(() => sgtFormat.parse("4x4n3:1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16")).toThrow();
});
