import { expect, test } from "bun:test";
import type { AnyPuzzleDef, Step, Technique } from "../../core/types";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, findStep, findStepAt, firstStep, rateByTechniques, stepsAt } from "../../core/techniques";
import { edgeGrid } from "../../lib/edges";
import { CROSS, EMPTY, LINE, NONE, TRACK, cellName, sgtFormat, tracks, type TracksAction, type TracksFocus, type TracksState } from "./logic";
import { checkMarks } from "./plugins";
import { analyze, countCells, countSolutions, freshKnowledge, logicSolve, trackEdges, type Level, type TracksPuzzle } from "./solver";
import { tracksTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(tracks, params, seed, sig()) as Promise<TracksPuzzle>;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 8, height: 7, difficulty: "hard" }, "abc");
  const b = await gen({ width: 8, height: 7, difficulty: "hard" }, "abc");
  const c = await gen({ width: 8, height: 7, difficulty: "hard" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of ["easy", "medium", "hard"] as const) {
  test(`${difficulty} puzzles are unique, logic-solvable, and need exactly ${difficulty}`, async () => {
    const want = ["easy", "medium", "hard"].indexOf(difficulty) as Level;
    for (let i = 0; i < 6; i++) {
      const p = await gen({ width: 6 + (i % 3), height: 6 + (i % 2), difficulty }, `s${i}`);
      expect(logicSolve(p, want).level).toBe(want);
      if (want > 0) expect(logicSolve(p, (want - 1) as Level).level).toBeNull();
      const brute = countSolutions(p, freshKnowledge(p), 2);
      expect(brute.count).toBe(1);
      expect(analyze(p).solution).toEqual(trackEdges(brute.first!));
    }
  }, 30000);
}

test("logic never contradicts brute force on boards with pieces taken away", async () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 40; t++) {
    const base = await gen({ width: rng.range(4, 6), height: rng.range(4, 6), difficulty: "hard" }, `x${t}`);
    const given = base.given.map((v, c) => (c === base.entry * base.w || c === (base.h - 1) * base.w + base.exit || rng.bool(0.5) ? v : 0));
    const p: TracksPuzzle = { ...base, given };
    const brute = countSolutions(p, freshKnowledge(p), 2);
    const logic = logicSolve(p, 2);
    if (logic.level !== null) {
      solved++;
      expect(brute.count).toBe(1);
      expect(trackEdges(logic.k)).toEqual(trackEdges(brute.first!));
    }
    if (!logic.ok) expect(brute.count).toBe(0);
  }
  expect(solved).toBeGreaterThan(5);
});

function played(p: TracksPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of tracksTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(tracks, p, { kind: "imported" });
  new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return s;
}

test("wrong marks are pointed out first; technique steps follow", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `h-${difficulty}`);
    const s = played(p);
    const g = edgeGrid(p.w, p.h);
    const bad = analyze(p).solution!.findIndex((v, e) => v === 1 && !p.given[g.ea[e]!] && !p.given[g.eb[e]!]);
    s.dispatch({ type: "edge", edges: [bad], value: CROSS });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "edge", edges: [bad], value: NONE });
    s.dispatch({ type: "edge", edges: [bad], value: NONE });
    for (let i = 0; i < 600 && !s.solved; i++) {
      const hit = firstStep(tracks, tracksTechniques, p, s.state);
      if (!hit) break;
      s.batch(() => { for (const a of hit.step.actions as TracksAction[]) s.dispatch(a); });
    }
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  const lvl = (id: string) => tracksTechniques.find((t) => t.id === id)!.level;
  const top = { easy: lvl("tracks.no-loop"), medium: lvl("tracks.neighbours"), hard: lvl("tracks.trial") };
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    for (let i = 0; i < 3; i++) {
      const p = await gen({ width: 7, height: 7, difficulty }, `r${i}`);
      const r = rateByTechniques(tracks, tracksTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(top[difficulty]);
      if (difficulty === "medium") expect(r!.hardest.level).toBeGreaterThan(top.easy);
      if (difficulty === "hard") expect(r!.hardest.level).toBeGreaterThan(top.medium);
    }
  }
});

