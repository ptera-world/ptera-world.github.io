import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findStep, findPracticePosition, firstStep } from "../../core/techniques";
import { fill, flood, gridFormat, sgtFormat, solverRun, type FloodPuzzle } from "./logic";
import { behindPace, floodTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(flood, params, seed, sig()) as Promise<FloodPuzzle>;

test("the solver makes the same fills as sgt's (reference runs of its compiled C)", () => {
  const cases: [number, number, number, string, string][] = [
    [4, 4, 3, "0120120101202101", "121201"],
    [6, 5, 4, "012301230123012301230123012332", "120230132"],
    [8, 8, 6, "0123450123451234502345013450124501235012340123450123451234502345", "123534520141430245"],
  ];
  for (const [w, h, colours, grid, moves] of cases) {
    expect(grid.length).toBe(w * h);
    expect(solverRun({ w, h, colours }, [...grid].map(Number)).join("")).toBe(moves);
  }
});

test("generation is deterministic; the limit is the solver's count plus the spare moves", async () => {
  expect(await gen({ width: 10, height: 9 }, "a")).toEqual(await gen({ width: 10, height: 9 }, "a"));
  expect(await gen({ width: 10, height: 9 }, "a")).not.toEqual(await gen({ width: 10, height: 9 }, "b"));
  for (const pr of flood.presets!) {
    const p = await gen(pr.params, "x");
    expect(p.limit).toBe(solverRun(p, p.grid).length + (pr.params.leniency ?? 5));
  }
});

test("technique steps alone stay within the limit, even with no spare moves", async () => {
  for (const seed of ["t1", "t2", "t3"]) {
    const p = await gen({ width: 12, height: 12, colours: 6, leniency: 0 }, seed);
    let s = flood.init(p);
    for (let i = 0; i < 200 && !flood.isSolved(p, s); i++) {
      const hit = firstStep(flood, floodTechniques, p, s);
      if (!hit) break;
      s = applyStep(flood, p, s, hit.step);
    }
    expect(s.moves).toBeLessThanOrEqual(p.limit + 3);
  }
});

test("wiping out a color really removes it", async () => {
  const p = await gen({ width: 8, height: 8, colours: 4 }, "w");
  let s = flood.init(p);
  for (let i = 0; i < 40 && !flood.isSolved(p, s); i++) {
    const step = findStep(flood, floodTechniques[0]!, p, s);
    if (step) {
      const c = (step.actions[0] as unknown as { colour: number }).colour;
      const next = applyStep(flood, p, s, step);
      expect(next.grid.filter((v) => v === c).length).toBe(next.grid.filter((v) => v === next.grid[0]).length);
    }
    const hit = firstStep(flood, floodTechniques, p, s);
    if (!hit) break;
    s = applyStep(flood, p, s, hit.step);
  }
});

test("falling behind is pointed out before any move, and running out loses", async () => {
  const p = await gen({ width: 10, height: 10, colours: 6, leniency: 0 }, "pace");
  const registry = new Registry();
  for (const t of floodTechniques) registry.technique(t);
  const session = new Session(flood, p, { kind: "imported" });
  new TechniqueHost(registry, session);
  behindPace.setup!({ session, settings: {}, owner: "pace" });
  for (let i = 0; session.state.moves < p.limit && !session.solved && i < 200; i++) {
    const c = [0, 1].find((x) => x !== session.state.grid[0])!;
    session.dispatch({ type: "fill", colour: c });
  }
  expect(session.lost).toBe(true);
  expect(session.hint()?.actions).toBeUndefined();
  session.undo();
  expect(session.lost).toBe(false);
  expect(session.hint()?.message).toContain("needs");
});

test("practice positions exist", async () => {
  for (const t of floodTechniques) {
    const pos = await findPracticePosition(flood, floodTechniques, t, "x", sig());
    expect(pos && findStep(flood, t, pos.puzzle, pos.state)?.actions.length).toBeGreaterThan(0);
  }
});

test("formats round-trip; sgt ids parse", async () => {
  const p = await gen({ width: 7, height: 5, colours: 10 }, "fmt");
  for (const f of flood.formats) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(p);
  }
  expect(sgtFormat.parse("3x1c10m0:910,2").grid).toEqual([9, 1, 0]);
  expect(() => sgtFormat.parse("3x1:A10,2")).toThrow();
  expect(gridFormat.parse("flood limit=3\n012\n120").limit).toBe(3);
  expect(fill(3, 1, [0, 0, 1], 1)).toEqual([1, 1, 1]);
});
