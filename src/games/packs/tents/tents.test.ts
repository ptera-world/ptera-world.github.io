import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, findStep, rateByTechniques } from "../../core/techniques";
import { countSolutions, solveLevel } from "../../lib/grid-kit/csp";
import { cellName, type Focus } from "../../lib/grid-kit/names";
import {
  GRASS_HINT, NONE, OPEN, TENT, TENT_HINT, TREE, YES, analyze, geometry, initialDoms, isSolved, matchable, matchings, model, sgtFormat, tents,
  type Level, type TentsAction, type TentsPuzzle,
} from "./logic";
import { checkMarks } from "./plugins";
import { noTree, tentsTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(tents, params, seed, sig()) as Promise<TentsPuzzle>;
const LEVELS = ["easy", "tricky", "hard"] as const;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 9, height: 7, difficulty: "tricky" }, "abc");
  const b = await gen({ width: 9, height: 7, difficulty: "tricky" }, "abc");
  const c = await gen({ width: 9, height: 7, difficulty: "tricky" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of LEVELS) {
  test(`${difficulty} puzzles have one placement, one pairing, and need exactly ${difficulty}`, async () => {
    const want = LEVELS.indexOf(difficulty) as Level;
    for (let i = 0; i < 6; i++) {
      const p = await gen({ width: 10 + (i % 3), height: 10 + (i % 2), difficulty }, `s${i}`);
      expect(solveLevel(model(p), initialDoms(p), want)).toBe(want);
      const brute = countSolutions(model(p), initialDoms(p), 2);
      expect(brute.count).toBe(1);
      const placed = Array.from(brute.first!, (m, c) => (m === 2 ? c : -1)).filter((c) => c >= 0);
      expect(matchings(geometry(p), placed)).toBe(1);
    }
  }, 30000);
}

test("pairing check follows hall's condition", () => {
  // two trees side by side above one shared cell and one private cell
  const p: TentsPuzzle = { w: 3, h: 2, cells: [TREE, TREE, OPEN, OPEN, OPEN, OPEN], cols: [0, 0, 0], rows: [0, 0] };
  const g = geometry(p);
  expect(matchable(g, [3, 4], [])).toBe(true);
  expect(matchable(g, [4], [])).toBe(false);
  expect(matchable(g, [4], [2])).toBe(false);
  expect(matchable(g, [3], [2])).toBe(true);
  expect(matchings(g, [3, 4])).toBe(1);
  expect(matchings(g, [3, 2])).toBe(1);
  expect(matchings(g, [2, 4])).toBe(0);
});

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 800; t++) {
    const w = rng.range(3, 5), h = rng.range(3, 5);
    const cells = Array.from({ length: w * h }, () => (rng.bool(0.2) ? TREE : OPEN));
    const p: TentsPuzzle = { w, h, cells, cols: Array.from({ length: w }, () => rng.int(2)), rows: Array.from({ length: h }, () => rng.int(2)) };
    const brute = countSolutions(model(p), initialDoms(p), 2);
    const a = analyze(p);
    expect(a.count).toBe(brute.count as 0 | 1 | 2);
    if (a.count === 1) {
      solved++;
      const ans = tents.solve!(p, tents.init(p))!;
      expect("board" in ans && isSolved(p, ans.board)).toBe(true);
    }
  }
  expect(solved).toBeGreaterThan(3);
});

function played(p: TentsPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of tentsTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(tents, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("a wrong mark is cleared by the hint first, then technique steps apply", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 10, height: 10, difficulty }, `h-${difficulty}`);
    const { s } = played(p);
    const sol = analyze(p).solution!;
    const bad = p.cells.findIndex((v, c) => v !== TREE && sol[c] !== YES);
    s.dispatch({ type: "set", cells: [bad], value: TENT });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "set", cells: [bad], value: NONE });
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(tents, tentsTechniques, p, s.state);
      if (!hit) break;
      s.batch(() => { for (const a of hit.step.actions as TentsAction[]) s.dispatch(a); });
    }
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  const lastOf = ["tents.tree-spot", "tents.matching", "tents.trial"];
  const level = (id: string) => tentsTechniques.find((t) => t.id === id)!.level;
  for (const [i, difficulty] of LEVELS.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = await gen({ width: 10, height: 10, difficulty }, `r${j}`);
      const r = rateByTechniques(tents, tentsTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(level(lastOf[i]!));
      if (i > 0) expect(r!.hardest.level).toBeGreaterThan(level(lastOf[i - 1]!));
    }
  }
});

