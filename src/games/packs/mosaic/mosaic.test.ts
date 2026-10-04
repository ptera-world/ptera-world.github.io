import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import { countSolutions, solveLevel } from "./kit/csp";
import { cellName, type Focus } from "./kit/names";
import {
  BLACK, DOT, NONE, SHADED, analyze, blocks, initialDoms, isSolved, model, mosaic, sgtFormat,
  type Level, type MosaicAction, type MosaicPuzzle,
} from "./logic";
import { checkMarks } from "./plugins";
import { mosaicTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(mosaic, params, seed, sig()) as Promise<MosaicPuzzle>;
const LEVELS = ["easy", "medium", "hard"] as const;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 9, height: 7, difficulty: "medium" }, "abc");
  const b = await gen({ width: 9, height: 7, difficulty: "medium" }, "abc");
  const c = await gen({ width: 9, height: 7, difficulty: "medium" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of LEVELS) {
  test(`${difficulty} puzzles are unique and need exactly ${difficulty}`, async () => {
    const want = LEVELS.indexOf(difficulty) as Level;
    for (let i = 0; i < 6; i++) {
      const p = await gen({ width: 7 + (i % 4), height: 6 + (i % 3), difficulty }, `s${i}`);
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
    const image = Array.from({ length: w * h }, () => (rng.bool() ? 1 : 0));
    const clues = blocks(w, h).map((cells) => (rng.bool(0.6) ? cells.reduce((s, d) => s + image[d]!, 0) + (rng.bool(0.1) ? 1 : 0) : -1));
    const p: MosaicPuzzle = { w, h, clues };
    const brute = countSolutions(model(p), initialDoms(p), 2);
    const a = analyze(p);
    expect(a.count).toBe(brute.count as 0 | 1 | 2);
    if (a.count === 1) {
      solved++;
      expect(isSolved(p, mosaic.solve!(p)!)).toBe(true);
    }
  }
  expect(solved).toBeGreaterThan(5);
});

function played(p: MosaicPuzzle, auto: string[] = []) {
  const registry = new Registry();
  registry.puzzle(mosaic);
  for (const t of mosaicTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(mosaic, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("following hints solves boards of every difficulty; wrong marks come first", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 9, height: 8, difficulty }, `h-${difficulty}`);
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
  const lastOf = ["mosaic.full", "mosaic.pair", "mosaic.trial"];
  const level = (id: string) => mosaicTechniques.find((t) => t.id === id)!.level;
  for (const [i, difficulty] of LEVELS.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = await gen({ width: 9, height: 8, difficulty }, `r${j}`);
      const r = rateByTechniques(mosaic, mosaicTechniques, p);
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
    let st = mosaic.init(p);
    const wrong = sol.findIndex((v) => v === SHADED);
    st = mosaic.reduce(p, st, { type: "set", cells: [wrong], value: DOT });
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(mosaic, mosaicTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as MosaicAction[]) {
        for (const c of a.cells) {
          expect(st.marks[c]).toBe(NONE);
          expect(a.value === BLACK ? SHADED : 0).toBe(sol[c]!);
        }
      }
      st = applyStep(mosaic, p, st, hit.step);
    }
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 9, height: 8, difficulty }, `names-${difficulty}`);
    let st = mosaic.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of mosaicTechniques) {
        const step = t.find(p, st);
        if (!step) continue;
        const all = (x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as Focus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as Focus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(mosaic, mosaicTechniques, p, st);
      if (!hit) break;
      st = applyStep(mosaic, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(50);
});

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 8, height: 8, difficulty: "easy" }, "auto");
  const { s } = played(p, ["mosaic.done", "mosaic.full"]);
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.marks.every((m) => m === NONE)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of mosaicTechniques) {
    const pos = await findPracticePosition(mosaic, mosaicTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(mosaic, mosaicTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 30000);

test("tatham ids parse and round-trip", async () => {
  const p = await gen({ width: 12, height: 8 }, "fmt");
  expect(sgtFormat.parse(sgtFormat.serialize!(p))).toEqual(p);
  const t = sgtFormat.parse("3x3h0:a4b30c");
  expect(t.clues).toEqual([-1, 4, -1, -1, 3, 0, -1, -1, -1]);
  expect(sgtFormat.serialize!(t)).toBe("3x3:a4b30c");
  const long: MosaicPuzzle = { w: 30, h: 1, clues: Array.from({ length: 30 }, (_, i) => (i === 28 ? 2 : -1)) };
  expect(sgtFormat.serialize!(long)).toBe("30x1:zb2a");
  expect(sgtFormat.parse("30x1:zb2a")).toEqual(long);
  expect(() => sgtFormat.parse("3x3:a")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 10, height: 7 }, "solve");
  expect(isSolved(p, mosaic.solve!(p)!)).toBe(true);
  expect(isSolved(p, mosaic.init(p))).toBe(false);
});
