import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { BLACK, EMPTY, geometry, type LightupPuzzle } from "./grid";
import { gridFormat, lightup, sgtFormat, type LightupState } from "./logic";
import { LIGHT, analyze, countSolutions, freshKnowledge, logicSolve, type Level } from "./solver";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(lightup, params, seed, sig()) as Promise<LightupPuzzle>;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 9, height: 8, difficulty: "hard" }, "abc");
  const b = await gen({ width: 9, height: 8, difficulty: "hard" }, "abc");
  const c = await gen({ width: 9, height: 8, difficulty: "hard" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of ["easy", "medium", "hard"] as const) {
  test(`${difficulty} puzzles are unique, logic-solvable, and need exactly ${difficulty}`, async () => {
    const want = ["easy", "medium", "hard"].indexOf(difficulty) as Level;
    for (let i = 0; i < 12; i++) {
      const p = await gen({ width: 7 + (i % 5), height: 6 + (i % 4), difficulty, symmetry: ["none", "mirror", "rot2", "rot4"][i % 4] }, `s${i}`);
      const logic = logicSolve(p, want);
      expect(logic.level).toBe(want);
      if (want > 0) expect(logicSolve(p, (want - 1) as Level).level).toBeNull();
      const brute = countSolutions(geometry(p), freshKnowledge(geometry(p)), 2);
      expect(brute.count).toBe(1);
      const sol = Array.from(brute.first!, (v, c) => (v === LIGHT && p.cells[c] === EMPTY ? 1 : 0));
      expect(analyze(p).solution).toEqual(sol);
    }
  });
}

test("extreme wall densities and sizes still generate", async () => {
  for (const [w, h, walls] of [[3, 3, 5], [3, 3, 50], [30, 30, 20], [12, 5, 50], [5, 12, 5]] as const) {
    const p = await gen({ width: w, height: h, walls, difficulty: "medium" }, "x");
    expect(analyze(p).count).toBe(1);
  }
});

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 400; t++) {
    const w = rng.range(2, 6), h = rng.range(2, 6);
    const cells = Array.from({ length: w * h }, () => (rng.bool(0.3) ? (rng.bool(0.6) ? rng.int(5) : BLACK) : EMPTY));
    const p: LightupPuzzle = { w, h, cells };
    const g = geometry(p);
    const brute = countSolutions(g, freshKnowledge(g), 2);
    const logic = logicSolve(p, 2);
    if (logic.level !== null) {
      solved++;
      expect(brute.count).toBe(1);
      expect(Array.from(logic.k, (v, c) => (cells[c] === EMPTY ? v : 0))).toEqual(Array.from(brute.first!, (v, c) => (cells[c] === EMPTY ? v : 0)));
    }
    if (!logic.ok) expect(brute.count).toBe(0);
  }
  expect(solved).toBeGreaterThan(20);
});

test("following hints from scratch solves the puzzle", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 10, height: 10, difficulty }, `h-${difficulty}`);
    const s = new Session(lightup, p, { kind: "imported" });
    for (let i = 0; i < 400 && !s.solved; i++) {
      const h = s.hint();
      expect(h?.action).toBeDefined();
      s.dispatch(h!.action!);
    }
    expect(s.solved).toBe(true);
  }
});

test("hint flags wrong marks first", async () => {
  const p = await gen({ width: 8, height: 8 }, "wrong");
  const sol = analyze(p).solution!;
  const bad = p.cells.findIndex((v, c) => v === EMPTY && sol[c] === 0);
  const s: LightupState = { marks: p.cells.map((_, c) => (c === bad ? 1 : 0)) };
  const h = lightup.hint!(p, s)!;
  expect(h.action).toEqual({ type: "set", cells: [bad], value: 0 });
});

test("formats round-trip and sgt runs split at 26", async () => {
  const p = await gen({ width: 12, height: 9 }, "fmt");
  for (const f of [sgtFormat, gridFormat]) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual(p);
  }
  const open: LightupPuzzle = { w: 30, h: 1, cells: Array.from({ length: 30 }, (_, i) => (i === 29 ? 2 : EMPTY)) };
  expect(sgtFormat.serialize!(open)).toBe("30x1:zc2");
  expect(sgtFormat.parse("30x1b20s1d0:zc2")).toEqual(open);
  expect(() => sgtFormat.parse("3x3:a")).toThrow();
  expect(analyze(gridFormat.parse("...\n...\n...")).count).toBe(2);
  expect(analyze(gridFormat.parse(".4.\n...")).count).toBe(0);
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 10, height: 7 }, "solve");
  expect(lightup.isSolved(p, lightup.solve!(p)!)).toBe(true);
  expect(lightup.isSolved(p, lightup.init(p))).toBe(false);
});
