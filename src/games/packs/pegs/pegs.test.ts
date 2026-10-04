import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep } from "../../core/techniques";
import { CROSS_SOLUTIONS, OCTAGON_SOLUTIONS } from "./known";
import { crossGrid, gridFormat, pegCount, pegs, sgtFormat, type PegsPuzzle } from "./logic";
import { findSolution } from "./solver";
import { checkFinishable, pegsTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(pegs, params, seed, sig()) as Promise<PegsPuzzle>;

function play(p: PegsPuzzle, moves: [number, number][]) {
  let s = pegs.init(p);
  for (const [from, to] of moves) {
    const next = pegs.reduce(p, s, { type: "jump", from, to });
    expect(next).not.toBe(s);
    s = next;
  }
  return s;
}

test("every stored solution leaves one peg", async () => {
  for (const key of Object.keys(CROSS_SOLUTIONS)) {
    const [w, h] = key.split("x").map(Number) as [number, number];
    expect(pegs.isSolved({ w, h, grid: [] }, play({ w, h, grid: crossGrid(w, h) }, CROSS_SOLUTIONS[key]!))).toBe(true);
  }
  expect(OCTAGON_SOLUTIONS.length).toBe(3);
  for (let i = 0; i < 40; i++) {
    const p = await gen({ board: "octagon" }, `o${i}`);
    expect(pegs.isSolved(p, play(p, p.solution!))).toBe(true);
  }
});

test("generation is deterministic; every board's own solution works", async () => {
  expect(await gen({ board: "random", width: 7, height: 7 }, "a")).toEqual(await gen({ board: "random", width: 7, height: 7 }, "a"));
  expect(await gen({ board: "random", width: 7, height: 7 }, "a")).not.toEqual(await gen({ board: "random", width: 7, height: 7 }, "b"));
  for (const pr of [...pegs.presets!.map((x) => x.params), { board: "random", width: 4, height: 11 }]) {
    for (const seed of ["x", "y", "z"]) {
      const p = await gen(pr, seed);
      expect(pegs.isSolved(p, play(p, p.solution!))).toBe(true);
    }
  }
});

test("random shapes reach all four edges", async () => {
  for (let i = 0; i < 10; i++) {
    const p = await gen({ board: "random", width: 6, height: 5 }, `e${i}`);
    const on = p.grid.flatMap((v, c) => (v !== 2 ? [c] : []));
    expect(on.some((c) => c % p.w === 0) && on.some((c) => c % p.w === p.w - 1) && on.some((c) => c < p.w) && on.some((c) => c >= p.w * (p.h - 1))).toBe(true);
  }
});

test("hints finish a board after a detour, and a hopeless board is pointed out first", async () => {
  const p = await gen({ board: "random", width: 7, height: 7 }, "h");
  const registry = new Registry();
  for (const t of pegsTechniques) registry.technique(t);
  const session = new Session(pegs, p, { kind: "imported" });
  new TechniqueHost(registry, session);
  checkFinishable.setup!({ session, settings: {}, owner: "check" });
  for (let i = 0; i < 100 && !session.solved; i++) {
    const h = session.hint();
    expect(h?.actions?.length).toBe(1);
    session.dispatch(h!.actions![0]!);
  }
  expect(session.solved).toBe(true);
  const q = gridFormat.parse("oo.oo\n#####");
  const s2 = new Session(pegs, q, { kind: "imported" });
  checkFinishable.setup!({ session: s2, settings: {}, owner: "check" });
  expect(s2.hint()?.message).toContain("no sequence");
});

test("the search proves small dead ends and solves small boards", () => {
  expect(findSolution(5, 1, [1, 1, 0, 1, 1]).impossible).toBe(true);
  expect(findSolution(4, 1, [1, 1, 0, 0]).path?.length).toBe(1);
});

test("techniques alone finish the stored-solution boards, and practice works", async () => {
  for (const pr of pegs.presets!) {
    const p = await gen(pr.params, "t");
    let s = pegs.init(p);
    for (let i = 0; i < 80 && !pegs.isSolved(p, s); i++) s = applyStep(pegs, p, s, firstStep(pegs, pegsTechniques, p, s)!.step);
    expect(pegCount(s.grid)).toBe(1);
  }
  const pos = await findPracticePosition(pegs, pegsTechniques, pegsTechniques[0]!, "x", sig());
  expect(pos?.step.actions.length).toBe(1);
});

test("jumps and losing", () => {
  const p = gridFormat.parse("oo.\n###");
  const s = pegs.reduce(p, pegs.init(p), { type: "jump", from: 0, to: 2 });
  expect(s.grid.slice(0, 3)).toEqual([0, 0, 1]);
  expect(pegs.isSolved(p, s)).toBe(true);
  const start = pegs.init(p);
  expect(pegs.reduce(p, start, { type: "jump", from: 1, to: 2 })).toBe(start);
  const stuck = gridFormat.parse("o.o\n###");
  expect(pegs.isLost!(stuck, pegs.init(stuck))).toBe(true);
});

test("formats round-trip; sgt ids parse", async () => {
  const p = await gen({ board: "random", width: 7, height: 5 }, "fmt");
  const { solution: _, ...bare } = p;
  for (const f of pegs.formats) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(bare);
  }
  expect(sgtFormat.parse("3x1:PPH").grid).toEqual([1, 1, 0]);
  expect(sgtFormat.parse("7x7cross:OOPPPOOOOPPPOOPPPPPPPPPPHPPPPPPPPPPOOPPPOOOOPPPOO").grid).toEqual(crossGrid(7, 7));
  expect(() => sgtFormat.parse("3x1:PHH")).toThrow();
});
