import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { info, pattern, type PatternAction, type PatternPuzzle } from "./logic";
import { Registry } from "../../core/registry";
import { TechniqueHost, applyStep, findPracticePosition, firstStep } from "../../core/techniques";
import { doneNumbers, patternPlugins } from "./plugins";
import { LINE_RULES, ruleOnLine } from "./rules";
import {
  CAN_EMPTY, CAN_FILL, EMPTY, FILLED, UNKNOWN, analyze, cluesOf, countArrangements, countSolutions, extremes, randomPicture, solveLine,
} from "./solver";
import { finishedLine, patternTechniques } from "./techniques";

const sig = () => new AbortController().signal;

function bruteLine(clue: number[], line: number[]): Uint8Array | null {
  const n = line.length;
  const out = new Uint8Array(n);
  let any = false;
  for (let m = 0; m < 1 << n; m++) {
    const vals = Array.from({ length: n }, (_, i) => ((m >> i) & 1 ? FILLED : EMPTY));
    if (vals.some((v, i) => line[i] !== UNKNOWN && line[i] !== v)) continue;
    const r: number[] = [];
    let k = 0;
    for (const v of [...vals, EMPTY]) {
      if (v === FILLED) k++;
      else if (k) { r.push(k); k = 0; }
    }
    if (r.length !== clue.length || r.some((x, i) => x !== clue[i])) continue;
    any = true;
    vals.forEach((v, i) => { out[i] = out[i]! | (v === FILLED ? CAN_FILL : CAN_EMPTY); });
  }
  return any ? out : null;
}

test("line solver matches brute force", () => {
  const rng = createRng("lines");
  for (let t = 0; t < 3000; t++) {
    const n = rng.range(1, 9);
    const truth = Array.from({ length: n }, () => (rng.bool(0.55) ? FILLED : EMPTY));
    const clue = cluesOf(n, 1, truth).rows[0]!.slice();
    if (rng.bool(0.2) && clue.length) clue[rng.int(clue.length)]! += 1;
    const line = Array.from({ length: n }, (_, i) => (rng.bool(0.3) ? (rng.bool(0.2) ? (truth[i] === FILLED ? EMPTY : FILLED) : truth[i]!) : UNKNOWN));
    expect(solveLine(clue, line)).toEqual(bruteLine(clue, line));
  }
});

test("logic solving implies uniqueness (cross-check with search)", () => {
  const rng = createRng("cross");
  let solved = 0, ambiguous = 0;
  for (let t = 0; t < 300; t++) {
    const w = rng.range(3, 7), h = rng.range(3, 7);
    const grid = randomPicture({ w, h, density: 0.3 + rng.next() * 0.4, smoothing: rng.int(2) }, rng);
    const clues = cluesOf(w, h, grid);
    const a = analyze(clues);
    const c = countSolutions(clues, 2);
    expect(c.exhausted).toBe(false);
    expect(c.count).toBeGreaterThanOrEqual(1);
    if (a.status === "solved") {
      solved++;
      expect(c.count).toBe(1);
      expect(Array.from(a.cells)).toEqual(Array.from(c.solutions[0]!));
    } else if (c.count > 1) ambiguous++;
  }
  expect(solved).toBeGreaterThan(0);
  expect(ambiguous).toBeGreaterThan(0);
});

test("generation is deterministic, unique, and at the requested level", async () => {
  for (const difficulty of ["easy", "hard"]) {
    for (const seed of ["a", "b", "c"]) {
      const params = { width: 10, height: 8, difficulty };
      const p1 = await generate(pattern, params, seed, sig()) as PatternPuzzle;
      const p2 = await generate(pattern, params, seed, sig()) as PatternPuzzle;
      expect(JSON.parse(JSON.stringify(p1))).toEqual(JSON.parse(JSON.stringify(p2)));
      const fresh = JSON.parse(JSON.stringify(p1)) as PatternPuzzle;
      expect(countSolutions(fresh).count).toBe(1);
      const a = analyze(fresh, difficulty === "easy" ? "line" : "probe");
      expect(a.status).toBe("solved");
      expect(pattern.rate!(fresh)!.label).toBe(difficulty);
    }
  }
});

