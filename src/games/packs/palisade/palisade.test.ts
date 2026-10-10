import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, findStep, rateByTechniques } from "../../core/techniques";
import { countSolutions, solveLevel } from "../../lib/grid-kit/csp";
import { cellName, type Focus } from "../../lib/grid-kit/names";
import {
  GAP, LINE, NONE, OPEN, WALL, analyze, divide, geometry, initialDoms, isSolved, model, palisade, sgtFormat,
  type Level, type PalisadeAction, type PalisadePuzzle,
} from "./logic";
import { checkMarks } from "./plugins";
import { palisadeTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(palisade, params, seed, sig()) as Promise<PalisadePuzzle>;
const LEVELS = ["normal", "hard"] as const;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 6, height: 5, size: 5, difficulty: "hard" }, "abc");
  const b = await gen({ width: 6, height: 5, size: 5, difficulty: "hard" }, "abc");
  const c = await gen({ width: 6, height: 5, size: 5, difficulty: "hard" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of LEVELS) {
  test(`${difficulty} puzzles are unique and need exactly ${difficulty}`, async () => {
    const want = LEVELS.indexOf(difficulty) as Level;
    for (const [i, [w, h, k]] of [[5, 5, 5], [6, 5, 5], [6, 4, 4], [8, 6, 6], [6, 6, 4], [7, 5, 5]].entries()) {
      const p = await gen({ width: w, height: h, size: k, difficulty }, `s${i}`);
      expect(solveLevel(model(p), initialDoms(p), want)).toBe(want);
      expect(countSolutions(model(p), initialDoms(p), 2).count).toBe(1);
    }
  }, 60000);
}

test("splits are into connected regions of the right size", () => {
  const rng = createRng("split");
  for (const [w, h, k] of [[5, 5, 5], [8, 6, 6], [10, 8, 8], [4, 4, 4], [9, 4, 3]] as const) {
    let region: Int32Array | null = null;
    for (let t = 0; !region && t < 50; t++) region = divide(w, h, k, rng);
    expect(region).not.toBeNull();
    const counts = new Map<number, number>();
    for (const r of region!) counts.set(r, (counts.get(r) ?? 0) + 1);
    expect([...counts.values()].every((c) => c === k)).toBe(true);
  }
});

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 600; t++) {
    const [w, h, k] = rng.pick([[3, 3, 3], [4, 3, 4], [4, 2, 4], [3, 2, 3]] as const);
    const p: PalisadePuzzle = { w, h, k, clues: Array.from({ length: w * h }, () => (rng.bool(0.5) ? rng.int(4) : -1)) };
    const brute = countSolutions(model(p), initialDoms(p), 2);
    const a = analyze(p);
    expect(a.count).toBe(brute.count as 0 | 1 | 2);
    if (a.count === 1) {
      solved++;
      const ans = palisade.solve!(p, palisade.init(p))!;
      expect("board" in ans && isSolved(p, ans.board)).toBe(true);
    }
  }
  expect(solved).toBeGreaterThan(3);
});

function played(p: PalisadePuzzle, auto: string[] = []) {
  const registry = new Registry();
  registry.puzzle(palisade);
  for (const t of palisadeTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(palisade, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("following hints solves boards of every difficulty; wrong marks come first", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 6, height: 5, size: 5, difficulty }, `h-${difficulty}`);
    const { s } = played(p);
    const sol = analyze(p).solution!;
    s.dispatch({ type: "set", edges: [0], value: sol[0] === WALL ? GAP : LINE });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "set", edges: [0], value: NONE });
    for (let i = 0; i < 400 && !s.solved; i++) {
      const hnt = s.hint();
      expect(hnt?.actions?.length).toBeGreaterThan(0);
      s.batch(() => { for (const a of hnt!.actions!) s.dispatch(a); });
    }
    expect(s.solved).toBe(true);
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  const lastOf = ["palisade.exit", "palisade.trial"];
  const level = (id: string) => palisadeTechniques.find((t) => t.id === id)!.level;
  for (const [i, difficulty] of LEVELS.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = await gen({ width: 6, height: 5, size: 5, difficulty }, `r${j}`);
      const r = rateByTechniques(palisade, palisadeTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(level(lastOf[i]!));
      if (i > 0) expect(r!.hardest.level).toBeGreaterThan(level(lastOf[i - 1]!));
    }
  }
});

test("every technique step agrees with the solution and never touches marked edges", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 6, height: 5, size: 5, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = palisade.init(p);
    st = palisade.reduce(p, st, { type: "set", edges: [3], value: sol[3] === WALL ? GAP : LINE });
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(palisade, palisadeTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as PalisadeAction[]) {
        for (const e of a.edges) {
          expect(st.marks[e]).toBe(NONE);
          expect(a.value === LINE ? WALL : OPEN).toBe(sol[e]!);
        }
      }
      st = applyStep(palisade, p, st, hit.step);
    }
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 6, height: 5, size: 5, difficulty }, `names-${difficulty}`);
    let st = palisade.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of palisadeTechniques) {
        const step = findStep(palisade, t, p, st);
        if (!step) continue;
        const all = (x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as Focus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as Focus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(palisade, palisadeTechniques, p, st);
      if (!hit) break;
      st = applyStep(palisade, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(30);
});

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 5, height: 5, size: 5, difficulty: "normal" }, "auto");
  const { s } = played(p, palisadeTechniques.slice(0, 7).map((t) => t.id));
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.marks.every((m) => m === NONE)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of palisadeTechniques) {
    const pos = await findPracticePosition(palisade, palisadeTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(palisade, palisadeTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 60000);

test("tatham ids parse and round-trip", async () => {
  const p = await gen({ width: 8, height: 6, size: 6 }, "fmt");
  expect(sgtFormat.parse(sgtFormat.serialize!(p))).toEqual(p);
  const t = sgtFormat.parse("3x2n3:a2b3");
  expect(t).toEqual({ w: 3, h: 2, k: 3, clues: [-1, 2, -1, -1, 3, -1] });
  expect(sgtFormat.serialize!(t)).toBe("3x2n3:a2b3");
  expect(() => sgtFormat.parse("3x2n4:a2b3")).toThrow();
  expect(() => sgtFormat.parse("3x2n3:a2b3c4")).toThrow();
  expect(geometry(t).edges.length).toBe(7);
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 8, height: 6, size: 6 }, "solve");
  const ans = palisade.solve!(p, palisade.init(p))!;
  expect("board" in ans && isSolved(p, ans.board)).toBe(true);
  expect(isSolved(p, palisade.init(p))).toBe(false);
});
