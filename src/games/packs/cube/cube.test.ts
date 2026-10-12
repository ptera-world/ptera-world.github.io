import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { SOLIDS, area, faceOf, squares } from "./geometry";
import { arena, classOf, cube, sgtFormat, type CubePuzzle } from "./logic";
import { pose } from "./pose";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(cube, params, seed, sig()) as Promise<CubePuzzle>;

test("arenas match sgt's square counts, and every square links up", () => {
  for (const [solid, d1, d2] of [["cube", 4, 4], ["tetrahedron", 1, 2], ["octahedron", 2, 2], ["icosahedron", 3, 3], ["icosahedron", 4, 0]] as const) {
    const sqs = squares(solid, d1, d2);
    expect(sqs.length).toBe(area(solid, d1, d2));
    const a = arena({ solid, d1, d2 });
    for (const ls of a.links) expect(ls.length).toBeGreaterThan(0);
  }
});

test("generation is deterministic, spreads blue squares over the classes, and starts on a plain square", async () => {
  expect(await gen({ solid: "octahedron", d1: 2, d2: 2 }, "a")).toEqual(await gen({ solid: "octahedron", d1: 2, d2: 2 }, "a"));
  for (const pr of cube.presets!) {
    const p = await gen(pr.params, "x");
    const sqs = arena(p).squares;
    expect(p.blue.reduce((x, y) => x + y, 0)).toBe(SOLIDS[p.solid].faces.length);
    expect(p.blue[p.start]).toBe(0);
    const k = p.solid === "tetrahedron" ? 4 : p.solid === "octahedron" ? 2 : 1;
    for (let c = 0; c < k; c++) expect(sqs.filter((q, i) => p.blue[i] && classOf(p, q) === c).length).toBe(SOLIDS[p.solid].faces.length / k);
  }
});

test("rolling is a rigid motion: the solid always rests on its square, above the arena", async () => {
  for (const pr of cube.presets!) {
    const p = await gen(pr.params, "walk");
    const rng = createRng(`roll-${pr.label}`);
    let s = cube.init(p);
    for (let i = 0; i < 200; i++) {
      const world = pose(p, s);
      const sq = arena(p).squares[s.square]!;
      s.key.forEach((v, j) => {
        expect(Math.hypot(world[v]![0] - sq.points[j]![0], world[v]![1] - sq.points[j]![1], world[v]![2])).toBeLessThan(1e-6);
      });
      for (const v of world) expect(v[2]).toBeGreaterThan(-1e-6);
      expect(faceOf(SOLIDS[p.solid], s.key)).toBeGreaterThanOrEqual(0);
      s = cube.reduce(p, s, { type: "roll", to: rng.pick(arena(p).links[s.square]!).to });
    }
  }
});

test("rolling there and back restores the solid", async () => {
  for (const pr of cube.presets!) {
    const p = await gen(pr.params, "back");
    const s = cube.init(p);
    for (const l of arena(p).links[s.square]!) {
      const there = cube.reduce(p, s, { type: "roll", to: l.to });
      const back = cube.reduce(p, there, { type: "roll", to: s.square });
      expect(back.key).toEqual(s.key);
    }
  }
});

test("colors swap on landing", async () => {
  const p = sgtFormat.parse("c3x3:FC0,8");
  let s = cube.init(p);
  s = cube.reduce(p, s, { type: "roll", to: 5 });
  expect(s.faces.filter(Boolean).length).toBe(1);
  expect(s.blue[5]).toBe(0);
});

test("sgt ids round-trip and match sgt's bitmap layout", async () => {
  for (const pr of cube.presets!) {
    const p = await gen(pr.params, "fmt");
    const text = sgtFormat.serialize!(p);
    expect(sgtFormat.detect!(text)).toBe(true);
    expect(sgtFormat.parse(text)).toEqual(p);
  }
  const p = sgtFormat.parse("c4x4:8427,5");
  expect(p.blue.flatMap((b, i) => (b ? [i] : []))).toEqual([0, 5, 10, 13, 14, 15]);
  expect(() => sgtFormat.parse("c4x4:8420,5")).toThrow();
  expect(sgtFormat.parse("t1x2:F000,4").solid).toBe("tetrahedron");
});
