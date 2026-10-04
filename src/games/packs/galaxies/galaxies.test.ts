import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import { cellName, galaxies, sgtFormat, type GalaxiesAction, type GalaxiesFocus } from "./logic";
import { checkMarks } from "./plugins";
import { analyze, countSolutions, freshOwners, geometry, logicSolve, randomPartition, type GalaxiesPuzzle, type Level } from "./solver";
import { galaxiesTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(galaxies, params, seed, sig()) as Promise<GalaxiesPuzzle>;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 7, height: 7, difficulty: "hard" }, "abc");
  const b = await gen({ width: 7, height: 7, difficulty: "hard" }, "abc");
  const c = await gen({ width: 7, height: 7, difficulty: "hard" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of ["easy", "medium", "hard"] as const) {
  test(`${difficulty} puzzles are unique, logic-solvable, and need exactly ${difficulty}`, async () => {
    const want = ["easy", "medium", "hard"].indexOf(difficulty) as Level;
    for (let i = 0; i < 6; i++) {
      const p = await gen({ width: 6 + (i % 3), height: 6 + (i % 2), difficulty }, `s${i}`);
      expect(logicSolve(p, want).level).toBe(want);
      if (want > 0) expect(logicSolve(p, (want - 1) as Level).level).toBeNull();
      const brute = countSolutions(p, freshOwners(geometry(p)), 2);
      expect(brute.count).toBe(1);
      expect(analyze(p).solution).toEqual(Array.from(brute.first!));
    }
  }, 30000);
}

test("logic never contradicts brute force on random dot layouts", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 150; t++) {
    const w = rng.range(3, 5), h = rng.range(3, 5);
    const base = randomPartition(w, h, rng.range(2, 8), rng);
    const dots = base.dots.filter(() => rng.bool(0.85));
    if (!dots.length) continue;
    const p: GalaxiesPuzzle = { w, h, dots };
    const brute = countSolutions(p, freshOwners(geometry(p)), 2);
    const logic = logicSolve(p, 2);
    if (logic.level !== null) {
      solved++;
      expect(brute.count).toBe(1);
      expect(Array.from(logic.own)).toEqual(Array.from(brute.first!));
    }
    if (!logic.ok) expect(brute.count).toBe(0);
  }
  expect(solved).toBeGreaterThan(10);
});

function played(p: GalaxiesPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of galaxiesTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(galaxies, p, { kind: "imported" });
  new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return s;
}

test("following hints solves every difficulty; wrong tiles come first", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `h-${difficulty}`);
    const s = played(p);
    const sol = analyze(p).solution!;
    const g = geometry(p);
    const t = sol.findIndex((_, i) => g.coreOf[i] === -1);
    s.dispatch({ type: "paint", tiles: [t], dot: (sol[t]! + 1) % p.dots.length });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "paint", tiles: [t], dot: -1 });
    for (let i = 0; i < 600 && !s.solved; i++) {
      const h = s.hint();
      expect(h?.actions?.length).toBeGreaterThan(0);
      s.batch(() => { for (const a of h!.actions!) s.dispatch(a); });
    }
    expect(s.solved).toBe(true);
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  for (const [difficulty, top] of [["easy", "galaxies.only-dot"], ["medium", "galaxies.cut"], ["hard", "galaxies.trial"]] as const) {
    for (let i = 0; i < 3; i++) {
      const p = await gen({ width: 7, height: 7, difficulty }, `r${i}`);
      const r = rateByTechniques(galaxies, galaxiesTechniques, p);
      expect(r).not.toBeNull();
      if (difficulty !== "easy") expect(r!.hardest.id).toBe(top);
      else expect(["galaxies.mirror", "galaxies.only-dot"]).toContain(r!.hardest.id);
    }
  }
});

test("technique steps agree with the solution", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = galaxies.init(p);
    for (let i = 0; i < 600; i++) {
      const hit = firstStep(galaxies, galaxiesTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as GalaxiesAction[]) for (const t of a.tiles) { expect(st.owner[t]).toBe(-1); expect(a.dot).toBe(sol[t]!); }
      st = applyStep(galaxies, p, st, hit.step);
    }
    expect(galaxies.isSolved(p, st)).toBe(true);
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `names-${difficulty}`);
    const g = geometry(p);
    let st = galaxies.init(p);
    for (let i = 0; i < 600; i++) {
      for (const t of galaxiesTechniques) {
        const step = t.find(p, st);
        if (!step) continue;
        const all = (f: GalaxiesFocus) => new Set([...f.tiles, ...f.because, ...f.dots.flatMap((d) => g.core[d]!)].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as GalaxiesFocus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as GalaxiesFocus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(galaxies, galaxiesTechniques, p, st);
      if (!hit) break;
      st = applyStep(galaxies, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(30);
});

test("auto techniques cascade inside one undo step", async () => {
  const p = await gen({ width: 6, height: 6, difficulty: "easy" }, "auto");
  const s = played(p, ["galaxies.mirror", "galaxies.only-dot"]);
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.owner).toEqual(Array.from(geometry(p).coreOf));
});

test("practice finds a position for every technique", async () => {
  for (const t of galaxiesTechniques) {
    const pos = await findPracticePosition(galaxies, galaxiesTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(galaxies, galaxiesTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 60000);

test("game ids round-trip and parse like the original", async () => {
  const p = await gen({ width: 7, height: 5 }, "fmt");
  const text = sgtFormat.serialize!(p);
  expect(sgtFormat.detect!(text)).toBe(true);
  expect(sgtFormat.parse(text)).toEqual(p);
  expect(sgtFormat.parse(text.replace(":", "du:"))).toEqual(p);
  // 2×1: one dot on the edge between the two tiles (doubled point (2, 1), index 1 of the 3×1 inner points)
  expect(sgtFormat.parse("2x1:b").dots).toEqual([{ x: 2, y: 1, black: false }]);
  expect(sgtFormat.parse("2x1:B").dots).toEqual([{ x: 2, y: 1, black: true }]);
  expect(() => sgtFormat.parse("2x1:aa")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 6, height: 6 }, "solve");
  expect(galaxies.isSolved(p, galaxies.solve!(p)!)).toBe(true);
  expect(galaxies.isSolved(p, galaxies.init(p))).toBe(false);
});