test("every technique step agrees with the solution and never touches marked cells", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 10, height: 10, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = tents.init(p);
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(tents, tentsTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as TentsAction[]) {
        for (const c of a.cells) {
          expect(st.marks[c]).toBe(NONE);
          expect(a.value === TENT ? YES : 0).toBe(sol[c]!);
        }
      }
      st = applyStep(tents, p, st, hit.step);
    }
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 10, height: 10, difficulty }, `names-${difficulty}`);
    let st = tents.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of tentsTechniques) {
        const step = findStep(tents, t, p, st);
        if (!step) continue;
        const all = (x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as Focus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as Focus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(tents, tentsTechniques, p, st);
      if (!hit) break;
      st = applyStep(tents, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(50);
});

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 8, height: 8, difficulty: "easy" }, "auto");
  const { s } = played(p, tentsTechniques.slice(0, 5).map((t) => t.id));
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.marks.every((m) => m === NONE)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of tentsTechniques) {
    const pos = await findPracticePosition(tents, tentsTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(tents, tentsTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 30000);

test("tatham ids parse and round-trip, starting marks included", async () => {
  const p = await gen({ width: 12, height: 9 }, "fmt");
  expect(sgtFormat.parse(sgtFormat.serialize!(p))).toEqual(p);
  const t = sgtFormat.parse("4x4:ahe,1,0,0,1,1,0,1,0");
  expect(t.cells.flatMap((v, i) => (v === TREE ? [i] : []))).toEqual([1, 10]);
  expect(t.cols).toEqual([1, 0, 0, 1]);
  expect(t.rows).toEqual([1, 0, 1, 0]);
  // a mark rewrites the cell the run just reached
  const m = sgtFormat.parse("4x4:a!h-e,1,0,0,1,1,0,1,0");
  expect(m.cells[1]).toBe(TENT_HINT);
  expect(m.cells[10]).toBe(GRASS_HINT);
  expect(sgtFormat.parse(sgtFormat.serialize!(m))).toEqual(m);
  expect(tents.init(m).marks[1]).toBe(TENT);
  const long: TentsPuzzle = { w: 30, h: 1, cells: Array.from({ length: 30 }, (_, i) => (i === 28 ? TREE : OPEN)), cols: Array(30).fill(0), rows: [1] };
  expect(sgtFormat.serialize!(long).split(",")[0]).toBe("30x1:zca");
  expect(sgtFormat.parse(sgtFormat.serialize!(long))).toEqual(long);
  expect(() => sgtFormat.parse("4x4:ah,1,0,0,1,1,0,1,0")).toThrow();
  expect(() => sgtFormat.parse("4x4:ahe,1,0,0,1,1,0,1")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 10, height: 8 }, "solve");
  const ans = tents.solve!(p, tents.init(p))!;
  expect("board" in ans && isSolved(p, ans.board)).toBe(true);
  expect(isSolved(p, tents.init(p))).toBe(false);
});

test("no-tree aimed at a cell changes only that cell", async () => {
  const p = await gen({ width: 8, height: 8, difficulty: "easy" }, "aim-unit");
  const st = tents.init(p);
  let whole = 0;
  noTree.instances(p, st, (step) => { whole = Math.max(whole, step.actions.flatMap((a) => (a as { cells: number[] }).cells).length); });
  expect(whole).toBeGreaterThan(1);
  let aimed = 0;
  for (let c = 0; c < p.w * p.h; c++) {
    const step = noTree.findAt!(p, st, c);
    if (!step) continue;
    expect(step.actions.flatMap((a) => (a as { cells: number[] }).cells)).toEqual([c]);
    aimed++;
  }
  expect(aimed).toBeGreaterThan(1);
});
