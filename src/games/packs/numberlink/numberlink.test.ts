import { expect, test } from "bun:test";
import { CAST_BAND, sideAt } from "../../lib/edge-hit";
import { DOWN, LEFT, RIGHT, UP } from "../../lib/edges";
import type { AnyPuzzleDef, Step, Technique } from "../../core/types";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, rateByTechniques, stepsAt } from "../../core/techniques";
import { edgeGrid } from "../../lib/edges";
import { cellName } from "../../lib/grid-kit/names";
import { CROSS, LINE, NONE, gridFormat, numberlink, pairName, puzzlinkFormat, type NumberlinkAction, type NumberlinkFocus } from "./logic";
import { numberlinkPlugins } from "./plugins";
import { analyze, countSolutions, freshKnowledge, logicSolve, type NumberlinkPuzzle } from "./solver";
import { numberlinkTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(numberlink, params, seed, sig()) as Promise<NumberlinkPuzzle>;
const lines = (k: { e: Int8Array }) => Array.from(k.e, (v) => (v === LINE ? 1 : 0));
const techniques = (p: NumberlinkPuzzle) => numberlinkTechniques.filter((t) => !t.requires || t.requires.every((f) => numberlink.features!(p).includes(f)));

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 8, height: 7, difficulty: "hard" }, "abc");
  expect(await gen({ width: 8, height: 7, difficulty: "hard" }, "abc")).toEqual(a);
  expect(await gen({ width: 8, height: 7, difficulty: "hard" }, "abd")).not.toEqual(a);
});

for (const difficulty of ["easy", "medium", "hard"] as const) {
  test(`${difficulty} puzzles are unique and logic-solvable at their level`, async () => {
    const top = [4, 5, 6][["easy", "medium", "hard"].indexOf(difficulty)]!;
    let exact = 0;
    for (let i = 0; i < 6; i++) {
      const p = await gen({ width: 6 + (i % 3), height: 6 + (i % 2), difficulty }, `s${i}`);
      const r = logicSolve(p, top);
      expect(r.level).not.toBeNull();
      if (difficulty === "easy" || logicSolve(p, top - 1).level === null) exact++;
      const brute = countSolutions(p, freshKnowledge(p), 2);
      expect(brute.count).toBe(1);
      expect(lines(r.k)).toEqual(lines(brute.first!));
      const ans = numberlink.solve!(p, numberlink.init(p))!;
      expect("board" in ans && numberlink.isSolved(p, ans.board)).toBe(true);
    }
    expect(exact).toBeGreaterThanOrEqual(4);
  }, 60000);
}

test("logic never contradicts brute force, on filled and open boards", async () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 40; t++) {
    const w = rng.range(4, 6), h = rng.range(4, 6);
    const base = await gen({ width: w, height: h, difficulty: "easy" }, `x${t}`);
    const p: NumberlinkPuzzle = { ...base, fill: rng.bool() };
    const brute = countSolutions(p, freshKnowledge(p), 2);
    const logic = logicSolve(p, 6);
    if (logic.level !== null) {
      solved++;
      expect(brute.count).toBe(1);
      expect(lines(logic.k)).toEqual(lines(brute.first!));
    }
    if (!logic.ok) expect(brute.count).toBe(0);
  }
  expect(solved).toBeGreaterThan(10);
}, 30000);

function played(p: NumberlinkPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of techniques(p)) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(numberlink, p, { kind: "imported" });
  new TechniqueHost(registry, s);
  numberlinkPlugins[1]!.setup!({ session: s, settings: {}, owner: "check" });
  return s;
}

test("wrong marks come first; technique steps apply", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `h-${difficulty}`);
    const s = played(p);
    const bad = analyze(p).solution!.findIndex((v) => v === 1);
    s.dispatch({ type: "edge", edges: [bad], value: CROSS });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "edge", edges: [bad], value: NONE });
    s.dispatch({ type: "edge", edges: [bad], value: NONE });
    for (let i = 0; i < 600 && !s.solved; i++) {
      const hit = firstStep(numberlink, techniques(p), p, s.state);
      if (!hit) break;
      s.batch(() => { for (const a of hit.step.actions) s.dispatch(a as NumberlinkAction); });
    }
  }
}, 30000);