test("technique steps agree with the solution and never overwrite marks", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    const g = edgeGrid(p.w, p.h);
    const on = new Set<number>([p.entry * p.w, (p.h - 1) * p.w + p.exit]);
    sol.forEach((v, e) => { if (v) { on.add(g.ea[e]!); on.add(g.eb[e]!); } });
    let st = tracks.init(p);
    for (let i = 0; i < 600; i++) {
      const hit = firstStep(tracks, tracksTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as TracksAction[]) {
        if (a.type === "edge") for (const e of a.edges) { expect(st.edges[e]).toBe(NONE); expect(a.value === LINE ? 1 : 0).toBe(sol[e]!); }
        else for (const c of a.cells) { expect(st.cells[c]).toBe(NONE); expect(a.value === TRACK).toBe(on.has(c)); expect([TRACK, EMPTY]).toContain(a.value); }
      }
      st = applyStep(tracks, p, st, hit.step);
    }
    expect(tracks.isSolved(p, st)).toBe(true);
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `names-${difficulty}`);
    const g = edgeGrid(p.w, p.h);
    let st = tracks.init(p);
    for (let i = 0; i < 600; i++) {
      for (const t of tracksTechniques) {
        const step = findStep(tracks, t, p, st);
        if (!step) continue;
        const all = (f: TracksFocus) => new Set([...f.because, ...f.cells, ...f.edges.flatMap((e) => [g.ea[e]!, g.eb[e]!])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as TracksFocus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(tracks, tracksTechniques, p, st);
      if (!hit) break;
      st = applyStep(tracks, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(30);
});

test("auto techniques cascade inside one undo step", async () => {
  const p = await gen({ width: 6, height: 6, difficulty: "easy" }, "auto");
  const s = played(p, tracksTechniques.filter((t) => t.level <= 5).map((t) => t.id));
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.edges.every((v) => v === NONE)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of tracksTechniques) {
    const pos = await findPracticePosition(tracks, tracksTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(tracks, tracksTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 60000);

test("game ids round-trip and parse like the original", async () => {
  const p = await gen({ width: 8, height: 6 }, "fmt");
  const text = sgtFormat.serialize!(p);
  expect(sgtFormat.detect!(text)).toBe(true);
  expect(sgtFormat.parse(text)).toEqual(p);
  expect(sgtFormat.parse(text.replace(":", "dto:"))).toEqual(p);
  const tiny = sgtFormat.parse("2x2:5bA,S1,2,S2,1");
  expect(tiny.given).toEqual([5, 0, 0, 10]);
  expect(tiny.entry).toBe(0);
  expect(tiny.exit).toBe(0);
  expect(() => sgtFormat.parse("2x2:5bA,1,2,S2,1")).toThrow();
  expect(() => sgtFormat.parse("2x2:3bA,S1,2,S2,1")).not.toThrow();
  expect(() => sgtFormat.parse("2x2:1bA,S1,2,S2,1")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 6, height: 6 }, "solve");
  const ans = tracks.solve!(p, tracks.init(p))!;
  expect("board" in ans && tracks.isSolved(p, ans.board)).toBe(true);
  expect(tracks.isSolved(p, tracks.init(p))).toBe(false);
});

test("an aimed step at a cell changes nothing outside the line or cell it reasons about", async () => {
  let aimed = 0;
  for (const difficulty of ["easy", "medium"]) {
    const p = await gen({ width: 7, height: 7, difficulty }, `aimed-${difficulty}`);
    let st = tracks.init(p);
    for (let i = 0; i < 600; i++) {
      for (const t of tracksTechniques) {
        for (let c = 0; c < p.w * p.h; c++) {
          const step = findStepAt(tracks, t, p, st, { cell: c });
          if (!step) continue;
          aimed++;
          const f = step.focus as TracksFocus;
          const unit = new Set(f.counts?.length ? countCells(p, f.counts[0]!) : f.because);
          const cells = (step.actions as TracksAction[]).flatMap((a) => (a.type === "cell" ? a.cells : []));
          for (const x of cells) expect(unit.has(x)).toBe(true);
        }
      }
      const hit = firstStep(tracks, tracksTechniques, p, st);
      if (!hit) break;
      st = applyStep(tracks, p, st, hit.step);
    }
  }
  expect(aimed).toBeGreaterThan(30);
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
  for (const t of tracksTechniques) {
    if (t.practice === false) continue;
    const pos = await findPracticePosition(tracks, tracksTechniques, t, "aim", new AbortController().signal);
    if (!pos) continue;
    const p = pos.puzzle as any, s = pos.state as any;
    cells += checkAimed(tracks, tracksTechniques, p, s, Array.from({ length: p.w * p.h }, (_, i) => ({ cell: i })));
  }
  expect(cells).toBeGreaterThan(0);
}, 300000);

test("a cell narrowed to its row or column count aims at that count's instances only; cell-only ones are on no line", async () => {
  const cellOnlyIds = ["tracks.no-room", "tracks.through", "tracks.no-loop", "tracks.trial"];
  let both = 0, cellOnly = 0;
  for (const t of tracksTechniques) {
    const pos = await findPracticePosition(tracks, tracksTechniques, t, "line", new AbortController().signal);
    if (!pos) continue;
    const p = pos.puzzle as TracksPuzzle, st = pos.state as TracksState;
    const at = (target: unknown) => { const out: Step[] = []; t.instancesAt!(p, st, target, (x) => { out.push(x as Step); }); return out; };
    for (let c = 0; c < p.w * p.h; c++) {
      const plain = at({ cell: c });
      const lines = [p.w + Math.floor(c / p.w), c % p.w].map((count) => ({ count, steps: at({ cell: c, count }) }));
      for (const { count, steps } of lines) {
        expect(steps).toEqual(plain.filter((x) => (x.focus as TracksFocus).counts?.[0] === count));
        if (steps.length) expect(t.findAt!(p, st, { cell: c, count }) as Step | null).toEqual(steps[0]!);
        else expect(t.findAt!(p, st, { cell: c, count })).toBeNull();
      }
      if (lines.every((l) => l.steps.length)) {
        expect(plain.length).toBeGreaterThanOrEqual(2);
        both++;
      }
      if (cellOnlyIds.includes(t.id) && plain.length) {
        for (const l of lines) expect(l.steps).toEqual([]);
        cellOnly++;
      }
    }
  }
  expect(both).toBeGreaterThan(0);
  expect(cellOnly).toBeGreaterThan(0);
}, 300000);
