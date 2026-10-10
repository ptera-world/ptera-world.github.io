import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep } from "../../core/techniques";
import { foglemanFormat, gridFormat, rushhour, type RushAction } from "./logic";
import { BANDS, cluster, distance, plan, startPos, type RushPuzzle } from "./solver";
import { rushTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(rushhour, params, seed, sig()) as Promise<RushPuzzle>;

const solved = (p: RushPuzzle) => {
  let s = rushhour.init(p);
  for (const m of (rushhour.solve!(p, s) as { moves: RushAction[] }).moves) s = rushhour.reduce(p, s, m);
  return s;
};

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ difficulty: "medium" }, "abc");
  expect(await gen({ difficulty: "medium" }, "abc")).toEqual(a);
  expect(await gen({ difficulty: "medium" }, "abd")).not.toEqual(a);
});

test("generated lots need the difficulty's number of moves", async () => {
  for (const [i, difficulty] of (["easy", "medium", "hard"] as const).entries()) {
    for (const seed of ["a", "b"]) {
      const p = await gen({ difficulty }, seed);
      const d = distance(p, startPos(p))!;
      expect(d).toBeGreaterThanOrEqual(BANDS[i]![0]);
      expect(d).toBeLessThanOrEqual(BANDS[i]![1]);
      expect(rushhour.isSolved(p, solved(p))).toBe(true);
      expect(solved(p).moves).toBe(d);
    }
  }
}, 60000);

test("Fogleman's database example: 60 moves, 2332 positions", () => {
  const p = foglemanFormat.parse("60 IBBxooIooLDDJAALooJoKEEMFFKooMGGHHHM 2332");
  expect(p.walls).toEqual([3]);
  expect(p.cars.length).toBe(12);
  expect(distance(p, startPos(p))).toBe(60);
  expect(cluster(p).toGoal.size).toBe(2332);
  expect(foglemanFormat.parse(foglemanFormat.serialize!(p))).toEqual(p);
});

test("formats round-trip and reject bad lots", async () => {
  const p = await gen({ width: 7, height: 5, difficulty: "easy" }, "fmt");
  expect(gridFormat.parse(gridFormat.serialize!(p))).toEqual(p);
  const six = await gen({ difficulty: "easy" }, "fmt6");
  expect(foglemanFormat.parse(foglemanFormat.serialize!(six))).toEqual(six);
  expect(() => foglemanFormat.serialize!(p)).toThrow();
  expect(() => gridFormat.parse("ooo\nBoo\nooo")).toThrow();
  expect(() => gridFormat.parse("Aoo\nAoo\nooo")).toThrow();
  expect(() => gridFormat.parse("AAo\nBoB\nooo")).toThrow();
});

test("slides only go through free cells, along the car", () => {
  const p = gridFormat.parse("oooo\nAAoB\noooB\noooo");
  let s = rushhour.init(p);
  expect(rushhour.reduce(p, s, { type: "slide", car: 0, to: 2 })).toBe(s);
  expect(rushhour.reduce(p, s, { type: "slide", car: 1, to: 3 })).toBe(s);
  s = rushhour.reduce(p, s, { type: "slide", car: 1, to: 2 });
  expect(s.pos).toEqual([0, 2]);
  s = rushhour.reduce(p, s, { type: "slide", car: 0, to: 2 });
  expect(rushhour.isSolved(p, s)).toBe(true);
  expect(s.moves).toBe(2);
  expect(rushhour.describeAction!(p, { type: "slide", car: 1, to: 2 }, rushhour.init(p), s)).toBe("B down");
  expect(rushhour.describeAction!(p, { type: "slide", car: 0, to: 2 }, s, s)).toBe("A out");
});

test("hints follow a shortest way out from anywhere, wandering included", async () => {
  const p = await gen({ difficulty: "medium" }, "hint");
  const registry = new Registry();
  for (const t of rushTechniques) registry.technique(t);
  const s = new Session(rushhour, p, { kind: "imported" });
  new TechniqueHost(registry, s);
  for (let i = 0; i < 3; i++) {
    const m = plan(p, s.state.pos)!;
    const car = m.length > 1 ? m[1]!.car : m[0]!.car;
    const alt = [0, 1, 2, 3, 4, 5].find((to) => to !== s.state.pos[car] && rushhour.reduce(p, s.state, { type: "slide", car, to }) !== s.state);
    if (alt !== undefined) s.dispatch({ type: "slide", car, to: alt });
  }
  const left = distance(p, s.state.pos)!;
  let used = 0;
  for (; used < 100 && !s.solved; used++) {
    const h = s.hint()!;
    expect(h.actions?.length).toBe(1);
    s.dispatch(h.actions![0]!);
  }
  expect(s.solved).toBe(true);
  expect(used).toBe(left);
});

test("every technique step shortens the way out by one", async () => {
  const p = await gen({ difficulty: "hard" }, "steps");
  let st = rushhour.init(p);
  const seen = new Set<string>();
  while (!rushhour.isSolved(p, st)) {
    const hit = firstStep(rushhour, rushTechniques, p, st)!;
    seen.add(hit.technique.id);
    const before = distance(p, st.pos)!;
    st = applyStep(rushhour, p, st, hit.step);
    expect(distance(p, st.pos)).toBe(before - 1);
    expect((hit.step.actions[0] as RushAction).type).toBe("slide");
  }
  expect(seen.has("rushhour.drive-out")).toBe(true);
  expect(seen.has("rushhour.make-room")).toBe(true);
}, 60000);

test("practice finds a position for every technique", async () => {
  for (const t of rushTechniques) expect(await findPracticePosition(rushhour, rushTechniques, t, "practice", sig())).not.toBeNull();
}, 60000);
