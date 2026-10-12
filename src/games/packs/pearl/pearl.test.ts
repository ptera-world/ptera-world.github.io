import { expect, test } from "bun:test";
import type { AnyPuzzleDef, Step, Technique } from "../../core/types";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, findStep, firstStep, rateByTechniques, stepsAt } from "../../core/techniques";
import { LINE, edgeGrid } from "../../lib/edges";
import { CROSS, NONE, cellName, gridFormat, pearl, sgtFormat, type PearlAction, type PearlFocus } from "./logic";
import { checkMarks } from "./plugins";
import { BLACK, EMPTY, WHITE, analyze, countSolutions, freshKnowledge, logicSolve, loopEdges, pearlsFor, randomLoop, type Level, type PearlPuzzle } from "./solver";
import { pearlTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(pearl, params, seed, sig()) as Promise<PearlPuzzle>;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 7, height: 7, difficulty: "hard" }, "abc");
  const b = await gen({ width: 7, height: 7, difficulty: "hard" }, "abc");
  const c = await gen({ width: 7, height: 7, difficulty: "hard" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

test("random loops are single loops that never touch themselves", () => {
  for (let i = 0; i < 20; i++) {
    const w = 5 + (i % 6), h = 5 + (i % 4);
    const loop = randomLoop(w, h, createRng(`l${i}`));
    const p: PearlPuzzle = { w, h, pearls: Array.from({ length: w * h }, () => EMPTY) };
    expect(pearl.isSolved(p, { edges: loop.map((v) => (v ? LINE : NONE)) })).toBe(true);
    const pearls = pearlsFor(w, h, loop);
    expect(pearls.some((v) => v === BLACK) || pearls.some((v) => v === WHITE)).toBe(true);
    expect(pearl.isSolved({ w, h, pearls }, { edges: loop.map((v) => (v ? LINE : NONE)) })).toBe(true);
  }
});

for (const difficulty of ["easy", "hard"] as const) {
  test(`${difficulty} puzzles are unique, logic-solvable, and need exactly ${difficulty}`, async () => {
    const want = ["easy", "hard"].indexOf(difficulty) as Level;
    for (let i = 0; i < 6; i++) {
      const p = await gen({ width: 6 + (i % 2), height: 6 + (i % 3), difficulty }, `s${i}`);
      expect(logicSolve(p, want).level).toBe(want);
      if (want > 0) expect(logicSolve(p, 0).level).toBeNull();
      const brute = countSolutions(p, freshKnowledge(edgeGrid(p.w, p.h)), 2);
      expect(brute.count).toBe(1);
      expect(analyze(p).solution).toEqual(loopEdges(brute.first!));
    }
  }, 30000);
}

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 150; t++) {
    const w = rng.range(3, 5), h = rng.range(3, 5);
    const pearls = Array.from({ length: w * h }, () => (rng.bool(0.3) ? rng.pick([BLACK, WHITE]) : EMPTY));
    const p: PearlPuzzle = { w, h, pearls };
    const brute = countSolutions(p, freshKnowledge(edgeGrid(w, h)), 2);
    const logic = logicSolve(p, 1);
    if (logic.level !== null) {
      solved++;
      expect(brute.count).toBe(1);
      expect(loopEdges(logic.k)).toEqual(loopEdges(brute.first!));
    }
    if (!logic.ok) expect(brute.count).toBe(0);
  }
  expect(solved).toBeGreaterThan(2);
});

function played(p: PearlPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of pearlTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(pearl, p, { kind: "imported" });
  new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return s;
}

test("wrong marks come first; technique steps apply", async () => {
  for (const difficulty of ["easy", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `h-${difficulty}`);
    const s = played(p);
    const bad = analyze(p).solution!.findIndex((v) => v === 1);
    s.dispatch({ type: "set", edges: [bad], value: CROSS });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "set", edges: [bad], value: NONE });
    s.dispatch({ type: "set", edges: [bad], value: NONE });
    for (let i = 0; i < 400 && !s.solved; i++) {
      const hit = firstStep(pearl, pearlTechniques, p, s.state);
      if (!hit) break;
      s.batch(() => { for (const a of hit.step.actions) s.dispatch(a as PearlAction); });
    }
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  for (const difficulty of ["easy", "hard"] as const) {
    for (let i = 0; i < 3; i++) {
      const p = await gen({ width: 7, height: 7, difficulty }, `r${i}`);
      const r = rateByTechniques(pearl, pearlTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.id === "pearl.trial").toBe(difficulty === "hard");
    }
  }
});

