import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, findStep, firstStep, rateByTechniques } from "../../core/techniques";
import { cellName, type Focus } from "../../lib/grid-kit/names";
import { analyze, isSolved, puzzleLayout, rect, sgtFormat, split, type Level, type RectAction, type RectPuzzle } from "./logic";
import { checkMarks } from "./plugins";
import { countSolutions, freshAlive, levelNeeded } from "./solver";
import { rectTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(rect, params, seed, sig()) as Promise<RectPuzzle>;
const LEVELS = ["normal", "hard"] as const;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 8, height: 7, difficulty: "hard" }, "abc");
  const b = await gen({ width: 8, height: 7, difficulty: "hard" }, "abc");
  const c = await gen({ width: 8, height: 7, difficulty: "hard" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of LEVELS) {
  test(`${difficulty} puzzles are unique and need exactly ${difficulty}`, async () => {
    const want = LEVELS.indexOf(difficulty) as Level;
    for (let i = 0; i < 6; i++) {
      const p = await gen({ width: 7 + (i % 3), height: 7 + (i % 2), difficulty }, `s${i}`);
      const l = puzzleLayout(p);
      expect(levelNeeded(l, freshAlive(l), want)).toBe(want);
      expect(countSolutions(l, freshAlive(l), 2).count).toBe(1);
    }
  }, 60000);
}

test("splits cover the grid with rectangles", () => {
  const rng = createRng("split");
  for (const [w, h] of [[2, 2], [5, 4], [9, 9], [15, 11]] as const) {
    const id = split(w, h, rng);
    const cells = new Map<number, number[]>();
    id.forEach((r, c) => cells.set(r, [...(cells.get(r) ?? []), c]));
    for (const list of cells.values()) {
      const xs = list.map((c) => c % w), ys = list.map((c) => Math.floor(c / w));
      expect((Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1)).toBe(list.length);
    }
  }
});

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 300; t++) {
    const w = rng.range(2, 4), h = rng.range(2, 4);
    const id = split(w, h, rng);
    const groups = new Map<number, number[]>();
    id.forEach((r, c) => groups.set(r, [...(groups.get(r) ?? []), c]));
    const nums = Array.from({ length: w * h }, () => 0);
    for (const cells of groups.values()) nums[rng.pick(cells)] = cells.length;
    const p: RectPuzzle = { w, h, nums };
    const l = puzzleLayout(p);
    const brute = countSolutions(l, freshAlive(l), 2);
    const a = analyze(p);
    expect(a.count).toBe(brute.count as 0 | 1 | 2);
    if (a.count === 1) {
      solved++;
      const ans = rect.solve!(p, rect.init(p))!;
  expect("board" in ans && isSolved(p, ans.board)).toBe(true);
    }
  }
  expect(solved).toBeGreaterThan(20);
});

function played(p: RectPuzzle, auto: string[] = []) {
  const registry = new Registry();
  registry.puzzle(rect);
  for (const t of rectTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(rect, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("a wrong wall is cleared by the hint first; technique steps keep producing actions", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 9, height: 9, difficulty }, `h-${difficulty}`);
    const { s } = played(p);
    const sol = analyze(p).walls!;
    const bad = sol.findIndex((v) => !v);
    s.dispatch({ type: "edges", on: [bad], off: [] });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "edges", on: [], off: [bad] });
    let st = rect.init(p);
    for (let i = 0; i < 600; i++) {
      const hit = firstStep(rect, rectTechniques, p, st);
      if (!hit) break;
      expect(hit.step.actions.length).toBeGreaterThan(0);
      st = applyStep(rect, p, st, hit.step);
    }
  }
}, 60000);

test("rating by techniques matches the generator's difficulty", async () => {
  const lastOf = ["rect.only-cover", "rect.trial"];
  const level = (id: string) => rectTechniques.find((t) => t.id === id)!.level;
  for (const [i, difficulty] of LEVELS.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = await gen({ width: 8, height: 8, difficulty }, `r${j}`);
      const r = rateByTechniques(rect, rectTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(level(lastOf[i]!));
      if (i > 0) expect(r!.hardest.level).toBeGreaterThan(level(lastOf[i - 1]!));
    }
  }
}, 60000);

test("technique steps only draw walls the solution has", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 9, height: 9, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).walls!;
    let st = rect.init(p);
    for (let i = 0; i < 600; i++) {
      const hit = firstStep(rect, rectTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as RectAction[]) {
        expect(a.off).toEqual([]);
        for (const e of a.on) expect(sol[e]).toBe(1);
      }
      st = applyStep(rect, p, st, hit.step);
    }
  }
}, 60000);

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty }, `names-${difficulty}`);
    let st = rect.init(p);
    for (let i = 0; i < 300; i++) {
      for (const t of rectTechniques) {
        const step = findStep(rect, t, p, st);
        if (!step) continue;
        const all = (x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as Focus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as Focus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(rect, rectTechniques, p, st);
      if (!hit) break;
      st = applyStep(rect, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(30);
}, 60000);

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 7, height: 7, difficulty: "normal" }, "auto");
  const { s } = played(p, ["rect.edge", "rect.owned", "rect.only-cover"]);
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.walls.every((v) => v === 0)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of rectTechniques) {
    const pos = await findPracticePosition(rect, rectTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(rect, rectTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 60000);

test("tatham ids parse and round-trip", async () => {
  const p = await gen({ width: 11, height: 9 }, "fmt");
  expect(sgtFormat.parse(sgtFormat.serialize!(p))).toEqual(p);
  const t = sgtFormat.parse("3x2e0.5a:2_2b2a");
  expect(t.nums).toEqual([2, 2, 0, 0, 2, 0]);
  expect(sgtFormat.serialize!(t)).toBe("3x2:2_2b2a");
  expect(analyze(t).count).toBe(1);
  expect(() => sgtFormat.parse("3x2:2_2b2")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 10, height: 8 }, "solve");
  const ans = rect.solve!(p, rect.init(p))!;
  expect("board" in ans && isSolved(p, ans.board)).toBe(true);
  expect(isSolved(p, rect.init(p))).toBe(false);
});
