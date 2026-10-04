import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import { LINE, edgeGrid } from "../../lib/edges";
import { CROSS, NONE, cellName, gridFormat, pearl, sgtFormat, type PearlAction, type PearlFocus } from "./logic";
import { checkMarks } from "./plugins";
import { BLACK, EMPTY, WHITE, analyze, countSolutions, freshKnowledge, logicSolve, loopEdges, pearlsFor, randomLoop, type Level, type PearlPuzzle } from "./solver";
import { pearlTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(pearl, params, seed, sig()) as Promise<PearlPuzzle>;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 7, height: 7, difficulty: "hard" }, "abc");
  const b = await gen({ width: 7, height: 7, difficulty: "hard" }, "abc");
  const c = await gen({ width: 7, height: 7, difficulty: "hard" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

test("random loops are single loops that never touch themselves", () => {
  for (let i = 0; i < 20; i++) {
    const w = 5 + (i % 6), h = 5 + (i % 4);
    const loop = randomLoop(w, h, createRng(`l${i}`));
    const p: PearlPuzzle = { w, h, pearls: Array.from({ length: w * h }, () => EMPTY) };
    expect(pearl.isSolved(p, { edges: loop.map((v) => (v ? LINE : NONE)) })).toBe(true);
    const pearls = pearlsFor(w, h, loop);
    expect(pearls.some((v) => v === BLACK) || pearls.some((v) => v === WHITE)).toBe(true);
    expect(pearl.isSolved({ w, h, pearls }, { edges: loop.map((v) => (v ? LINE : NONE)) })).toBe(true);
  }
});

for (const difficulty of ["easy", "hard"] as const) {
  test(`${difficulty} puzzles are unique, logic-solvable, and need exactly ${difficulty}`, async () => {
    const want = ["easy", "hard"].indexOf(difficulty) as Level;
    for (let i = 0; i < 6; i++) {
      const p = await gen({ width: 6 + (i % 2), height: 6 + (i % 3), difficulty }, `s${i}`);
      expect(logicSolve(p, want).level).toBe(want);
      if (want > 0) expect(logicSolve(p, 0).level).toBeNull();
      const brute = countSolutions(p, freshKnowledge(edgeGrid(p.w, p.h)), 2);
      expect(brute.count).toBe(1);
      expect(analyze(p).solution).toEqual(loopEdges(brute.first!));
    }
  }, 30000);
}

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 150; t++) {
    const w = rng.range(3, 5), h = rng.range(3, 5);
    const pearls = Array.from({ length: w * h }, () => (rng.bool(0.3) ? rng.pick([BLACK, WHITE]) : EMPTY));
    const p: PearlPuzzle = { w, h, pearls };
    const brute = countSolutions(p, freshKnowledge(edgeGrid(w, h)), 2);
    const logic = logicSolve(p, 1);
    if (logic.level !== null) {
      solved++;
      expect(brute.count).toBe(1);
      expect(loopEdges(logic.k)).toEqual(loopEdges(brute.first!));
    }
    if (!logic.ok) expect(brute.count).toBe(0);
  }
  expect(solved).toBeGreaterThan(2);
});

function played(p: PearlPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of pearlTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(pearl, p, { kind: "imported" });
  new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return s;
}

test("following hints solves both difficulties; wrong marks come first", async () => {
  for (const difficulty of ["easy", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `h-${difficulty}`);
    const s = played(p);
    const bad = analyze(p).solution!.findIndex((v) => v === 1);
    s.dispatch({ type: "set", edges: [bad], value: CROSS });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "set", edges: [bad], value: NONE });
    for (let i = 0; i < 400 && !s.solved; i++) {
      const h = s.hint();
      expect(h?.actions?.length).toBeGreaterThan(0);
      s.batch(() => { for (const a of h!.actions!) s.dispatch(a); });
    }
    expect(s.solved).toBe(true);
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  for (const difficulty of ["easy", "hard"] as const) {
    for (let i = 0; i < 3; i++) {
      const p = await gen({ width: 7, height: 7, difficulty }, `r${i}`);
      const r = rateByTechniques(pearl, pearlTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.id === "pearl.trial").toBe(difficulty === "hard");
    }
  }
});

test("technique steps agree with the solution and never overwrite marks", async () => {
  for (const difficulty of ["easy", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = pearl.init(p);
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(pearl, pearlTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as PearlAction[]) {
        for (const e of a.edges) {
          expect(st.edges[e]).toBe(NONE);
          expect(a.value === LINE ? 1 : 0).toBe(sol[e]!);
        }
      }
      st = applyStep(pearl, p, st, hit.step);
    }
    expect(pearl.isSolved(p, st)).toBe(true);
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of ["easy", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `names-${difficulty}`);
    const g = edgeGrid(p.w, p.h);
    let st = pearl.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of pearlTechniques) {
        const step = t.find(p, st);
        if (!step) continue;
        const all = (f: PearlFocus) => new Set([...f.because, ...f.edges.flatMap((e) => [g.ea[e]!, g.eb[e]!])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as PearlFocus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(pearl, pearlTechniques, p, st);
      if (!hit) break;
      st = applyStep(pearl, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(30);
});

test("auto techniques cascade inside one undo step", async () => {
  const p = await gen({ width: 6, height: 6, difficulty: "easy" }, "auto");
  const s = played(p, pearlTechniques.filter((t) => t.id !== "pearl.trial").map((t) => t.id));
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.edges.every((v) => v === NONE)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of pearlTechniques) {
    const pos = await findPracticePosition(pearl, pearlTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(pearl, pearlTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 60000);

test("formats round-trip; game ids parse like the original", async () => {
  const p = await gen({ width: 8, height: 7 }, "fmt");
  for (const f of [sgtFormat, gridFormat]) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(p);
  }
  expect(sgtFormat.parse(sgtFormat.serialize!(p).replace(":", "de:"))).toEqual(p);
  expect(sgtFormat.parse("3x2:aBcW").pearls).toEqual([EMPTY, BLACK, EMPTY, EMPTY, EMPTY, WHITE]);
  expect(() => sgtFormat.parse("3x2:aBcWa")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 6, height: 6 }, "solve");
  expect(pearl.isSolved(p, pearl.solve!(p)!)).toBe(true);
  expect(pearl.isSolved(p, pearl.init(p))).toBe(false);
});