test("rating by techniques stays within the generator's difficulty", async () => {
  const top = { easy: 4, medium: 5, hard: 6 };
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    for (let i = 0; i < 3; i++) {
      const p = await gen({ width: 7, height: 7, difficulty }, `r${i}`);
      const r = rateByTechniques(numberlink, techniques(p), p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(top[difficulty]);
    }
  }
}, 30000);

test("technique steps agree with the solution and every named cell is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 8, height: 8, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    const g = edgeGrid(p.w, p.h);
    const list = techniques(p);
    let st = numberlink.init(p);
    for (let i = 0; i < 600; i++) {
      const hit = firstStep(numberlink, list, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as NumberlinkAction[]) {
        for (const e of a.edges) { expect(st.edges[e]).toBe(NONE); expect(a.value === LINE ? 1 : 0).toBe(sol[e]!); }
      }
      const f = hit.step.focus as NumberlinkFocus;
      const shown = new Set([...f.because, ...f.cells, ...(f.edges ?? []).flatMap((e) => [g.ea[e]!, g.eb[e]!])].map((c) => cellName(p, c)));
      for (const n of names(hit.step.message)) expect(shown.has(n)).toBe(true);
      st = applyStep(numberlink, p, st, hit.step);
    }
    expect(numberlink.isSolved(p, st)).toBe(true);
  }
}, 30000);

test("auto techniques cascade inside one undo step", async () => {
  const p = await gen({ width: 6, height: 6, difficulty: "easy" }, "auto");
  const s = played(p, numberlinkTechniques.map((t) => t.id));
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.edges.every((v) => v === NONE)).toBe(true);
});

test("practice finds a position for every technique that has practice", async () => {
  for (const t of numberlinkTechniques) {
    if (t.practice === false) continue;
    const pos = await findPracticePosition(numberlink, numberlinkTechniques.filter((x) => !x.requires?.includes("gaps")), t, "practice", sig());
    expect(pos).not.toBeNull();
  }
}, 60000);

test("formats round-trip; puzz.link urls parse like pzprjs", async () => {
  const p = await gen({ width: 8, height: 6 }, "fmt");
  const text = gridFormat.serialize!(p);
  expect(gridFormat.parse(text)).toEqual(p);
  const open = { ...p, fill: false };
  expect(gridFormat.parse(gridFormat.serialize!(open))).toEqual(open);
  expect(puzzlinkFormat.parse(puzzlinkFormat.serialize!(open))).toEqual(open);
  expect(() => puzzlinkFormat.serialize!(p)).toThrow();
  const q = puzzlinkFormat.parse("https://puzz.link/p?numlin/5/5/1j2h3m1h2j3");
  expect(q.fill).toBe(false);
  expect(q.dots).toEqual([1, 0, 0, 0, 0, 2, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 3]);
  expect(analyze(q).count).toBe(1);
  expect(gridFormat.parse("AB.\n...\nA.B").dots).toEqual([1, 2, 0, 0, 0, 0, 1, 0, 2]);
  expect(() => gridFormat.parse("A..\n...\n..B")).toThrow();
  expect(() => puzzlinkFormat.parse("https://puzz.link/p?numlin/2/2/1.1g")).toThrow();
});