test("formats round-trip", () => {
  const p = pattern.formats.find((f) => f.id === "picture")!.parse(".#.#.\n#####\n#...#\n.#.#.\n..#..");
  for (const f of pattern.formats) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    const q = f.parse(text);
    expect(q.rows).toEqual(p.rows);
    expect(q.cols).toEqual(p.cols);
  }
  const non = pattern.formats.find((f) => f.id === "non")!.parse("title \"x\"\nwidth 2\nheight 2\nrows\n2\n0\ncolumns\n1\n1\n");
  expect(non).toEqual({ w: 2, h: 2, rows: [[2], []], cols: [[1], [1]], title: "x" });
  expect(() => pattern.formats[0]!.parse("2x2:2/2/1/1")).toThrow();
  expect(() => pattern.formats[0]!.parse("2x2:3/0/1/1")).toThrow();
});

test("done numbers only count provable runs", () => {
  const F = FILLED, E = EMPTY, U = UNKNOWN;
  expect(doneNumbers([2, 1], [F, F, E, U, U, U])).toEqual([true, false]);
  expect(doneNumbers([2, 1], [F, F, U, U, U, U])).toEqual([false, false]);
  expect(doneNumbers([2, 1], [U, U, U, E, F, E])).toEqual([false, true]);
  expect(doneNumbers([2, 1], [U, F, F, U, F, U])).toEqual([true, true]);
});

/** Every arrangement of `clue` on a line of length n consistent with `line`, as block start lists. */
function arrangements(clue: number[], line: number[]): number[][] {
  const n = line.length;
  const out: number[][] = [];
  const rec = (j: number, from: number, starts: number[]) => {
    if (j === clue.length) {
      const vals = Array.from({ length: n }, () => EMPTY);
      starts.forEach((s, b) => { for (let i = s; i < s + clue[b]!; i++) vals[i] = FILLED; });
      if (vals.every((v, i) => line[i] === UNKNOWN || line[i] === v)) out.push(starts.slice());
      return;
    }
    for (let s = from; s + clue[j]! <= n; s++) rec(j + 1, s + clue[j]! + 1, [...starts, s]);
  };
  rec(0, 0, []);
  return out;
}

function randomLine(rng: ReturnType<typeof createRng>): { clue: number[]; line: number[]; truth: number[] } {
  const n = rng.range(1, 10);
  const truth = Array.from({ length: n }, () => (rng.bool(0.55) ? FILLED : EMPTY));
  const clue = cluesOf(n, 1, truth).rows[0]!.slice();
  const line = truth.map((v) => (rng.bool(0.35) ? v : UNKNOWN));
  return { clue, line, truth };
}

test("extremes and arrangement counts match brute force", () => {
  const rng = createRng("extremes");
  for (let t = 0; t < 3000; t++) {
    const { clue, line } = randomLine(rng);
    if (rng.bool(0.15) && line.length) line[rng.int(line.length)] = rng.bool() ? FILLED : EMPTY;
    const all = arrangements(clue, line);
    expect(countArrangements(clue, line)).toBe(all.length);
    const ext = extremes(clue, line);
    if (!all.length) {
      expect(ext).toBeNull();
      continue;
    }
    expect(ext).not.toBeNull();
    for (let j = 0; j < clue.length; j++) {
      expect(ext!.left[j]).toBe(Math.min(...all.map((a) => a[j]!)));
      expect(ext!.right[j]).toBe(Math.max(...all.map((a) => a[j]!)));
    }
  }
});

test("every line rule is sound and only decides blank cells", () => {
  const rng = createRng("rules");
  const fired = new Map<string, number>();
  for (let t = 0; t < 4000; t++) {
    const { clue, line } = randomLine(rng);
    const poss = solveLine(clue, line)!;
    for (const r of LINE_RULES) {
      const f = r.find({ clue, vals: line });
      for (const i of f.fill) { expect(line[i]).toBe(UNKNOWN); expect(poss[i]).toBe(CAN_FILL); }
      for (const i of f.empty) { expect(line[i]).toBe(UNKNOWN); expect(poss[i]).toBe(CAN_EMPTY); }
      if (f.fill.length || f.empty.length) fired.set(r.id, (fired.get(r.id) ?? 0) + 1);
      const own = ruleOnLine(r.id, { clue, vals: line });
      if (own) expect(own.fill.length + own.empty.length).toBeGreaterThan(0);
    }
  }
  for (const r of LINE_RULES) expect(fired.get(r.id) ?? 0).toBeGreaterThan(0);
});

