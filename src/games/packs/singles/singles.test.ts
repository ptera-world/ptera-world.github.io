import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import { countSolutions } from "./kit/csp";
import { cellName, type Focus } from "./kit/names";
import {
  BLACK, CIRCLE, NONE, SHADED, analyze, gridFormat, initialDoms, isSolved, latinSquare, logicLevel, model, sgtFormat, singles,
  type Level, type SinglesAction, type SinglesPuzzle,
} from "./logic";
import { checkMarks } from "./plugins";
import { singlesTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(singles, params, seed, sig()) as Promise<SinglesPuzzle>;
const LEVELS = ["easy", "tricky", "hard"] as const;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 8, height: 7, difficulty: "tricky" }, "abc");
  const b = await gen({ width: 8, height: 7, difficulty: "tricky" }, "abc");
  const c = await gen({ width: 8, height: 7, difficulty: "tricky" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of LEVELS) {
  test(`${difficulty} puzzles are unique and need exactly ${difficulty}`, async () => {
    const want = LEVELS.indexOf(difficulty) as Level;
    for (let i = 0; i < 10; i++) {
      const p = await gen({ width: 5 + (i % 5), height: 4 + (i % 6), difficulty }, `s${i}`);
      expect(logicLevel(p, want)).toBe(want);
      const brute = countSolutions(model(p), initialDoms(p), 2);
      expect(brute.count).toBe(1);
      expect(analyze(p).solution).toEqual(Array.from(brute.first!, (m) => (m === 2 ? SHADED : 0)));
    }
  });
}

test("latin squares are latin", () => {
  const rng = createRng("latin");
  for (const o of [1, 2, 5, 9, 12]) {
    const sq = latinSquare(o, rng);
    for (let i = 0; i < o; i++) {
      expect(new Set(sq.slice(i * o, i * o + o)).size).toBe(o);
      expect(new Set(Array.from({ length: o }, (_, j) => sq[j * o + i])).size).toBe(o);
    }
  }
});

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 800; t++) {
    const w = rng.range(3, 5), h = rng.range(3, 5);
    const o = Math.max(w, h);
    const p: SinglesPuzzle = { w, h, nums: Array.from({ length: w * h }, () => rng.range(1, Math.min(o, 3))) };
    const brute = countSolutions(model(p), initialDoms(p), 2);
    const a = analyze(p);
    expect(a.count).toBe(brute.count as 0 | 1 | 2);
    if (a.level !== null) {
      solved++;
      expect(brute.count).toBe(1);
      expect(a.solution).toEqual(Array.from(brute.first!, (m) => (m === 2 ? SHADED : 0)));
    }
    if (brute.count === 1) expect(isSolved(p, singles.solve!(p)!)).toBe(true);
  }
  expect(solved).toBeGreaterThan(5);
});

function played(p: SinglesPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of singlesTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(singles, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("following hints solves boards of every difficulty; wrong marks come first", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 9, height: 9, difficulty }, `h-${difficulty}`);
    const { s } = played(p);
    const sol = analyze(p).solution!;
    const bad = sol.findIndex((v) => v !== SHADED);
    s.dispatch({ type: "set", cells: [bad], value: BLACK });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "set", cells: [bad], value: NONE });
    for (let i = 0; i < 400 && !s.solved; i++) {
      const hnt = s.hint();
      expect(hnt?.actions?.length).toBeGreaterThan(0);
      s.batch(() => { for (const a of hnt!.actions!) s.dispatch(a); });
    }
    expect(s.solved).toBe(true);
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  const lastOf = ["singles.way-out", "singles.split", "singles.trial"];
  const level = (id: string) => singlesTechniques.find((t) => t.id === id)!.level;
  for (const [i, difficulty] of LEVELS.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = await gen({ width: 8, height: 8, difficulty }, `r${j}`);
      const r = rateByTechniques(singles, singlesTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(level(lastOf[i]!));
      if (i > 0) expect(r!.hardest.level).toBeGreaterThan(level(lastOf[i - 1]!));
    }
  }
});

test("every technique step agrees with the solution and never touches marked cells", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = singles.init(p);
    // a wrong mark the techniques must not build on
    const wrong = sol.findIndex((v) => v === SHADED);
    st = singles.reduce(p, st, { type: "set", cells: [wrong], value: CIRCLE });
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(singles, singlesTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as SinglesAction[]) {
        for (const c of a.cells) {
          expect(st.marks[c]).toBe(NONE);
          expect(a.value === BLACK ? SHADED : 0).toBe(sol[c]!);
        }
      }
      st = applyStep(singles, p, st, hit.step);
    }
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty }, `names-${difficulty}`);
    let st = singles.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of singlesTechniques) {
        const step = t.find(p, st);
        if (!step) continue;
        const all = (x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as Focus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as Focus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(singles, singlesTechniques, p, st);
      if (!hit) break;
      st = applyStep(singles, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(50);
});

test("techniques aim at a target cell", async () => {
  const p = await gen({ width: 8, height: 8, difficulty: "easy" }, "aim");
  const st = singles.init(p);
  let aimed = 0;
  for (let c = 0; c < p.w * p.h; c++) {
    for (const t of singlesTechniques) {
      const step = t.findAt!(p, st, c);
      if (!step) continue;
      const f = step.focus as Focus;
      expect(f.cells.includes(c) || f.because.includes(c)).toBe(true);
      aimed++;
    }
  }
  expect(aimed).toBeGreaterThan(0);
});

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 7, height: 7, difficulty: "easy" }, "auto");
  const { s } = played(p, singlesTechniques.slice(0, 5).map((t) => t.id));
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.marks.every((m) => m === NONE)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of singlesTechniques) {
    const pos = await findPracticePosition(singles, singlesTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(singles, singlesTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
});

test("formats round-trip; tatham ids parse", async () => {
  const p = await gen({ width: 12, height: 9 }, "fmt");
  for (const f of [sgtFormat, gridFormat]) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(p);
  }
  const t = sgtFormat.parse("5x5de:1352341342425213523121254");
  expect(t.nums.slice(0, 5)).toEqual([1, 3, 5, 2, 3]);
  expect(sgtFormat.parse("12x12:" + "a".repeat(144)).nums[0]).toBe(10);
  expect(() => sgtFormat.parse("3x3:1234")).toThrow();
  expect(() => sgtFormat.parse("3x3:123412349")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 10, height: 7 }, "solve");
  expect(isSolved(p, singles.solve!(p)!)).toBe(true);
  expect(isSolved(p, singles.init(p))).toBe(false);
});
