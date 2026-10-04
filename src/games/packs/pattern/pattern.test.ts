import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { info, pattern, type PatternPuzzle } from "./logic";
import { doneNumbers, plugins } from "./plugins";
import {
  CAN_EMPTY, CAN_FILL, EMPTY, FILLED, UNKNOWN, analyze, cluesOf, countSolutions, randomPicture, solveLine,
} from "./solver";

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

test("session: hints solve the puzzle, mistakes get flagged first", async () => {
  const puzzle = await generate(pattern, { width: 8, height: 8, difficulty: "hard" }, "hints", sig()) as PatternPuzzle;
  const session = new Session(pattern, puzzle, { kind: "imported" });
  const sol = info(puzzle).solution!;
  const bad = sol.indexOf(EMPTY);
  session.dispatch({ type: "set", cells: [bad], value: FILLED });
  const h1 = session.hint()!;
  expect(h1.focus).toEqual({ cells: [bad] });
  session.dispatch(h1.actions![0]!);
  for (let i = 0; i < 500 && !session.solved; i++) {
    const h = session.hint();
    expect(h?.actions?.[0]).toBeDefined();
    session.dispatch(h!.actions![0]!);
  }
  expect(session.solved).toBe(true);
  expect(pattern.solve!(puzzle)!.cells).toEqual(Array.from(sol));
});

test("auto-cross runs inside the same undo step", () => {
  const puzzle = pattern.formats[0]!.parse("3x3:1/1/1/1/1/1");
  const session = new Session(pattern, puzzle, { kind: "imported" });
  const auto = plugins.find((p) => p.id === "pattern.auto-cross")!;
  auto.setup!({ session, settings: {}, owner: "t" });
  session.dispatch({ type: "set", cells: [0], value: FILLED });
  expect(session.state.cells.slice(0, 3)).toEqual([FILLED, EMPTY, EMPTY]);
  session.undo();
  expect(session.state.cells.every((v) => v === UNKNOWN)).toBe(true);
});

test("done numbers only count provable runs", () => {
  const F = FILLED, E = EMPTY, U = UNKNOWN;
  expect(doneNumbers([2, 1], [F, F, E, U, U, U])).toEqual([true, false]);
  expect(doneNumbers([2, 1], [F, F, U, U, U, U])).toEqual([false, false]);
  expect(doneNumbers([2, 1], [U, U, U, E, F, E])).toEqual([false, true]);
  expect(doneNumbers([2, 1], [U, F, F, U, F, U])).toEqual([true, true]);
});
