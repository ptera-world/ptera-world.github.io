import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import { bit, countSolutions, solveLevel } from "../../lib/grid-kit/csp";
import { cellName, type Focus } from "../../lib/grid-kit/names";
import {
  analyze, filling, geometry, groups, initialDoms, isSolved, makeBoard, maxNumber, model, sgtFormat,
  type FillingAction, type FillingPuzzle, type Level,
} from "./logic";
import { checkMarks } from "./plugins";
import { fillingTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(filling, params, seed, sig()) as Promise<FillingPuzzle>;
const LEVELS = ["easy", "medium", "hard"] as const;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 7, height: 6, difficulty: "medium" }, "abc");
  const b = await gen({ width: 7, height: 6, difficulty: "medium" }, "abc");
  const c = await gen({ width: 7, height: 6, difficulty: "medium" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of LEVELS) {
  test(`${difficulty} puzzles are unique and need exactly ${difficulty}`, async () => {
    const want = LEVELS.indexOf(difficulty) as Level;
    for (let i = 0; i < 5; i++) {
      const p = await gen({ width: 5 + (i % 3), height: 5 + (i % 2), difficulty }, `s${i}`);
      expect(solveLevel(model(p), initialDoms(p), want)).toBe(want);
      expect(countSolutions(model(p), initialDoms(p), 2).count).toBe(1);
    }
  }, 60000);
}

test("random boards are legal fillings", () => {
  const rng = createRng("boards");
  for (const [w, h] of [[2, 2], [5, 4], [9, 7], [13, 9]] as const) {
    let board: number[] | null = null;
    for (let t = 0; !board && t < 20; t++) board = makeBoard(w, h, rng);
    expect(board).not.toBeNull();
    expect(board!.every((v) => v >= 1 && v <= maxNumber(w, h))).toBe(true);
    const g = geometry({ w, h, clues: [] });
    expect(groups(g, (c) => board![c]!).list.every((gr) => gr.cells.length === gr.value)).toBe(true);
  }
});

test("nikoli's sample solves to its published answer", () => {
  const p = sgtFormat.parse("7x7:6002002030603030000010230420200000305010404003003");
  const a = analyze(p);
  expect(a.count).toBe(1);
  expect(a.solution!.join("")).toBe("6662232336663232331311235422255544325413434443313");
});

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 200; t++) {
    const w = rng.range(2, 4), h = rng.range(2, 4);
    const top = maxNumber(w, h);
    const p: FillingPuzzle = { w, h, clues: Array.from({ length: w * h }, () => (rng.bool(0.4) ? rng.range(1, top) : 0)) };
    const brute = countSolutions(model(p), initialDoms(p), 2);
    const a = analyze(p);
    expect(a.count).toBe(brute.count as 0 | 1 | 2);
    if (a.count === 1) {
      solved++;
      expect(isSolved(p, filling.solve!(p)!)).toBe(true);
    }
  }
  expect(solved).toBeGreaterThan(5);
});

function played(p: FillingPuzzle, auto: string[] = []) {
  const registry = new Registry();
  registry.puzzle(filling);
  for (const t of fillingTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(filling, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("following hints solves boards of every difficulty; wrong numbers come first", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 7, height: 6, difficulty }, `h-${difficulty}`);
    const { s } = played(p);
    const sol = analyze(p).solution!;
    const bad = p.clues.findIndex((v) => v === 0);
    const wrong = sol[bad] === 1 ? 2 : 1;
    s.dispatch({ type: "set", cells: [bad], mask: bit(wrong) });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "clear", cells: [bad] });
    for (let i = 0; i < 600 && !s.solved; i++) {
      const hnt = s.hint();
      expect(hnt?.actions?.length).toBeGreaterThan(0);
      s.batch(() => { for (const a of hnt!.actions!) s.dispatch(a); });
    }
    expect(s.solved).toBe(true);
  }
}, 60000);

test("rating by techniques matches the generator's difficulty", async () => {
  const lastOf = ["filling.no-room", "filling.critical", "filling.trial"];
  const level = (id: string) => fillingTechniques.find((t) => t.id === id)!.level;
  for (const [i, difficulty] of LEVELS.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = await gen({ width: 7, height: 6, difficulty }, `r${j}`);
      const r = rateByTechniques(filling, fillingTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(level(lastOf[i]!));
      if (i > 0) expect(r!.hardest.level).toBeGreaterThan(level(lastOf[i - 1]!));
    }
  }
}, 60000);

test("every technique step keeps the solution", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 7, height: 6, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = filling.init(p);
    const wrongCell = p.clues.findIndex((v) => v === 0);
    st = filling.reduce(p, st, { type: "set", cells: [wrongCell], mask: bit(sol[wrongCell] === 1 ? 2 : 1) });
    for (let i = 0; i < 600; i++) {
      const hit = firstStep(filling, fillingTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as FillingAction[]) {
        expect(a.type).toBe("narrow");
        for (const c of a.cells) {
          expect(c).not.toBe(wrongCell);
          if (a.type === "narrow") expect(a.keep & bit(sol[c]!)).toBeTruthy();
        }
      }
      st = applyStep(filling, p, st, hit.step);
    }
  }
}, 60000);

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 7, height: 6, difficulty }, `names-${difficulty}`);
    let st = filling.init(p);
    for (let i = 0; i < 300; i++) {
      for (const t of fillingTechniques) {
        const step = t.find(p, st);
        if (!step) continue;
        const all = (x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as Focus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as Focus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(filling, fillingTechniques, p, st);
      if (!hit) break;
      st = applyStep(filling, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(50);
}, 60000);

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 6, height: 5, difficulty: "easy" }, "auto");
  const { s } = played(p, fillingTechniques.slice(0, 4).map((t) => t.id));
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.doms).toEqual(filling.init(p).doms);
});

test("practice finds a position for every technique", async () => {
  for (const t of fillingTechniques) {
    const pos = await findPracticePosition(filling, fillingTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(filling, fillingTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 60000);

test("tatham ids parse and round-trip", async () => {
  const p = await gen({ width: 9, height: 7 }, "fmt");
  expect(sgtFormat.parse(sgtFormat.serialize!(p))).toEqual(p);
  const t = sgtFormat.parse("3x3:a2b3d");
  expect(t.clues).toEqual([0, 2, 0, 0, 3, 0, 0, 0, 0]);
  expect(sgtFormat.serialize!(t)).toBe("3x3:a2b3d");
  expect(() => sgtFormat.parse("3x3:a4b3d")).toThrow();
  expect(() => sgtFormat.parse("3x3:a2b3")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 8, height: 6 }, "solve");
  expect(isSolved(p, filling.solve!(p)!)).toBe(true);
  expect(isSolved(p, filling.init(p))).toBe(false);
});
