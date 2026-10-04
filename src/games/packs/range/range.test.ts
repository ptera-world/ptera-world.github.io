import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import { countSolutions, solveLevel } from "../../lib/grid-kit/csp";
import { cellName, type Focus } from "../../lib/grid-kit/names";
import {
  BLACK, DOT, NONE, SHADED, analyze, initialDoms, isSolved, model, range, sgtFormat,
  type Level, type RangeAction, type RangePuzzle,
} from "./logic";
import { checkMarks } from "./plugins";
import { rangeTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(range, params, seed, sig()) as Promise<RangePuzzle>;
const LEVELS = ["easy", "normal", "hard"] as const;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 9, height: 7, difficulty: "normal" }, "abc");
  const b = await gen({ width: 9, height: 7, difficulty: "normal" }, "abc");
  const c = await gen({ width: 9, height: 7, difficulty: "normal" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of LEVELS) {
  test(`${difficulty} puzzles are unique, symmetric, and need exactly ${difficulty}`, async () => {
    const want = LEVELS.indexOf(difficulty) as Level;
    for (let i = 0; i < 6; i++) {
      const p = await gen({ width: 8 + (i % 4), height: 7 + (i % 3), difficulty }, `s${i}`);
      expect(solveLevel(model(p), initialDoms(p), want)).toBe(want);
      expect(countSolutions(model(p), initialDoms(p), 2).count).toBe(1);
      const n = p.nums.length;
      p.nums.forEach((v, c) => expect(v > 0).toBe(p.nums[n - 1 - c]! > 0));
    }
  }, 30000);
}

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 400; t++) {
    const w = rng.range(3, 5), h = rng.range(3, 5);
    const p: RangePuzzle = { w, h, nums: Array.from({ length: w * h }, () => (rng.bool(0.3) ? rng.range(1, w + h - 1) : 0)) };
    const brute = countSolutions(model(p), initialDoms(p), 2);
    const a = analyze(p);
    expect(a.count).toBe(brute.count as 0 | 1 | 2);
    if (a.count === 1) {
      solved++;
      expect(isSolved(p, range.solve!(p)!)).toBe(true);
    }
  }
  expect(solved).toBeGreaterThan(5);
});

function played(p: RangePuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of rangeTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(range, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("following hints solves boards of every difficulty; wrong marks come first", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 9, height: 8, difficulty }, `h-${difficulty}`);
    const { s } = played(p);
    const sol = analyze(p).solution!;
    const bad = p.nums.findIndex((v, c) => v === 0 && sol[c] !== SHADED);
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
  const lastOf = ["range.overflow", "range.split", "range.trial"];
  const level = (id: string) => rangeTechniques.find((t) => t.id === id)!.level;
  for (const [i, difficulty] of LEVELS.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = await gen({ width: 9, height: 8, difficulty }, `r${j}`);
      const r = rateByTechniques(range, rangeTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(level(lastOf[i]!));
      if (i > 0) expect(r!.hardest.level).toBeGreaterThan(level(lastOf[i - 1]!));
    }
  }
});

test("every technique step agrees with the solution and never touches marked cells", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 9, height: 8, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = range.init(p);
    const wrong = p.nums.findIndex((v, c) => v === 0 && sol[c] === SHADED);
    st = range.reduce(p, st, { type: "set", cells: [wrong], value: DOT });
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(range, rangeTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as RangeAction[]) {
        for (const c of a.cells) {
          expect(st.marks[c]).toBe(NONE);
          expect(a.value === BLACK ? SHADED : 0).toBe(sol[c]!);
        }
      }
      st = applyStep(range, p, st, hit.step);
    }
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 9, height: 8, difficulty }, `names-${difficulty}`);
    let st = range.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of rangeTechniques) {
        const step = t.find(p, st);
        if (!step) continue;
        const all = (x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as Focus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as Focus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(range, rangeTechniques, p, st);
      if (!hit) break;
      st = applyStep(range, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(50);
});

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 9, height: 6, difficulty: "easy" }, "auto");
  const { s } = played(p, rangeTechniques.slice(0, 4).map((t) => t.id));
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.marks.every((m) => m === NONE)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of rangeTechniques) {
    const pos = await findPracticePosition(range, rangeTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(range, rangeTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 30000);

test("tatham ids parse and round-trip", async () => {
  const p = await gen({ width: 12, height: 8 }, "fmt");
  expect(sgtFormat.parse(sgtFormat.serialize!(p))).toEqual(p);
  const ok = sgtFormat.parse("4x3:2_3c4b5c");
  expect(ok.nums).toEqual([2, 3, 0, 0, 0, 4, 0, 0, 5, 0, 0, 0]);
  expect(sgtFormat.serialize!(ok)).toBe("4x3:2_3c4b5c");
  // numbers go up to width + height - 1
  expect(() => sgtFormat.parse("4x3:12_3c4b5c")).toThrow();
  const long: RangePuzzle = { w: 30, h: 1, nums: Array.from({ length: 30 }, (_, i) => (i === 28 ? 3 : 0)) };
  expect(sgtFormat.serialize!(long)).toBe("30x1:zb3a");
  expect(sgtFormat.parse("30x1:zb3a")).toEqual(long);
  expect(() => sgtFormat.parse("3x3:a")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 10, height: 7 }, "solve");
  expect(isSolved(p, range.solve!(p)!)).toBe(true);
  expect(isSolved(p, range.init(p))).toBe(false);
});
