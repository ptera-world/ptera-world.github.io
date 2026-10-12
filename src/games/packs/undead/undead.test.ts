import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, findStep, firstStep, rateByTechniques } from "../../core/techniques";
import { ALL, EMPTY, MIRROR_L, MIRROR_R, bit, geometry, type UndeadPuzzle } from "./grid";
import { cellName, sgtFormat, undead, type UndeadAction, type UndeadFocus } from "./logic";
import { checkMarks } from "./plugins";
import { analyze, countSolutions, freshKnowledge, logicSolve, puzzleFrom, toMonsters, type Level } from "./solver";
import { undeadTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(undead, params, seed, sig()) as Promise<UndeadPuzzle>;

test("sight lines bounce like the original: \\ turns down into right, / turns down into left", () => {
  // 2×1: a \ mirror then an empty cell; looking down column A bounces right into B1
  const g = geometry({ w: 2, h: 1, cells: [MIRROR_L, EMPTY] });
  expect(g.paths[0]).toEqual([{ cell: 1, g: 1, v: 0, z: 1 }]);
  const r = geometry({ w: 2, h: 1, cells: [EMPTY, MIRROR_R] });
  expect(r.paths[1]).toEqual([{ cell: 0, g: 1, v: 0, z: 1 }]);
});

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 5, height: 5, difficulty: "hard" }, "abc");
  const b = await gen({ width: 5, height: 5, difficulty: "hard" }, "abc");
  const c = await gen({ width: 5, height: 5, difficulty: "hard" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of ["easy", "medium", "hard"] as const) {
  test(`${difficulty} puzzles are unique, logic-solvable, and need exactly ${difficulty}`, async () => {
    const want = ["easy", "medium", "hard"].indexOf(difficulty) as Level;
    for (let i = 0; i < 8; i++) {
      const p = await gen({ width: 4 + (i % 3), height: 4 + (i % 4), difficulty }, `s${i}`);
      expect(logicSolve(p, want).level).toBe(want);
      if (want > 0) expect(logicSolve(p, (want - 1) as Level).level).toBeNull();
      const brute = countSolutions(p, freshKnowledge(p), 2);
      expect(brute.count).toBe(1);
      expect(analyze(p).solution).toEqual(toMonsters(brute.first!));
    }
  });
}

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 300; t++) {
    const w = rng.range(2, 4), h = rng.range(2, 4);
    const cells = Array.from({ length: w * h }, () => (rng.bool(0.35) ? rng.pick([MIRROR_L, MIRROR_R]) : EMPTY));
    const p = puzzleFrom(w, h, cells, cells.map((v) => (v === EMPTY ? rng.range(1, 3) : 0)));
    if (rng.bool(0.3)) p.clues[rng.int(p.clues.length)]! += rng.pick([-1, 1]);
    const brute = countSolutions(p, freshKnowledge(p), 2);
    const logic = logicSolve(p, 2);
    if (logic.level !== null) {
      solved++;
      expect(brute.count).toBe(1);
      expect(toMonsters(logic.k)).toEqual(toMonsters(brute.first!));
    }
    if (!logic.ok) expect(brute.count).toBe(0);
  }
  expect(solved).toBeGreaterThan(20);
});

function played(p: UndeadPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of undeadTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(undead, p, { kind: "imported" });
  new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return s;
}

test("wrong monsters are pointed out first; technique steps follow", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 6, height: 6, difficulty }, `h-${difficulty}`);
    const s = played(p);
    const sol = analyze(p).solution!;
    const c = geometry(p).empties.find((x) => !p.given[x])!;
    const wrong = sol[c] === 1 ? 2 : 1;
    s.dispatch({ type: "set", cells: [c], value: wrong });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "set", cells: [c], value: 0 });
    s.dispatch({ type: "set", cells: [c], value: 0 });
    for (let i = 0; i < 400 && !s.solved; i++) {
      const hit = firstStep(undead, undeadTechniques, p, s.state);
      if (!hit) break;
      s.batch(() => { for (const a of hit.step.actions as UndeadAction[]) s.dispatch(a); });
    }
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  const lvl = (id: string) => undeadTechniques.find((t) => t.id === id)!.level;
  const top = { easy: lvl("undead.sight-limits"), medium: lvl("undead.whole-line"), hard: lvl("undead.trial") };
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    for (let i = 0; i < 4; i++) {
      const p = await gen({ width: 5, height: 5, difficulty }, `r${i}`);
      const r = rateByTechniques(undead, undeadTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(top[difficulty]);
      if (difficulty === "medium") expect(r!.hardest.level).toBeGreaterThan(top.easy);
      if (difficulty === "hard") expect(r!.hardest.level).toBeGreaterThan(top.medium);
    }
  }
});

test("technique steps agree with the solution and never touch placed monsters", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 6, height: 6, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = undead.init(p);
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(undead, undeadTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as UndeadAction[]) {
        if (a.type === "set") for (const c of a.cells) { expect(st.monsters[c]).toBe(0); expect(a.value).toBe(sol[c]!); }
        else if (a.type === "marks") for (const c of a.cells) { expect(st.monsters[c]).toBe(0); expect(a.marks & bit(sol[c]!)).toBeTruthy(); expect(a.marks & ALL).not.toBe(ALL); }
        else throw new Error("unexpected action");
      }
      st = applyStep(undead, p, st, hit.step);
    }
    expect(undead.isSolved(p, st)).toBe(true);
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 6, height: 6, difficulty }, `names-${difficulty}`);
    let st = undead.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of undeadTechniques) {
        const step = findStep(undead, t, p, st);
        if (!step) continue;
        const all = (f: UndeadFocus) => new Set([...f.cells, ...f.because].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as UndeadFocus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as UndeadFocus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(undead, undeadTechniques, p, st);
      if (!hit) break;
      st = applyStep(undead, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(30);
});

test("auto techniques cascade inside one undo step", async () => {
  const p = await gen({ width: 5, height: 5, difficulty: "easy" }, "auto");
  const s = played(p, ["undead.totals-full", "undead.totals-need-all", "undead.sight-limits"]);
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.monsters).toEqual(p.given);
});

test("practice finds a position for every technique", async () => {
  for (const t of undeadTechniques) {
    const pos = await findPracticePosition(undead, undeadTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(undead, undeadTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
});

test("game ids round-trip and parse like the original", async () => {
  const p = await gen({ width: 7, height: 5 }, "fmt");
  const text = sgtFormat.serialize!(p);
  expect(sgtFormat.detect!(text)).toBe(true);
  expect(sgtFormat.parse(text)).toEqual(p);
  expect(sgtFormat.parse(text.replace(":", "dn:"))).toEqual(p);
  expect(() => sgtFormat.parse("2x2:1,1,1,aL,0,0,0,0,0,0,0,0")).toThrow();
  const id = "3x3:2,3,2,bLbRc,0,1,1,1,0,1,0,2,0,1,1,1";
  expect(sgtFormat.serialize!(sgtFormat.parse(id))).toBe(id);
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 4, height: 4 }, "solve");
  const ans = undead.solve!(p, undead.init(p))!;
  expect("board" in ans && undead.isSolved(p, ans.board)).toBe(true);
  expect(undead.isSolved(p, undead.init(p))).toBe(false);
});
