import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { keen, sudoku, towers, unequal } from "./defs";
import { bit } from "./engine/bits";
import { grade, gridFrom, logicalSolve } from "./engine/human";
import { compile, conflicts, modelOf } from "./engine/model";
import { constraintTypes } from "./engine/registry";
import { initialState, propagate, solve } from "./engine/solver";
import type { LatinPuzzle } from "./engine/types";
import { latinFormats } from "./formats";
import { hint, initState, reduce, type GridAction, type GridState } from "./puzzle";

const CLASSIC = [{ type: "latin" }, { type: "boxes", w: 3, h: 3 }];
const sig = () => new AbortController().signal;
const digitsOf = (s: string) => [...s].map((ch) => (ch === "." ? 0 : Number(ch)));

test("solver finds the unique solution of a classic", () => {
  const m = compile(9, CLASSIC);
  const r = solve(m, digitsOf("530070000600195000098000060800060003400803001700020006060000280000419005000080079"));
  expect(r.solutions.length).toBe(1);
  expect(r.solutions[0]!.slice(0, 9)).toEqual([5, 3, 4, 6, 7, 8, 9, 1, 2]);
});

test("human solver needs more than singles where it should, and finishes", () => {
  const m = compile(9, CLASSIC);
  const g = digitsOf("100000569492056108056109240009640801064010000218035604040500016905061402621000005");
  const gr = grade(m, g);
  expect(gr.band.id).not.toBe("easy");
  expect(logicalSolve(gridFrom(m, g)).solved).toBe(true);
});

test("propagation never loses the true solution, for every clue type", () => {
  const base = compile(9, CLASSIC);
  const sol = solve(base, Array.from({ length: 81 }, () => 0), { limit: 1, rng: createRng("sound") }).solutions[0]!;
  for (const t of constraintTypes.list()) {
    if (!t.clues || t.type === "keen") continue;
    const clues = t.clues(sol, 9, createRng(t.type), { maxCage: 5 });
    const m = compile(9, [...CLASSIC, ...clues]);
    expect(conflicts(m, sol).size).toBe(0);
    const st = initialState(m, Array.from({ length: 81 }, () => 0));
    expect(propagate(m, st)).toBe(true);
    sol.forEach((d, c) => expect(st.masks[c]! & bit(d)).toBeTruthy());
  }
});

async function unique(p: LatinPuzzle): Promise<void> {
  const r = solve(modelOf(p), p.givens, { limit: 2 });
  expect(r.solutions.length).toBe(1);
  expect(r.solutions[0]).toEqual(p.solution!);
}

test("seeded generation is reproducible and unique across puzzle types", async () => {
  const cases = [
    [sudoku, { variants: [] }],
    [sudoku, { variants: ["killer", "antiknight"], difficulty: "any" }],
    [sudoku, { variants: ["jigsaw", "thermo"], difficulty: "any" }],
    [sudoku, { size: "6", variants: ["kropki"], difficulty: "any" }],
    [keen, { size: 5 }],
    [towers, { size: 5 }],
    [unequal, { size: 5 }],
  ] as const;
  for (const [def, params] of cases) {
    const a = await generate(def, params, "fixed", sig()) as LatinPuzzle;
    const b = await generate(def, params, "fixed", sig()) as LatinPuzzle;
    expect(a).toEqual(b);
    await unique(a);
  }
});

test("difficulty targets are met for classic sudoku", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await generate(sudoku, { difficulty }, "target", sig()) as LatinPuzzle;
    expect(grade(modelOf(p), p.givens, p.solution).band.id).toBe(difficulty);
  }
});

test("formats round-trip", async () => {
  const [text, json] = latinFormats();
  const classic = text!.parse("53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79");
  expect(text!.serialize!(classic)).toBe("53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79");
  const p = await generate(sudoku, { variants: ["killer"], difficulty: "any" }, "fmt", sig()) as LatinPuzzle;
  const back = text!.parse(text!.serialize!(p));
  expect(back.constraints).toEqual(p.constraints);
  expect(back.givens).toEqual(p.givens);
  expect(json!.parse(json!.serialize!(p)).constraints).toEqual(p.constraints);
  expect(() => text!.parse("11..")).toThrow();
});

test("reducer: givens are fixed, marks and strikes behave", () => {
  const p = latinFormats()[0]!.parse("12..34..........") as LatinPuzzle;
  let s: GridState = initState(p);
  const go = (a: GridAction) => (s = reduce(p, s, a));
  const before = s;
  go({ type: "set", cells: [0], digit: 4 });
  expect(s).toBe(before);
  go({ type: "set", cells: [2, 3], digit: 4 });
  expect(s.values.slice(0, 4)).toEqual([1, 2, 4, 4]);
  go({ type: "mark", layer: "center", cells: [8, 9], digit: 2, on: true });
  expect(s.center[8]).toBe(bit(2));
  go({ type: "strike", marks: [[8, bit(2)]], on: true });
  expect(s.center[8]).toBe(0);
  expect(s.struck[8]).toBe(bit(2));
  go({ type: "clear", cells: [8], layer: "marks" });
  expect(s.struck[8]).toBe(0);
});

test("hints point out mistakes first, then a logical step", async () => {
  const p = await generate(sudoku, { difficulty: "easy" }, "hint", sig()) as LatinPuzzle;
  const empty = p.givens.findIndex((v) => !v);
  const wrong = (p.solution![empty]! % 9) + 1;
  const s = reduce(p, initState(p), { type: "set", cells: [empty], digit: wrong });
  expect(hint(p, s)!.action).toEqual({ type: "set", cells: [empty], digit: 0 });
  const h = hint(p, initState(p))!;
  expect(h.action?.type).toBe("set");
  const session = new Session(sudoku, p, { kind: "imported" });
  for (let i = 0; i < 200 && !session.solved; i++) {
    const next = session.hint();
    if (!next?.action) break;
    session.dispatch(next.action);
  }
  expect(session.solved).toBe(true);
});
