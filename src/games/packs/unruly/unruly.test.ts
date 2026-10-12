import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, findStep, rateByTechniques } from "../../core/techniques";
import { countSolutions, solveLevel } from "../../lib/grid-kit/csp";
import { cellName, type Focus } from "../../lib/grid-kit/names";
import {
  DARK, LIGHT, NONE, ONE, ZERO, analyze, colourOf, gridFormat, initialDoms, isSolved, markOf, model, sgtFormat, unruly,
  type Level, type UnrulyAction, type UnrulyPuzzle,
} from "./logic";
import { checkMarks } from "./plugins";
import { unrulyTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(unruly, params, seed, sig()) as Promise<UnrulyPuzzle>;
const LEVELS = ["trivial", "easy", "normal", "hard"] as const;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 8, height: 6, difficulty: "normal" }, "abc");
  const b = await gen({ width: 8, height: 6, difficulty: "normal" }, "abc");
  const c = await gen({ width: 8, height: 6, difficulty: "normal" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const unique of [false, true]) {
  for (const difficulty of LEVELS) {
    test(`${difficulty}${unique ? " all-different" : ""} puzzles are unique and need exactly ${difficulty}`, async () => {
      const want = LEVELS.indexOf(difficulty) as Level;
      for (let i = 0; i < 6; i++) {
        const p = await gen({ width: 8 + 2 * (i % 2), height: 6 + 2 * (i % 3), difficulty, unique }, `s${i}`);
        expect(solveLevel(model(p), initialDoms(p), want)).toBe(want);
        const brute = countSolutions(model(p), initialDoms(p), 2);
        expect(brute.count).toBe(1);
      }
    }, 30000);
  }
}

test("the solver counts every grid on small boards", () => {
  const p: UnrulyPuzzle = { w: 4, h: 4, unique: false, cells: Array.from({ length: 16 }, () => -1) };
  let brute = 0;
  for (let m = 0; m < 1 << 16; m++) {
    if (isSolved(p, { marks: Array.from({ length: 16 }, (_, c) => markOf((m >> c) & 1)) })) brute++;
  }
  expect(countSolutions(model(p), initialDoms(p), 1000).count).toBe(brute);
  const u = { ...p, unique: true };
  let bruteU = 0;
  for (let m = 0; m < 1 << 16; m++) {
    if (isSolved(u, { marks: Array.from({ length: 16 }, (_, c) => markOf((m >> c) & 1)) })) bruteU++;
  }
  expect(countSolutions(model(u), initialDoms(u), 1000).count).toBe(bruteU);
});

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 300; t++) {
    const w = 2 * rng.range(2, 3), h = 2 * rng.range(2, 3);
    const p: UnrulyPuzzle = { w, h, unique: rng.bool(0.3), cells: Array.from({ length: w * h }, () => (rng.bool(0.35) ? rng.int(2) : -1)) };
    const brute = countSolutions(model(p), initialDoms(p), 2);
    const a = analyze(p);
    expect(a.count).toBe(brute.count as 0 | 1 | 2);
    if (a.level !== null) {
      solved++;
      expect(a.solution).toEqual(Array.from(brute.first!, (m) => (m === 2 ? ONE : ZERO)));
    }
  }
  expect(solved).toBeGreaterThan(5);
});

function played(p: UnrulyPuzzle, auto: string[] = []) {
  const registry = new Registry();
  registry.puzzle(unruly);
  for (const t of unrulyTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(unruly, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("wrong pieces are pointed out first; technique steps follow", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty, unique: difficulty === "easy" }, `h-${difficulty}`);
    const { s } = played(p);
    const sol = analyze(p).solution!;
    const bad = p.cells.findIndex((v) => v === -1);
    s.dispatch({ type: "set", cells: [bad], value: markOf(1 - sol[bad]!) });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "set", cells: [bad], value: NONE });
    s.dispatch({ type: "set", cells: [bad], value: NONE });
    for (let i = 0; i < 400 && !s.solved; i++) {
      const hit = firstStep(unruly, unrulyTechniques, p, s.state);
      if (!hit) break;
      s.batch(() => { for (const a of hit.step.actions as UnrulyAction[]) s.dispatch(a); });
    }
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  const lastOf = ["unruly.last-cell", "unruly.count-full", "unruly.last-one", "unruly.trial"];
  const level = (id: string) => unrulyTechniques.find((t) => t.id === id)!.level;
  for (const [i, difficulty] of LEVELS.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = await gen({ width: 8, height: 8, difficulty }, `r${j}`);
      const r = rateByTechniques(unruly, unrulyTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(level(lastOf[i]!));
      if (i > 0) expect(r!.hardest.level).toBeGreaterThan(level(lastOf[i - 1]!));
    }
  }
});

test("every technique step agrees with the solution and never touches filled cells", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty, unique: difficulty === "normal" }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = unruly.init(p);
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(unruly, unrulyTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as UnrulyAction[]) {
        for (const c of a.cells) {
          expect(st.marks[c]).toBe(NONE);
          expect(p.cells[c]).toBe(-1);
          expect(colourOf(a.value)).toBe(sol[c]!);
        }
      }
      st = applyStep(unruly, p, st, hit.step);
    }
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty, unique: true }, `names-${difficulty}`);
    let st = unruly.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of unrulyTechniques) {
        const step = findStep(unruly, t, p, st);
        if (!step) continue;
        const all = (x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as Focus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as Focus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(unruly, unrulyTechniques, p, st);
      if (!hit) break;
      st = applyStep(unruly, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(50);
});

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 8, height: 8, difficulty: "easy" }, "auto");
  const { s } = played(p, ["unruly.three", "unruly.last-cell", "unruly.count-full"]);
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.marks.every((m) => m === NONE)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of unrulyTechniques) {
    const pos = await findPracticePosition(unruly, unrulyTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(unruly, unrulyTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 30000);

test("formats round-trip; tatham ids parse", async () => {
  for (const unique of [false, true]) {
    const p = await gen({ width: 10, height: 8, unique }, "fmt");
    for (const f of [sgtFormat, gridFormat]) {
      const text = f.serialize!(p);
      expect(f.detect!(text)).toBe(true);
      expect(f.parse(text)).toEqual(p);
    }
  }
  // "c" skips two then places light; "B" skips one then places dark; the final "l" runs one past the end
  const t = sgtFormat.parse("4x4dt:cBl");
  expect(t.cells.slice(0, 5)).toEqual([-1, -1, ZERO, -1, ONE]);
  expect(t.cells.filter((v) => v >= 0).length).toBe(2);
  expect(sgtFormat.parse("6x6u:" + "z" + "l").unique).toBe(true);
  expect(() => sgtFormat.parse("4x4:a")).toThrow();
  expect(() => sgtFormat.parse("5x4:" + "t")).toThrow();
  const big: UnrulyPuzzle = { w: 6, h: 6, unique: false, cells: Array.from({ length: 36 }, (_, i) => (i === 30 ? ONE : -1)) };
  expect(sgtFormat.serialize!(big)).toBe("6x6:ZFf");
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 10, height: 6 }, "solve");
  const ans = unruly.solve!(p, unruly.init(p))!;
  expect("board" in ans && isSolved(p, ans.board)).toBe(true);
  expect(isSolved(p, unruly.init(p))).toBe(false);
  expect([DARK, LIGHT]).toContain(markOf(ONE));
});
