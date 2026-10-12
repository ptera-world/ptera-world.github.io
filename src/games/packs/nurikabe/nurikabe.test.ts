import { expect, test } from "bun:test";
import { work } from "../../lib/work";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, findStep, rateByTechniques } from "../../core/techniques";
import { countSolutions, solveLevel } from "../../lib/grid-kit/csp";
import { cellName, type Focus } from "../../lib/grid-kit/names";
import { BLACK, DOT, NONE, SHADED, type ShadeAction } from "../../lib/shade-kit/state";
import {
  analyze, findConflicts, initialDoms, isSolved, model, nurikabe, pzprFormat, textFormat,
  type Level, type NurikabePuzzle,
} from "./logic";
import { checkMarks } from "./plugins";
import { nurikabeTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(nurikabe, params, seed, sig()) as Promise<NurikabePuzzle>;
const LEVELS = ["easy", "normal", "hard"] as const;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 7, height: 7, difficulty: "normal" }, "abc");
  const b = await gen({ width: 7, height: 7, difficulty: "normal" }, "abc");
  const c = await gen({ width: 7, height: 7, difficulty: "normal" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of LEVELS) {
  test(`${difficulty} puzzles are unique and need exactly ${difficulty}`, async () => {
    const want = LEVELS.indexOf(difficulty) as Level;
    for (let i = 0; i < 6; i++) {
      const p = await gen({ width: 6 + (i % 3), height: 6 + (i % 2), difficulty }, `s${i}`);
      expect(solveLevel(model(p), initialDoms(p), want)).toBe(want);
      expect(countSolutions(model(p), initialDoms(p), 2).count).toBe(1);
    }
  }, 30000);
}

test("every preset generates within its work budget", async () => {
  for (const preset of nurikabe.presets!) {
    const before = work.units;
    const p = await gen(preset.params, `preset-${preset.label}`);
    expect(analyze(p).count).toBe(1);
    expect(work.units - before).toBeLessThan(700_000);
  }
}, 60000);

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 150; t++) {
    const w = rng.range(3, 4), h = rng.range(3, 4);
    const p: NurikabePuzzle = { w, h, nums: Array.from({ length: w * h }, () => (rng.bool(0.25) ? rng.range(1, 4) : 0)) };
    // the bare rules (2×2 blocks, then the full check on each finished board) as the reference
    const brute = countSolutions({ ...model(p), rules: [], countLevel: 0 }, initialDoms(p), 2);
    const a = analyze(p);
    expect(a.count).toBe(brute.count as 0 | 1 | 2);
    if (a.count === 1) {
      solved++;
      const ans = nurikabe.solve!(p, nurikabe.init(p))!;
      expect("board" in ans && isSolved(p, ans.board)).toBe(true);
    }
  }
  expect(solved).toBeGreaterThan(5);
}, 60000);

function played(p: NurikabePuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of nurikabeTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(nurikabe, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("a wrong mark is cleared by the hint first; technique steps keep producing actions", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty }, `h-${difficulty}`);
    const { s } = played(p);
    const sol = analyze(p).solution!;
    const bad = sol.findIndex((v, c) => v !== SHADED && p.nums[c] === 0);
    s.dispatch({ type: "set", cells: [bad], value: BLACK });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "set", cells: [bad], value: NONE });
    let st = nurikabe.init(p);
    for (let i = 0; i < 600; i++) {
      const hit = firstStep(nurikabe, nurikabeTechniques, p, st);
      if (!hit) break;
      expect(hit.step.actions.length).toBeGreaterThan(0);
      st = applyStep(nurikabe, p, st, hit.step);
    }
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  const lastOf = ["nurikabe.sea-grow", "nurikabe.sea-split", "nurikabe.trial"];
  const level = (id: string) => nurikabeTechniques.find((t) => t.id === id)!.level;
  for (const [i, difficulty] of LEVELS.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = await gen({ width: 8, height: 8, difficulty }, `r${j}`);
      const r = rateByTechniques(nurikabe, nurikabeTechniques, p);
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
    let st = nurikabe.init(p);
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(nurikabe, nurikabeTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as ShadeAction[]) {
        for (const c of a.cells) {
          expect(st.marks[c]).toBe(NONE);
          expect(a.value === BLACK ? SHADED : 0).toBe(sol[c]!);
        }
      }
      st = applyStep(nurikabe, p, st, hit.step);
    }
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty }, `names-${difficulty}`);
    let st = nurikabe.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of nurikabeTechniques) {
        const step = findStep(nurikabe, t, p, st);
        if (!step) continue;
        const all = (x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as Focus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as Focus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(nurikabe, nurikabeTechniques, p, st);
      if (!hit) break;
      st = applyStep(nurikabe, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(50);
});

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 7, height: 7, difficulty: "easy" }, "auto");
  const { s } = played(p, nurikabeTechniques.slice(0, 6).map((t) => t.id));
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.marks.every((m) => m === NONE)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of nurikabeTechniques) {
    const pos = await findPracticePosition(nurikabe, nurikabeTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(nurikabe, nurikabeTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 60000);

test("conflicts flag pools, cut-off sea, broken islands, and numbers that can't fit", () => {
  // 3×3 with a 2 top-left and a 1 bottom-right
  const p: NurikabePuzzle = { w: 3, h: 3, nums: [2, 0, 0, 0, 0, 0, 0, 0, 1] };
  const marks = Array.from({ length: 9 }, () => NONE);
  for (const c of [1, 2, 4, 5]) marks[c] = BLACK;
  expect(findConflicts(p, marks).pools).toEqual([1, 2, 4, 5]);
  const walled = Array.from({ length: 9 }, () => NONE);
  walled[1] = walled[3] = BLACK;
  expect(findConflicts(p, walled).clues).toEqual([0]);
  const big = Array.from({ length: 9 }, () => NONE);
  big[1] = big[2] = DOT;
  expect(findConflicts(p, big).islands).toEqual([0, 1, 2]);
  const cut = Array.from({ length: 9 }, () => NONE);
  cut[1] = BLACK;
  cut[2] = cut[4] = DOT;
  cut[6] = cut[7] = BLACK;
  cut[3] = DOT;
  expect(findConflicts(p, cut).sea).toEqual([1]);
});

test("puzz.link URLs and the text format round-trip", async () => {
  const p = await gen({ width: 8, height: 7 }, "fmt");
  expect(pzprFormat.parse(pzprFormat.serialize!(p))).toEqual(p);
  expect(textFormat.parse(textFormat.serialize!(p))).toEqual(p);
  expect(pzprFormat.detect!(pzprFormat.serialize!(p))).toBe(true);
  expect(textFormat.detect!(textFormat.serialize!(p))).toBe(true);
  expect(() => pzprFormat.parse("https://puzz.link/p?nurikabe/4/4/0")).toThrow();
  expect(pzprFormat.parse("https://puzz.link/p?nurikabe/3/2/2j1").nums).toEqual([2, 0, 0, 0, 0, 1]);
  expect(textFormat.parse("2..\n..1").nums).toEqual([2, 0, 0, 0, 0, 1]);
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 8, height: 8 }, "solve");
  const ans = nurikabe.solve!(p, nurikabe.init(p))!;
  expect("board" in ans && isSolved(p, ans.board)).toBe(true);
  expect(isSolved(p, nurikabe.init(p))).toBe(false);
});
