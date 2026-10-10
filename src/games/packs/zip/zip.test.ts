import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import { cellName } from "../../lib/grid-kit/names";
import type { Step } from "../../core/types";
import { gridFormat, zip, type ZipAction, type ZipFocus } from "./logic";
import { zipPlugins } from "./plugins";
import { analyze, board, countSolutions, logicSolve, walkOf, type ZipPuzzle } from "./solver";
import { zipHint, zipTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(zip, params, seed, sig()) as Promise<ZipPuzzle>;
const start = (p: ZipPuzzle) => walkOf(p, [board(p).numCell[1]!]);

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 6, height: 6, difficulty: "hard" }, "abc");
  expect(await gen({ width: 6, height: 6, difficulty: "hard" }, "abc")).toEqual(a);
  expect(await gen({ width: 6, height: 6, difficulty: "hard" }, "abd")).not.toEqual(a);
});

for (const difficulty of ["easy", "medium", "hard"] as const) {
  test(`${difficulty} puzzles are unique and need exactly their level`, async () => {
    const top = [4, 5, 6][["easy", "medium", "hard"].indexOf(difficulty)]!;
    for (let i = 0; i < 4; i++) {
      const p = await gen({ width: 5 + (i % 2), height: 6, difficulty, walls: i % 2 === 0 }, `s${i}`);
      const r = logicSolve(p, top);
      expect(r.level).toBe(top);
      expect(logicSolve(p, top - 1).level).toBeNull();
      const brute = countSolutions(p, start(p), 2);
      expect(brute.count).toBe(1);
      expect(r.path).toEqual(brute.first!);
      const ans = zip.solve!(p, zip.init(p))!;
      expect("board" in ans && zip.isSolved(p, ans.board)).toBe(true);
    }
  }, 60000);
}

test("logic never contradicts brute force on boards with clues taken away", async () => {
  let solved = 0;
  for (let t = 0; t < 30; t++) {
    const base = await gen({ width: 5, height: 5, difficulty: "easy", walls: t % 2 === 0 }, `x${t}`);
    const k = board(base).last;
    const drop = 1 + (t % (k - 2 || 1));
    const nums = base.nums.map((v) => (v === drop + 1 && v !== k ? 0 : v > drop + 1 ? v - 1 : v));
    const p: ZipPuzzle = { ...base, nums };
    const brute = countSolutions(p, start(p), 2);
    const logic = logicSolve(p, 6);
    if (logic.level !== null) {
      solved++;
      expect(brute.count).toBe(1);
      expect(logic.path).toEqual(brute.first!);
    }
  }
  expect(solved).toBeGreaterThan(5);
}, 60000);

function played(p: ZipPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of zipTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session({ ...zip, hint: zipHint }, p, { kind: "imported" });
  new TechniqueHost(registry, s);
  zipPlugins[1]!.setup!({ session: s, settings: {}, owner: "check" });
  return s;
}

test("following hints solves every difficulty; a wrong turn is pointed out first", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 6, height: 6, difficulty }, `h-${difficulty}`);
    const sol = analyze(p).solution!;
    const s = played(p);
    const wrong = board(p).nbrs[sol[0]!]!.find((c) => c !== sol[1] && !p.nums[c]);
    if (wrong !== undefined) {
      s.dispatch({ type: "extend", cells: [wrong] });
      expect(s.hint()?.actions?.[0]).toEqual({ type: "cut", length: 1 });
      s.undo();
    }
    for (let i = 0; i < 200 && !s.solved; i++) {
      const h = s.hint();
      expect(h?.actions?.length).toBeGreaterThan(0);
      s.batch(() => { for (const a of h!.actions!) s.dispatch(a); });
    }
    expect(s.solved).toBe(true);
  }
}, 60000);

test("technique steps follow the solution and every named cell is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 6, height: 6, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = zip.init(p);
    for (let i = 0; i < 100 && !zip.isSolved(p, st); i++) {
      const hit = firstStep(zip, zipTechniques, p, st);
      const fromHint = hit ? null : zipHint(p, st);
      const step = hit ? hit.step : fromHint!.more!;
      expect(step).toBeDefined();
      const next = applyStep(zip, p, st, step as Step<ZipAction>);
      expect(next.path).toEqual(sol.slice(0, next.path.length));
      const f = step.focus as ZipFocus;
      const shown = new Set([...f.cells, ...f.because, ...(f.route ?? [])].map((c) => cellName(p, c)));
      for (const n of names(step.message)) expect(shown.has(n)).toBe(true);
      st = next;
    }
    expect(zip.isSolved(p, st)).toBe(true);
    if (analyze(p).level! < 6) expect(rateByTechniques(zip, zipTechniques, p)!.hardest.level).toBe(analyze(p).level!);
  }
}, 60000);

test("auto techniques cascade inside one undo step", async () => {
  const p = await gen({ width: 5, height: 5, difficulty: "easy" }, "auto");
  const s = played(p, zipTechniques.map((t) => t.id));
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.path.length).toBe(1);
});

test("practice finds a position for every technique", async () => {
  for (const t of zipTechniques) {
    const pos = await findPracticePosition(zip, zipTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
  }
}, 60000);

test("moves: no skipping numbers, no crossing walls", () => {
  const p = gridFormat.parse("1 . 3\n. . .\n. . 2\nwalls: A1-A2");
  let s = zip.init(p);
  expect(zip.reduce(p, s, { type: "extend", cells: [3] })).toBe(s);
  s = zip.reduce(p, s, { type: "extend", cells: [1, 2] });
  expect(s.path).toEqual([0, 1]);
  s = zip.reduce(p, s, { type: "extend", cells: [4, 3, 6, 7, 8] });
  expect(s.path).toEqual([0, 1, 4, 3, 6, 7, 8]);
  expect(zip.reduce(p, s, { type: "cut", length: 2 }).path).toEqual([0, 1]);
  expect(zip.isSolved(p, zip.reduce(p, s, { type: "extend", cells: [5, 2] }))).toBe(true);
  expect(zip.describeAction!(p, { type: "cut", length: 2 }, s, { path: [0, 1] })).toBe("back to B1");
});

test("the grid format round-trips with walls", async () => {
  const p = await gen({ width: 6, height: 5, difficulty: "medium", walls: true }, "fmt");
  expect(gridFormat.parse(gridFormat.serialize!(p))).toEqual(p);
  expect(() => gridFormat.parse("1 . .\n. 3 .")).toThrow();
  expect(() => gridFormat.parse("1 . .\n. 2 .\nwalls: A1-C1")).toThrow();
});
