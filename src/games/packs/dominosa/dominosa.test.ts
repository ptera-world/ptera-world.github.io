import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, findStep, firstStep, rateByTechniques } from "../../core/techniques";
import { geometry, type DominosaPuzzle } from "./grid";
import { DOMINO, LINE, NONE, cellName, dominosa, gridFormat, sgtFormat, type DominosaAction, type DominosaFocus } from "./logic";
import { checkMarks } from "./plugins";
import { YES, analyze, countSolutions, freshKnowledge, logicSolve, type Level } from "./solver";
import { dominosaTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(dominosa, params, seed, sig()) as Promise<DominosaPuzzle>;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ max: 6, difficulty: "hard" }, "abc");
  const b = await gen({ max: 6, difficulty: "hard" }, "abc");
  const c = await gen({ max: 6, difficulty: "hard" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of ["easy", "medium", "hard"] as const) {
  test(`${difficulty} puzzles are unique, logic-solvable, and need exactly ${difficulty}`, async () => {
    const want = ["easy", "medium", "hard"].indexOf(difficulty) as Level;
    for (let i = 0; i < 10; i++) {
      const p = await gen({ max: 3 + (i % 5), difficulty }, `s${i}`);
      expect(logicSolve(p, want).level).toBe(want);
      if (want > 0) expect(logicSolve(p, (want - 1) as Level).level).toBeNull();
      const g = geometry(p);
      const brute = countSolutions(g, freshKnowledge(g), 2);
      expect(brute.count).toBe(1);
      expect(analyze(p).solution).toEqual(Array.from(brute.first!, (v) => (v === YES ? 1 : 0)));
    }
  });
}

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 300; t++) {
    const n = rng.range(1, 4);
    const w = n + 2, h = n + 1;
    // random numbers with the right balance, not necessarily from a tiling
    const numbers = rng.shuffle(Array.from({ length: w * h }, (_, i) => i % (n + 1)));
    const p: DominosaPuzzle = { n, w, h, numbers };
    const g = geometry(p);
    const brute = countSolutions(g, freshKnowledge(g), 2);
    const logic = logicSolve(p, 2);
    if (logic.level !== null) {
      solved++;
      expect(brute.count).toBe(1);
      expect(Array.from(logic.k, (v) => v === YES)).toEqual(Array.from(brute.first!, (v) => v === YES));
    }
    if (!logic.ok) expect(brute.count).toBe(0);
  }
  expect(solved).toBeGreaterThan(10);
});

function played(p: DominosaPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of dominosaTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(dominosa, p, { kind: "imported" });
  new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return s;
}

const solution = (p: DominosaPuzzle) => analyze(p).solution!;

test("wrong marks come first", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ max: 6, difficulty }, `h-${difficulty}`);
    const s = played(p);
    const bad = solution(p).findIndex((v) => v === 0);
    s.dispatch({ type: "set", placements: [bad], value: DOMINO });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "set", placements: [bad], value: NONE });
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  const lvl = (id: string) => dominosaTechniques.find((t) => t.id === id)!.level;
  const top = { easy: lvl("dominosa.only-neighbour"), medium: lvl("dominosa.odd-area"), hard: lvl("dominosa.trial") };
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    for (let i = 0; i < 4; i++) {
      const p = await gen({ max: 5, difficulty }, `r${i}`);
      const r = rateByTechniques(dominosa, dominosaTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(top[difficulty]);
      if (difficulty === "medium") expect(r!.hardest.level).toBeGreaterThan(top.easy);
      if (difficulty === "hard") expect(r!.hardest.level).toBeGreaterThan(top.medium);
    }
  }
});

test("technique steps agree with the solution and never touch marked or covered cells", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ max: 6, difficulty }, `sound-${difficulty}`);
    const g = geometry(p);
    const sol = solution(p);
    let st = dominosa.init(p);
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(dominosa, dominosaTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as DominosaAction[]) {
        for (const q of a.placements) {
          expect(st.marks[q]).toBe(NONE);
          for (const c of [g.pa[q]!, g.pb[q]!]) expect(g.byCell[c]!.some((o) => st.marks[o] === DOMINO)).toBe(false);
          expect(a.value === DOMINO ? 1 : 0).toBe(sol[q]!);
        }
      }
      st = applyStep(dominosa, p, st, hit.step);
    }
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ max: 6, difficulty }, `names-${difficulty}`);
    const g = geometry(p);
    let st = dominosa.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of dominosaTechniques) {
        const step = findStep(dominosa, t, p, st);
        if (!step) continue;
        const all = (f: DominosaFocus) => new Set([...f.because, ...f.placements.flatMap((q) => [g.pa[q]!, g.pb[q]!])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as DominosaFocus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as DominosaFocus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(dominosa, dominosaTechniques, p, st);
      if (!hit) break;
      st = applyStep(dominosa, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(30);
});

test("findAt only returns steps at the target", async () => {
  const p = await gen({ max: 5, difficulty: "easy" }, "aim");
  const st = dominosa.init(p);
  const g = geometry(p);
  let found = 0;
  for (let q = 0; q < g.np; q++) {
    for (const t of dominosaTechniques) {
      const step = t.findAt!(p, st, { placement: q });
      if (!step) continue;
      found++;
      expect((step.actions[0] as DominosaAction).placements).toContain(q);
    }
  }
  expect(found).toBeGreaterThan(0);
});

test("placing a domino replaces the ones it overlaps; lines can't go next to a domino", () => {
  const p: DominosaPuzzle = { n: 2, w: 4, h: 3, numbers: [0, 0, 1, 1, 0, 1, 0, 2, 2, 1, 2, 2] };
  let st = dominosa.init(p);
  const g = geometry(p);
  const q0 = g.between(0, 1), q1 = g.between(1, 2), qv = g.between(0, 4);
  st = dominosa.reduce(p, st, { type: "set", placements: [q0], value: DOMINO });
  st = dominosa.reduce(p, st, { type: "set", placements: [q1], value: DOMINO });
  expect(st.marks[q0]).toBe(NONE);
  expect(st.marks[q1]).toBe(DOMINO);
  const same = dominosa.reduce(p, st, { type: "set", placements: [g.between(2, 3)], value: LINE });
  expect(same).toBe(st);
  expect(dominosa.reduce(p, st, { type: "set", placements: [qv], value: LINE }).marks[qv]).toBe(LINE);
});

test("auto techniques cascade inside one undo step", async () => {
  const p = await gen({ max: 5, difficulty: "easy" }, "auto");
  const s = played(p, ["dominosa.only-place", "dominosa.only-neighbour"]);
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.marks.every((m) => m === NONE)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of dominosaTechniques) {
    const pos = await findPracticePosition(dominosa, dominosaTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(dominosa, dominosaTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
});

test("formats round-trip; game ids parse like the original", async () => {
  const p = await gen({ max: 6 }, "fmt");
  for (const f of [sgtFormat, gridFormat]) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(p);
  }
  expect(sgtFormat.parse(`6db:${sgtFormat.serialize!(p).split(":")[1]}`)).toEqual(p);
  const big = await gen({ max: 11, difficulty: "easy" }, "big");
  expect(sgtFormat.serialize!(big)).toContain("[11]");
  expect(sgtFormat.parse(sgtFormat.serialize!(big))).toEqual(big);
  expect(() => sgtFormat.parse("1:000011")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ max: 4 }, "solve");
  const ans = dominosa.solve!(p, dominosa.init(p))!;
  expect("board" in ans && dominosa.isSolved(p, ans.board)).toBe(true);
  expect(dominosa.isSolved(p, dominosa.init(p))).toBe(false);
});