function hostFor(puzzle: PatternPuzzle, techniques = patternTechniques, plugins: typeof patternPlugins = []) {
  const registry = new Registry();
  registry.puzzle(pattern);
  for (const t of techniques) registry.technique(t);
  const session = new Session(pattern, puzzle, { kind: "imported" });
  for (const p of plugins) p.setup!({ session, settings: {}, owner: p.id });
  return { session, host: new TechniqueHost(registry, session) };
}

test("techniques solve generated puzzles, every step agreeing with the solution", async () => {
  for (const difficulty of ["easy", "hard"]) {
    for (const seed of ["s1", "s2", "s3"]) {
      const puzzle = await generate(pattern, { width: 12, height: 9, difficulty }, seed, sig()) as PatternPuzzle;
      const sol = info(puzzle).solution!;
      let state = pattern.init(puzzle);
      const used = new Set<string>();
      for (let guard = 0; guard < 2000 && !pattern.isSolved(puzzle, state); guard++) {
        const hit = firstStep(pattern, patternTechniques, puzzle, state)!;
        expect(hit).not.toBeNull();
        used.add(hit.technique.id);
        for (const a of hit.step.actions as PatternAction[]) for (const c of a.cells) expect<number>(a.value).toBe(sol[c]!);
        state = applyStep(pattern, puzzle, state, hit.step);
      }
      expect(pattern.isSolved(puzzle, state)).toBe(true);
      expect(used.has("pattern.what-if")).toBe(difficulty === "hard");
    }
  }
});

test("a wrong mark never misleads a technique, and gets pointed out before any hint", async () => {
  const puzzle = await generate(pattern, { width: 8, height: 8, difficulty: "hard" }, "hints", sig()) as PatternPuzzle;
  const sol = info(puzzle).solution!;
  const { session } = hostFor(puzzle, patternTechniques, patternPlugins.filter((p) => p.id === "pattern.check-marks"));
  const bad = sol.indexOf(EMPTY);
  session.dispatch({ type: "set", cells: [bad], value: FILLED });
  for (const t of patternTechniques) {
    const step = t.find(puzzle, session.state);
    for (const a of step?.actions ?? []) for (const c of a.cells) { expect<number>(a.value).toBe(sol[c]!); expect(c).not.toBe(bad); }
  }
  const h1 = session.hint()!;
  expect(h1.focus).toEqual({ cells: [bad] });
  session.dispatch(h1.actions![0]!);
  for (let i = 0; i < 500 && !session.solved; i++) {
    const h = session.hint();
    expect(h?.more?.actions?.length).toBeGreaterThan(0);
    for (const a of h!.more!.actions!) session.dispatch(a);
  }
  expect(session.solved).toBe(true);
});

test("finished lines get crossed automatically inside the same undo step", () => {
  const puzzle = pattern.formats[0]!.parse("3x3:1/1/1/1/1/1");
  const { session } = hostFor(puzzle, [finishedLine]);
  session.dispatch({ type: "set", cells: [0], value: FILLED });
  expect(session.state.cells.slice(0, 3)).toEqual([FILLED, EMPTY, EMPTY]);
  expect([session.state.cells[3], session.state.cells[6]]).toEqual([EMPTY, EMPTY]);
  session.undo();
  expect(session.state.cells.every((v) => v === UNKNOWN)).toBe(true);
  // clearing a cross is a retraction: auto-apply leaves it alone
  session.dispatch({ type: "set", cells: [0], value: FILLED });
  session.dispatch({ type: "set", cells: [1], value: UNKNOWN });
  expect(session.state.cells[1]).toBe(UNKNOWN);
});

test("every technique can be practiced", async () => {
  for (const t of patternTechniques) {
    for (const seed of ["a", "b", "c", "d"]) {
      const t0 = performance.now();
      const pos = await findPracticePosition(pattern, patternTechniques, t, seed, sig());
      expect(pos, t.id).not.toBeNull();
      expect(performance.now() - t0, t.id).toBeLessThan(3000);
    }
  }
}, 60000);
