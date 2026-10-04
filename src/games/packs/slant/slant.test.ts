import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import { countSolutions, solveLevel } from "./kit/csp";
import { cellName, type Focus } from "./kit/names";
import {
  BACK, FWD, NONE, SLASH_BACK, SLASH_FWD, analyze, findConflicts, initialDoms, isSolved, markOf, model, sgtFormat, slant, valueOfMark,
  type Level, type SlantAction, type SlantPuzzle,
} from "./logic";
import { checkMarks } from "./plugins";
import { slantTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(slant, params, seed, sig()) as Promise<SlantPuzzle>;
const LEVELS = ["easy", "hard"] as const;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 7, height: 6, difficulty: "hard" }, "abc");
  const b = await gen({ width: 7, height: 6, difficulty: "hard" }, "abc");
  const c = await gen({ width: 7, height: 6, difficulty: "hard" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of LEVELS) {
  test(`${difficulty} puzzles are unique and need exactly ${difficulty}`, async () => {
    const want = LEVELS.indexOf(difficulty) as Level;
    for (let i = 0; i < 6; i++) {
      const p = await gen({ width: 5 + (i % 4), height: 4 + (i % 3), difficulty }, `s${i}`);
      expect(solveLevel(model(p), initialDoms(p), want)).toBe(want);
      expect(countSolutions(model(p), initialDoms(p), 2).count).toBe(1);
    }
  }, 30000);
}

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 300; t++) {
    const w = rng.range(2, 4), h = rng.range(2, 4);
    const p: SlantPuzzle = { w, h, clues: Array.from({ length: (w + 1) * (h + 1) }, () => (rng.bool(0.5) ? rng.int(3) : -1)) };
    const brute = countSolutions(model(p), initialDoms(p), 2);
    const a = analyze(p);
    expect(a.count).toBe(brute.count as 0 | 1 | 2);
    if (a.count === 1) {
      solved++;
      expect(isSolved(p, slant.solve!(p)!)).toBe(true);
    }
  }
  expect(solved).toBeGreaterThan(5);
});

test("loops are found", () => {
  // a diamond: / \ on top, \ / below closes a loop round the middle point
  const p: SlantPuzzle = { w: 2, h: 2, clues: Array.from({ length: 9 }, () => -1) };
  const marks = [SLASH_FWD, SLASH_BACK, SLASH_BACK, SLASH_FWD];
  expect(findConflicts(p, marks).loops.sort()).toEqual([0, 1, 2, 3]);
  expect(isSolved(p, { marks })).toBe(false);
  expect(countSolutions(model(p), initialDoms(p), 100).count).toBe(15);
});

function played(p: SlantPuzzle, auto: string[] = []) {
  const registry = new Registry();
  registry.puzzle(slant);
  for (const t of slantTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(slant, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("following hints solves boards of every difficulty; wrong lines come first", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty }, `h-${difficulty}`);
    const { s } = played(p);
    const sol = analyze(p).solution!;
    s.dispatch({ type: "set", cells: [0], value: markOf(sol[0] === BACK ? FWD : BACK) });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "set", cells: [0], value: NONE });
    for (let i = 0; i < 400 && !s.solved; i++) {
      const hnt = s.hint();
      expect(hnt?.actions?.length).toBeGreaterThan(0);
      s.batch(() => { for (const a of hnt!.actions!) s.dispatch(a); });
    }
    expect(s.solved).toBe(true);
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  const lastOf = ["slant.loop", "slant.trial"];
  const level = (id: string) => slantTechniques.find((t) => t.id === id)!.level;
  for (const [i, difficulty] of LEVELS.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = await gen({ width: 8, height: 8, difficulty }, `r${j}`);
      const r = rateByTechniques(slant, slantTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(level(lastOf[i]!));
      if (i > 0) expect(r!.hardest.level).toBeGreaterThan(level(lastOf[i - 1]!));
    }
  }
});

test("every technique step agrees with the solution and never touches drawn cells", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = slant.init(p);
    st = slant.reduce(p, st, { type: "set", cells: [5], value: markOf(sol[5] === BACK ? FWD : BACK) });
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(slant, slantTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as SlantAction[]) {
        for (const c of a.cells) {
          expect(st.marks[c]).toBe(NONE);
          expect(valueOfMark(a.value)).toBe(sol[c]!);
        }
      }
      st = applyStep(slant, p, st, hit.step);
    }
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty }, `names-${difficulty}`);
    let st = slant.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of slantTechniques) {
        const step = t.find(p, st);
        if (!step) continue;
        const all = (x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as Focus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as Focus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(slant, slantTechniques, p, st);
      if (!hit) break;
      st = applyStep(slant, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(50);
});

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 6, height: 6, difficulty: "easy" }, "auto");
  const { s } = played(p, ["slant.full", "slant.all", "slant.loop"]);
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.marks.every((m) => m === NONE)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of slantTechniques) {
    const pos = await findPracticePosition(slant, slantTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(slant, slantTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 30000);

test("tatham ids parse and round-trip", async () => {
  const p = await gen({ width: 12, height: 10 }, "fmt");
  expect(sgtFormat.parse(sgtFormat.serialize!(p))).toEqual(p);
  const t = sgtFormat.parse("2x2dh:a1b40c");
  expect(t.clues).toEqual([-1, 1, -1, -1, 4, 0, -1, -1, -1]);
  expect(sgtFormat.serialize!(t)).toBe("2x2:a1b40c");
  expect(() => sgtFormat.parse("2x2:a1b40")).toThrow();
  expect(() => sgtFormat.parse("2x2:a1b50c")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 10, height: 7 }, "solve");
  expect(isSolved(p, slant.solve!(p)!)).toBe(true);
  expect(isSolved(p, slant.init(p))).toBe(false);
});
