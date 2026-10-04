import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { createRng } from "../../core/rng";
import { resolve } from "../../core/schema";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, isPartOfStep } from "../../core/techniques";
import { keen, sudoku, towers, unequal } from "./defs";
import { bit, digits } from "./engine/bits";
import { grade, gridFrom, logicalSolve } from "./engine/human";
import { compile, conflicts, modelOf } from "./engine/model";
import { constraintTypes } from "./engine/registry";
import { initialState, propagate, solve } from "./engine/solver";
import type { LatinPuzzle } from "./engine/types";
import { latinFormats } from "./formats";
import { CANDIDATES } from "./keys";
import { latinPlugins } from "./plugins";
import { register } from "./index";
import { featuresOf, initState, reduce, type GridAction, type GridState } from "./puzzle";
import { latinTechniques } from "./techniques";

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

/** A session wired the way the shell does it: these plugins set up, every technique attached (`auto` ones switched on). */
function played(p: LatinPuzzle, def: typeof sudoku = sudoku, opts: { plugins?: string[]; auto?: string[] } = {}) {
  const registry = new Registry();
  registry.puzzle(def);
  for (const t of latinTechniques()) registry.technique(opts.auto?.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const session = new Session(def, p, { kind: "imported" });
  const host = new TechniqueHost(registry, session);
  for (const plugin of latinPlugins.filter((x) => opts.plugins?.includes(x.id))) {
    plugin.setup?.({ session, settings: plugin.settings ? resolve(plugin.settings, {}) : {}, owner: plugin.id });
  }
  session.settle(false);
  return { session, host };
}

const AUTO_SINGLES = ["sudoku.full-house", "sudoku.hidden-single", "sudoku.naked-single"];

test("hints point out mistakes first, then follow techniques to the end", async () => {
  const p = await generate(sudoku, { difficulty: "hard" }, "hint", sig()) as LatinPuzzle;
  const { session } = played(p, sudoku, { plugins: ["sudoku.hint-mistakes"] });
  const empty = p.givens.findIndex((v) => !v);
  session.dispatch({ type: "set", cells: [empty], digit: (p.solution![empty]! % 9) + 1 });
  expect(session.hint()!.actions).toEqual([{ type: "set", cells: [empty], digit: 0 }]);
  for (let i = 0; i < 400 && !session.solved; i++) {
    const h = session.hint();
    expect(h?.actions?.length).toBeGreaterThan(0);
    session.batch(() => { for (const a of h!.actions!) session.dispatch(a); });
  }
  expect(session.solved).toBe(true);
  expect(session.state.values).toEqual(p.solution!);
});

test("every technique step is sound and changes the board, across puzzle types", async () => {
  const cases = [
    [sudoku, { difficulty: "expert" }], [sudoku, { variants: ["killer"], difficulty: "hard" }],
    [sudoku, { variants: ["thermo", "kropki"], difficulty: "any" }], [keen, { size: 6 }], [towers, { size: 5 }], [unequal, { size: 5 }],
  ] as const;
  const seen = new Set<string>();
  for (const [def, params] of cases) {
    const p = await generate(def, params, "sound", sig()) as LatinPuzzle;
    const sol = p.solution!;
    const list = latinTechniques().filter((t) => t.puzzles.includes(def.id) && (t.requires ?? []).every((r) => featuresOf(p).includes(r))).sort((a, b) => a.level - b.level);
    let s = initState(p);
    for (let guard = 0; guard < 500 && !def.isSolved(p, s); guard++) {
      const hit = firstStep(def, list, p, s);
      if (!hit) break;
      seen.add(hit.technique.id);
      for (const a of hit.step.actions as GridAction[]) {
        if (a.type === "set") expect(a.digit).toBe(sol[a.cells[0]!]!);
        if (a.type === "strike") for (const [c, m] of a.marks) expect(m & bit(sol[c]!)).toBe(0);
      }
      s = applyStep(def, p, s, hit.step);
    }
    expect(def.isSolved(p, s)).toBe(true);
  }
  for (const id of ["sudoku.hidden-single", "sudoku.clue.killer", "sudoku.clue.keen", "sudoku.clue.towers", "sudoku.clue.unequal"]) expect(seen).toContain(id);
}, 60_000);

test("features keep techniques, assists and widgets to the puzzles they make sense on", async () => {
  const t = await generate(towers, { size: 5 }, "feat", sig()) as LatinPuzzle;
  const k = await generate(sudoku, { variants: ["killer"], difficulty: "any" }, "feat", sig()) as LatinPuzzle;
  const registry = new Registry();
  register(registry);
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  const towerTech = ids(registry.techniquesFor("towers", t));
  expect(towerTech).toContain("sudoku.clue.towers");
  expect(towerTech).not.toContain("sudoku.pointing");
  expect(towerTech).not.toContain("sudoku.clue.killer");
  expect(ids(registry.widgetsFor("towers", t))).not.toContain("sudoku.combos");
  expect(ids(registry.widgetsFor("sudoku", k))).toContain("sudoku.combos");
  expect(ids(registry.pluginsFor("towers", t))).not.toContain("sudoku.links");
  expect(ids(registry.pluginsFor("sudoku", k))).toContain("sudoku.links");
  expect(ids(registry.techniquesFor("sudoku", k))).toContain("sudoku.clue.killer");
});

test("auto singles land in the move's undo step and never stop early", async () => {
  // the reported board: both singles on, a stray naked single was left after placing a 1 in the top-right
  const p = await generate(sudoku, {}, "uweyp8x9", sig()) as LatinPuzzle;
  const { session } = played(p, sudoku, { auto: AUTO_SINGLES });
  const singles = latinTechniques().filter((t) => AUTO_SINGLES.includes(t.id)).sort((a, b) => a.level - b.level);
  const stuck = () => firstStep(sudoku, singles, p, session.state);
  expect(stuck()).toBeNull();
  // a 1 anywhere in the top-right box, right or wrong, leaves no single behind
  for (const c of [6, 7, 8, 15, 16, 17, 24, 25, 26].filter((x) => !session.state.values[x])) {
    if (!session.dispatch({ type: "set", cells: [c], digit: 1 })) continue;
    expect(stuck()).toBeNull();
    session.undo();
  }
  const sol = p.solution!;
  const order = [p.n - 1, ...sol.keys()].filter((c) => !session.state.values[c]);
  let moves = 0;
  for (const c of order) {
    if (session.solved || session.state.values[c]) continue;
    const before = session.state;
    session.dispatch({ type: "set", cells: [c], digit: sol[c]! });
    moves++;
    expect(stuck()).toBeNull();
    session.undo();
    expect(session.state).toBe(before);
    session.redo();
  }
  expect(session.solved).toBe(true);
  expect(moves).toBeGreaterThan(0);
});

test("erasing is a retraction: auto techniques don't refill it", async () => {
  const p = await generate(sudoku, { difficulty: "easy" }, "erase", sig()) as LatinPuzzle;
  const { session } = played(p, sudoku, { auto: AUTO_SINGLES });
  expect(session.solved).toBe(true);
  const c = p.givens.findIndex((v) => !v);
  session.dispatch({ type: "set", cells: [c], digit: 0 });
  expect(session.state.values[c]).toBe(0);
  session.dispatch({ type: "color", cells: [c], color: 2, on: true });
  expect(session.state.values[c]).toBe(p.solution![c]);
});

test("assists: mark cleanup and auto candidates", async () => {
  const p = await generate(sudoku, { difficulty: "easy" }, "assist", sig()) as LatinPuzzle;
  const sol = p.solution!;
  const a = p.givens.findIndex((v) => !v);
  const peer = modelOf(p).peers[a]!.find((c) => !p.givens[c])!;

  const s1 = played(p, sudoku, { plugins: ["sudoku.auto-remove"] }).session;
  s1.dispatch({ type: "mark", layer: "center", cells: [peer], digit: sol[a]!, on: true });
  s1.dispatch({ type: "set", cells: [a], digit: sol[a]! });
  expect(s1.state.center[peer]! & bit(sol[a]!)).toBe(0);

  const s2 = played(p, sudoku, { plugins: ["sudoku.auto-candidates"] }).session;
  const cands = s2.derived()[CANDIDATES] as number[];
  expect(cands[a]! & bit(sol[a]!)).toBeTruthy();
  const wrong = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((d) => d !== sol[a] && cands[a]! & bit(d))!;
  s2.dispatch({ type: "mark", layer: "center", cells: [a], digit: wrong, on: false });
  expect(s2.state.struck[a]).toBe(bit(wrong));
  expect((s2.derived()[CANDIDATES] as number[])[a]! & bit(wrong)).toBe(0);
});

test("practice boards for eliminations show candidates, and striking one is part of the step", async () => {
  const all = latinTechniques();
  const target = all.find((t) => t.id === "sudoku.pointing")!;
  const pos = await findPracticePosition(sudoku, all, target, "p", sig());
  expect(pos).not.toBeNull();
  const session = new Session(sudoku, pos!.puzzle as LatinPuzzle, { kind: "practice", technique: target.id, seed: pos!.seed, step: pos!.step }, { state: pos!.state as GridState });
  const plugin = latinPlugins.find((x) => x.id === "sudoku.practice-candidates")!;
  plugin.setup!({ session, settings: {}, owner: plugin.id });
  expect(session.derived()[CANDIDATES]).toBeDefined();
  const strike = pos!.step.actions.find((a) => (a as GridAction).type === "strike") as Extract<GridAction, { type: "strike" }>;
  const [c, m] = strike.marks[0]!;
  const prev = session.state;
  session.dispatch({ type: "mark", layer: "center", cells: [c], digit: digits(m)[0]!, on: false });
  expect(isPartOfStep(sudoku, session.puzzle, prev, session.state, pos!.step)).toBe(true);
}, 60_000);

test("names, aliases and rules", async () => {
  expect([sudoku, keen, towers, unequal].map((d) => d.name)).toEqual(["sudoku", "calcudoku", "skyscrapers", "futoshiki"]);
  expect(keen.aliases).toContain("kenken");
  const p = await generate(sudoku, { variants: ["thermo"], difficulty: "any" }, "rules", sig()) as LatinPuzzle;
  expect(sudoku.rules!(p).some((r) => r.includes("thermometer"))).toBe(true);
});

test("every cell a hint names is highlighted, at both hint levels", async () => {
  const cases = [
    [sudoku, { difficulty: "expert" }], [sudoku, { variants: ["killer", "thermo"], difficulty: "hard" }], [sudoku, { variants: ["arrow", "renban", "whispers", "xv"], difficulty: "any" }], [sudoku, { variants: ["littlekiller", "kropki", "jigsaw"], difficulty: "any" }], [keen, { size: 6 }], [towers, { size: 6 }], [unequal, { size: 5 }],
  ] as const;
  const named = (text: string) => [...text.matchAll(/\b([A-I])([1-9])\b/g)].map((m) => (Number(m[2]) - 1) * 9 + m[1]!.charCodeAt(0) - 65);
  for (const [def, params] of cases) {
    const p = await generate(def, params, "names", sig()) as LatinPuzzle;
    const cell = (c9: number) => Math.floor(c9 / 9) * p.n + (c9 % 9);
    const list = latinTechniques().filter((t) => t.puzzles.includes(def.id) && (t.requires ?? []).every((r) => featuresOf(p).includes(r))).sort((a, b) => a.level - b.level);
    let s = initState(p);
    for (let guard = 0; guard < 300 && !def.isSolved(p, s); guard++) {
      const hit = firstStep(def, list, p, s);
      if (!hit) break;
      for (const [text, focus] of [[hit.step.message, hit.step.focus], [hit.step.nudge ?? "", hit.step.nudgeFocus]] as const) {
        const f = focus as { cells: number[]; areas: number[][]; place: [number, number][]; eliminate: [number, number][] };
        const lit = new Set([...f.cells, ...f.areas.flat(), ...f.place.map(([c]) => c), ...f.eliminate.map(([c]) => c)]);
        for (const c of named(text)) expect({ text, cell: cell(c), lit: lit.has(cell(c)) }).toEqual({ text, cell: cell(c), lit: true });
      }
      s = applyStep(def, p, s, hit.step);
    }
  }
}, 60_000);