test("solved check and history descriptions", async () => {
  const p = await gen({ width: 5, height: 5, difficulty: "easy" }, "desc");
  expect(numberlink.isSolved(p, numberlink.init(p))).toBe(false);
  const g = edgeGrid(p.w, p.h);
  const dot = p.dots.findIndex(Boolean);
  const e = [0, 1, 2, 3].map((d) => g.cellEdge[dot * 4 + d]!).find((x) => x >= 0 && !p.dots[g.ea[x]!] !== !p.dots[g.eb[x]!])!;
  const s0 = numberlink.init(p);
  const s1 = numberlink.reduce(p, s0, { type: "edge", edges: [e], value: LINE });
  expect(numberlink.describeAction!(p, { type: "edge", edges: [e], value: LINE }, s0, s1)).toBe(`${pairName(p.dots[dot]!)} line`);
  expect(numberlink.describeAction!(p, { type: "edge", edges: [e], value: NONE }, s1, s0)).toBe(`erase ${pairName(p.dots[dot]!)} line`);
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
  for (const t of numberlinkTechniques) {
    if (t.practice === false) continue;
    const pos = await findPracticePosition(numberlink, numberlinkTechniques, t, "aim", new AbortController().signal);
    if (!pos) continue;
    const p = pos.puzzle as any, s = pos.state as any;
    cells += checkAimed(numberlink, numberlinkTechniques, p, s, Array.from({ length: p.w * p.h }, (_, i) => ({ cell: i })));
  }
  expect(cells).toBeGreaterThan(0);
}, 300000);

const edgesOf = (x: Step) => (x.actions as NumberlinkAction[]).flatMap((a) => a.edges);
const cellsOf = (_x: Step): number[] => [];

test("a technique that tests one edge at a time: an edge target gives only that edge's test, a cell target none", async () => {
  let edges = 0;
  for (const t of numberlinkTechniques) {
    if (!["numberlink.colors", "numberlink.no-loop", "numberlink.reach", "numberlink.trial"].includes(t.id) || t.practice === false) continue;
    const pos = await findPracticePosition(numberlink, numberlinkTechniques, t, "edge", new AbortController().signal);
    if (!pos) continue;
    const p = pos.puzzle as any, st = pos.state as any;
    const at = (target: unknown) => { const out: Step[] = []; t.instancesAt!(p, st, target, (x) => { out.push(x as Step); }); return out; };
    for (let e = 0; e < edgeGrid(p.w, p.h).ne; e++) {
      const onEdge = at({ edge: e });
      if (!onEdge.length) continue;
      edges++;
      for (const x of onEdge) {
        expect(edgesOf(x)).toEqual([e]);
        expect(cellsOf(x)).toEqual([]);
      }
      expect(t.cellAt!(p, st, { edge: e }) as Step | null).toEqual(t.findAt!(p, st, { edge: e }) as Step | null);
      for (const c of [edgeGrid(p.w, p.h).ea[e]!, edgeGrid(p.w, p.h).eb[e]!]) {
        const onCell = at({ cell: c });
        expect(onCell).toEqual([]);
      }
    }
  }
  expect(edges).toBeGreaterThan(0);
}, 300000);

test("the casting band: the middle of a cell is the cell, within 30% of an edge is that edge, the nearest one at a corner", () => {
  const all = () => true;
  expect(sideAt(0.5, 0.5, CAST_BAND, all)).toBe(-1);
  expect(sideAt(0.31, 0.69, CAST_BAND, all)).toBe(-1);
  expect(sideAt(0.29, 0.5, CAST_BAND, all)).toBe(LEFT);
  expect(sideAt(0.75, 0.5, CAST_BAND, all)).toBe(RIGHT);
  expect(sideAt(0.5, 0.1, CAST_BAND, all)).toBe(UP);
  expect(sideAt(0.5, 0.95, CAST_BAND, all)).toBe(DOWN);
  expect(sideAt(0.05, 0.2, CAST_BAND, all)).toBe(LEFT);
  expect(sideAt(0.2, 0.05, CAST_BAND, all)).toBe(UP);
  expect(sideAt(0.1, 0.1, CAST_BAND, all)).toBe(UP);
  expect(sideAt(0.05, 0.2, CAST_BAND, (d) => d !== LEFT)).toBe(UP);
  expect(sideAt(0.05, 0.5, CAST_BAND, (d) => d !== LEFT)).toBe(-1);
});
