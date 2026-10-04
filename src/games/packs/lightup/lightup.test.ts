import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { Registry } from "../../core/registry";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import { BLACK, EMPTY, geometry, litCounts, type LightupPuzzle } from "./grid";
import { BULB, DOT, NONE, cellList, cellName, gridFormat, lightup, sgtFormat, type LightupAction, type LightupFocus } from "./logic";
import { checkMarks } from "./plugins";
import { LIGHT, analyze, countSolutions, freshKnowledge, logicSolve, type Level } from "./solver";
import { lightupTechniques } from "./techniques";

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

/** A session with the pack's techniques and hint check attached the way the shell does it. */
function played(p: LightupPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of lightupTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(lightup, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

const solution = (p: LightupPuzzle) => analyze(p).solution!;

test("following hints solves boards of every difficulty; wrong marks come first", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 10, height: 10, difficulty }, `h-${difficulty}`);
    const { s } = played(p);
    const bad = p.cells.findIndex((v, c) => v === EMPTY && solution(p)[c] === 0);
    s.dispatch({ type: "set", cells: [bad], value: BULB });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "set", cells: [bad], value: NONE });
    for (let i = 0; i < 400 && !s.solved; i++) {
      const hnt = s.hint();
      expect(hnt?.actions?.length).toBeGreaterThan(0);
      s.batch(() => { for (const a of hnt!.actions!) s.dispatch(a); });
    }
    expect(s.solved).toBe(true);
  }
});

test("each difficulty needs its techniques: rating by techniques matches the generator", async () => {
  const want = { easy: "lightup.only-source", medium: "lightup.crowds", hard: "lightup.trial" } as const;
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    for (let i = 0; i < 4; i++) {
      const p = await gen({ width: 9, height: 9, difficulty }, `r${i}`);
      const r = rateByTechniques(lightup, lightupTechniques, p);
      expect(r).not.toBeNull();
      const lvl = r!.hardest.level;
      expect(lvl).toBeLessThanOrEqual(lightupTechniques.find((t) => t.id === want[difficulty])!.level);
      if (difficulty !== "easy") expect(lvl).toBeGreaterThan(lightupTechniques.find((t) => t.id === want[difficulty === "medium" ? "easy" : "medium"])!.level);
    }
  }
});

test("every technique step agrees with the solution, and steps never touch marked or lit cells", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 9, height: 9, difficulty }, `sound-${difficulty}`);
    const sol = solution(p);
    let st = lightup.init(p);
    const rng = createRng(`noise-${difficulty}`);
    // a wrong light and a wrong mark the techniques must not build on
    const wrongLight = geometry(p).empties.find((c) => sol[c] === 0 && rng.bool(0.3))!;
    st = lightup.reduce(p, st, { type: "set", cells: [wrongLight], value: BULB });
    const lit = () => litCounts(geometry(p), st.marks);
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(lightup, lightupTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as LightupAction[]) {
        for (const c of a.cells) {
          expect(st.marks[c]).toBe(NONE);
          expect(lit()[c]).toBe(0);
          expect(a.value === BULB ? 1 : 0).toBe(sol[c]!);
        }
      }
      st = applyStep(lightup, p, st, hit.step);
    }
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 9, height: 9, difficulty }, `names-${difficulty}`);
    let st = lightup.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of lightupTechniques) {
        const step = t.find(p, st);
        if (!step) continue;
        const f = step.focus as LightupFocus, nf = step.nudgeFocus as LightupFocus;
        const all = (x: LightupFocus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(f).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(nf).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(lightup, lightupTechniques, p, st);
      if (!hit) break;
      st = applyStep(lightup, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(50);
});

test("cells are named like the board labels", () => {
  expect(cellName({ w: 10 }, 0)).toBe("A1");
  expect(cellName({ w: 10 }, 42)).toBe("C5");
  expect(cellList({ w: 10 }, [0, 1, 2, 3, 4])).toBe("A1, B1, C1 and 2 more");
  expect(cellList({ w: 10 }, [0, 1])).toBe("A1 and B1");
});

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 8, height: 8, difficulty: "easy" }, "auto");
  const { s } = played(p, ["lightup.finished", "lightup.needs-all", "lightup.only-source"]);
  expect(s.solved).toBe(false);
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.marks.every((m) => m === NONE)).toBe(true);
});

test("clearing a mark is a retraction: auto doesn't put it straight back", () => {
  const p = gridFormat.parse("...\n.0.\n...");
  const { s } = played(p, ["lightup.finished"]);
  s.settle(true);
  expect(s.state.marks[1]).toBe(DOT);
  s.dispatch({ type: "set", cells: [1], value: NONE });
  expect(s.state.marks[1]).toBe(NONE);
  expect(lightup.isRetraction!({ type: "set", cells: [1], value: NONE })).toBe(true);
  expect(lightup.isRetraction!({ type: "set", cells: [1], value: DOT })).toBe(false);
});

test("practice finds a position for every technique", async () => {
  for (const t of lightupTechniques) {
    const pos = await findPracticePosition(lightup, lightupTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(lightup, lightupTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
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