test("technique steps agree with the solution and never overwrite marks", async () => {
  for (const difficulty of ["easy", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = pearl.init(p);
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(pearl, pearlTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as PearlAction[]) {
        for (const e of a.edges) {
          expect(st.edges[e]).toBe(NONE);
          expect(a.value === LINE ? 1 : 0).toBe(sol[e]!);
        }
      }
      st = applyStep(pearl, p, st, hit.step);
    }
    expect(pearl.isSolved(p, st)).toBe(true);
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of ["easy", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `names-${difficulty}`);
    const g = edgeGrid(p.w, p.h);
    let st = pearl.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of pearlTechniques) {
        const step = findStep(pearl, t, p, st);
        if (!step) continue;
        const all = (f: PearlFocus) => new Set([...f.because, ...f.edges.flatMap((e) => [g.ea[e]!, g.eb[e]!])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as PearlFocus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(pearl, pearlTechniques, p, st);
      if (!hit) break;
      st = applyStep(pearl, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(30);
});

test("auto techniques cascade inside one undo step", async () => {
  const p = await gen({ width: 6, height: 6, difficulty: "easy" }, "auto");
  const s = played(p, pearlTechniques.filter((t) => t.id !== "pearl.trial").map((t) => t.id));
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.edges.every((v) => v === NONE)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of pearlTechniques) {
    const pos = await findPracticePosition(pearl, pearlTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(pearl, pearlTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 60000);

test("formats round-trip; game ids parse like the original", async () => {
  const p = await gen({ width: 8, height: 7 }, "fmt");
  for (const f of [sgtFormat, gridFormat]) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(p);
  }
  expect(sgtFormat.parse(sgtFormat.serialize!(p).replace(":", "de:"))).toEqual(p);
  expect(sgtFormat.parse("3x2:aBcW").pearls).toEqual([EMPTY, BLACK, EMPTY, EMPTY, EMPTY, WHITE]);
  expect(() => sgtFormat.parse("3x2:aBcWa")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 6, height: 6 }, "solve");
  const ans = pearl.solve!(p, pearl.init(p))!;
  expect("board" in ans && pearl.isSolved(p, ans.board)).toBe(true);
  expect(pearl.isSolved(p, pearl.init(p))).toBe(false);
});

/** Leaf values that differ from `a` in `b`, keyed by JSON path. */
function leafDiff(a: unknown, b: unknown, path = "", out = new Map<string, string>()): Map<string, string> {
  if (Object.is(a, b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) leafDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`, out);
    return out;
  }
  const v = JSON.stringify(b);
  if (JSON.stringify(a) !== v) out.set(path, v ?? "undefined");
  return out;
}

/**
 * findAt is instancesAt's first step, every instance at a target changes the board, and cellAt
 * changes part of what one of them does. Returns how many targets cellAt found something at.
 */
function checkAimed(def: AnyPuzzleDef, list: readonly Technique[], p: unknown, s: unknown, targets: readonly unknown[]): number {
  let cells = 0;
  for (const t of list) {
    if (!t.findAt && !t.cellAt) continue;
    for (const target of targets) {
      const all: Step[] = [];
      if (t.instancesAt) t.instancesAt(p, s, target, (st) => { all.push(st); });
      else all.push(...stepsAt(def, t, p, s, target));
      if (t.findAt) expect(t.findAt(p, s, target)).toEqual(all[0] ?? null);
      const diffs = all.map((st) => leafDiff(s, applyStep(def, p, s, st)));
      for (const d of diffs) expect(d.size).toBeGreaterThan(0);
      const cell = t.cellAt?.(p, s, target);
      if (!cell) continue;
      const d = leafDiff(s, applyStep(def, p, s, cell));
      expect(d.size > 0 && diffs.some((x) => [...d].every(([k, v]) => x.get(k) === v))).toBe(true);
      cells++;
    }
  }
  return cells;
}

test("aimed finds: findAt is instancesAt's first, each instance changes the board, cellAt is part of one", async () => {
  let cells = 0;
  for (const t of pearlTechniques) {
    if (t.practice === false) continue;
    const pos = await findPracticePosition(pearl, pearlTechniques, t, "aim", new AbortController().signal);
    if (!pos) continue;
    const p = pos.puzzle as any, s = pos.state as any;
    cells += checkAimed(pearl, pearlTechniques, p, s, Array.from({ length: p.w * p.h }, (_, i) => ({ cell: i })));
  }
  expect(cells).toBeGreaterThan(0);
}, 300000);
