import { expect, test } from "bun:test";
import type { Step } from "../../core/types";
import { work } from "../../lib/work";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, findStep, findStepAt, rateByTechniques } from "../../core/techniques";
import { bit, countSolutions, solveLevel } from "../../lib/grid-kit/csp";
import { cellName, type Focus } from "../../lib/grid-kit/names";
import {
  analyze, combosFor, fillDigits, findConflicts, geometry, initialDoms, isSolved, kakuro, makeLayout, model, pzprFormat, textFormat, withSums,
  type KakuroAction, type KakuroPuzzle, type KakuroState, type Level,
} from "./logic";
import { checkMarks } from "./plugins";
import { kakuroTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(kakuro, params, seed, sig()) as Promise<KakuroPuzzle>;
const LEVELS = ["easy", "medium", "hard"] as const;
const firstWhite = (p: KakuroPuzzle) => p.white.indexOf(true);

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 6, height: 6, difficulty: "medium" }, "abc");
  const b = await gen({ width: 6, height: 6, difficulty: "medium" }, "abc");
  const c = await gen({ width: 6, height: 6, difficulty: "medium" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of LEVELS) {
  test(`${difficulty} puzzles are unique and need exactly ${difficulty}`, async () => {
    const want = LEVELS.indexOf(difficulty) as Level;
    for (let i = 0; i < 5; i++) {
      const p = await gen({ width: 5 + (i % 3), height: 6 + (i % 2), difficulty }, `s${i}`);
      expect(solveLevel(model(p), initialDoms(p), want)).toBe(want);
      expect(countSolutions(model(p), initialDoms(p), 2).count).toBe(1);
    }
  }, 60000);
}

test("every preset generates within its work budget", async () => {
  for (const preset of kakuro.presets!) {
    const before = work.units;
    const p = await gen(preset.params, `preset-${preset.label}`);
    expect(work.units - before).toBeLessThan(4_000_000);
    expect(analyze(p).count).toBe(1);
  }
}, 60000);

test("layouts: clue row and column, runs of 2 to 9, symmetric, joined", () => {
  const rng = createRng("layouts");
  for (const [w, h] of [[7, 7], [9, 9], [11, 13]] as const) {
    let white: boolean[] | null = null;
    for (let t = 0; !white && t < 1000; t++) white = makeLayout(w, h, rng);
    expect(white).not.toBeNull();
    const p = withSums(w, h, white!, white!.map(() => 0));
    for (let c = 0; c < w * h; c++) {
      if (c < w || c % w === 0) expect(white![c]).toBe(false);
      const y = Math.floor(c / w), x = c % w;
      if (y > 0 && x > 0) expect(white![(h - y) * w + (w - x)]).toBe(white![c]!);
    }
    const g = geometry(p);
    for (const r of g.runs) expect(r.cells.length).toBeGreaterThanOrEqual(2);
    for (const r of g.runs) expect(r.cells.length).toBeLessThanOrEqual(9);
    for (const c of g.whites) expect(g.runsOf[c]!.length).toBe(2);
  }
});

test("pzprjs's sample solves to its published answer and round-trips", () => {
  const url = "https://puzz.link/p?kakuro/5/5/48la0.na0lh3l0Bn.0cl.c4a3";
  const p = pzprFormat.parse(url);
  const a = analyze(p);
  expect(a.count).toBe(1);
  const inner = [];
  for (let y = 1; y < p.h; y++) inner.push(a.solution!.slice(y * p.w + 1, (y + 1) * p.w).join(""));
  expect(inner).toEqual(["05300", "34120", "12012", "01938", "00840"]);
  expect(pzprFormat.serialize!(p)).toBe(url);
});

test("formats round-trip generated puzzles", async () => {
  const p = await gen({ width: 8, height: 7, difficulty: "easy" }, "fmt");
  expect(pzprFormat.parse(pzprFormat.serialize!(p))).toEqual(p);
  expect(textFormat.parse(textFormat.serialize!(p))).toEqual(p);
  expect(textFormat.detect!(textFormat.serialize!(p))).toBe(true);
  expect(() => textFormat.parse("# #\n# 3\\")).toThrow();
  expect(() => textFormat.parse("# \\\n\\18 .")).toThrow();
});

test("sum combinations", () => {
  expect(combosFor(2, 3)).toEqual([bit(1) | bit(2)]);
  expect(combosFor(9, 45)).toHaveLength(1);
  expect(combosFor(2, 18)).toEqual([]);
  expect(combosFor(3, 0)).toHaveLength(84);
});

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  const seen = [0, 0, 0];
  for (let t = 0; t < 400; t++) {
    const w = rng.range(4, 5), h = rng.range(4, 5);
    let white: boolean[] | null = null;
    for (let i = 0; !white && i < 1000; i++) white = makeLayout(w, h, rng);
    if (!white) continue;
    const digits = fillDigits(geometry(withSums(w, h, white, white.map(() => 0))), rng);
    if (!digits) continue;
    const base = withSums(w, h, white, digits);
    const across = base.across.slice(), down = base.down.slice();
    // nudging one sum gives some boards no solution
    if (rng.bool(0.5)) {
      const r = rng.pick(geometry(base).runs);
      const sums = r.dir === "across" ? across : down;
      sums[r.clue] = sums[r.clue]! + (rng.bool(0.5) ? 1 : -1);
    }
    const p: KakuroPuzzle = { ...base, across, down };
    const brute = countSolutions(model(p), initialDoms(p), 2);
    const a = analyze(p);
    expect(a.count).toBe(brute.count as 0 | 1 | 2);
    seen[a.count]!++;
    if (a.count === 1) {
      const ans = kakuro.solve!(p, kakuro.init(p))!;
      expect("board" in ans && isSolved(p, ans.board)).toBe(true);
    }
  }
  expect(seen[0]).toBeGreaterThan(10);
  expect(seen[1]).toBeGreaterThan(0);
  expect(seen[2]).toBeGreaterThan(10);
});

test("conflicts: repeated digits and wrong sums", () => {
  const p = textFormat.parse("# 4\\ 3\\\n\\3 . .\n\\4 . .");
  const set = (cells: number[]) => p.white.map((w, c) => (w ? (cells[c] ? bit(cells[c]!) : 0b1111111110) : 1));
  expect(findConflicts(p, set([0, 0, 0, 0, 1, 1, 0, 0, 0])).repeats).toEqual([4, 5]);
  expect(findConflicts(p, set([0, 0, 0, 0, 1, 2, 0, 3, 3])).sums.sort()).toEqual([5, 7, 8]);
  const solved = set([0, 0, 0, 0, 1, 2, 0, 3, 1]);
  expect(isSolved(p, { doms: solved })).toBe(true);
});

function played(p: KakuroPuzzle, auto: string[] = []) {
  const registry = new Registry();
  registry.puzzle(kakuro);
  for (const t of kakuroTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(kakuro, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("a wrong mark is cleared by the hint first, then technique steps apply", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 6, height: 6, difficulty }, `h-${difficulty}`);
    const { s } = played(p);
    const sol = analyze(p).solution!;
    const bad = firstWhite(p);
    s.dispatch({ type: "set", cells: [bad], mask: bit(sol[bad] === 1 ? 2 : 1) });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "clear", cells: [bad] });
    for (let i = 0; i < 600; i++) {
      const hit = firstStep(kakuro, kakuroTechniques, p, s.state);
      if (!hit) break;
      s.batch(() => { for (const a of hit.step.actions as KakuroAction[]) s.dispatch(a); });
    }
  }
}, 60000);

test("rating by techniques matches the generator's difficulty", async () => {
  const lastOf = ["kakuro.combos", "kakuro.fit", "kakuro.trial"];
  const level = (id: string) => kakuroTechniques.find((t) => t.id === id)!.level;
  for (const [i, difficulty] of LEVELS.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = await gen({ width: 6, height: 6, difficulty }, `r${j}`);
      const r = rateByTechniques(kakuro, kakuroTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(level(lastOf[i]!));
      if (i > 0) expect(r!.hardest.level).toBeGreaterThan(level(lastOf[i - 1]!));
    }
  }
}, 60000);

test("every technique step keeps the solution", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 6, height: 6, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = kakuro.init(p);
    for (let i = 0; i < 600; i++) {
      const hit = firstStep(kakuro, kakuroTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as KakuroAction[]) {
        expect(a.type).toBe("narrow");
        for (const c of a.cells) {
          if (a.type === "narrow") expect(a.keep & bit(sol[c]!)).toBeTruthy();
        }
      }
      st = applyStep(kakuro, p, st, hit.step);
    }
  }
}, 60000);

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 6, height: 6, difficulty }, `names-${difficulty}`);
    let st = kakuro.init(p);
    for (let i = 0; i < 300; i++) {
      for (const t of kakuroTechniques) {
        const step = findStep(kakuro, t, p, st);
        if (!step) continue;
        const all = (x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as Focus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as Focus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(kakuro, kakuroTechniques, p, st);
      if (!hit) break;
      st = applyStep(kakuro, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(50);
}, 60000);

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 6, height: 6, difficulty: "easy" }, "auto");
  const { s } = played(p, kakuroTechniques.slice(0, 3).map((t) => t.id));
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.doms).toEqual(kakuro.init(p).doms);
});

test("practice finds a position for every technique", async () => {
  for (const t of kakuroTechniques) {
    const pos = await findPracticePosition(kakuro, kakuroTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(kakuro, kakuroTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 60000);

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 7, height: 6 }, "solve");
  const ans = kakuro.solve!(p, kakuro.init(p))!;
  expect("board" in ans && isSolved(p, ans.board)).toBe(true);
  expect(isSolved(p, kakuro.init(p))).toBe(false);
});

test("an aimed step at a cell changes only cells of one run holding it", async () => {
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 6, height: 6, difficulty }, `aimed-${difficulty}`);
    const g = geometry(p);
    let st = kakuro.init(p);
    for (let i = 0; i < 40; i++) {
      for (const c of g.whites) {
        const holding = g.runsOf[c]!.map((r) => new Set(g.runs[r]!.cells));
        for (const t of kakuroTechniques) {
          const step = findStepAt(kakuro, t, p, st, c);
          if (!step) continue;
          const cells = (step.actions as KakuroAction[]).flatMap((a) => (a.type === "narrow" ? a.cells : []));
          expect(cells.length).toBeGreaterThan(0);
          expect(holding.some((run) => cells.every((x) => run.has(x))) || cells.every((x) => x === c)).toBe(true);
          seen++;
        }
      }
      const hit = firstStep(kakuro, kakuroTechniques, p, st);
      if (!hit) break;
      st = applyStep(kakuro, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(50);
}, 60000);

test("a cell narrowed to its across or down run aims at that run's instances only; cell-only ones are on no run", async () => {
  let both = 0, cellOnly = 0;
  for (const t of kakuroTechniques) {
    const pos = await findPracticePosition(kakuro, kakuroTechniques, t, "line", new AbortController().signal);
    if (!pos) continue;
    const p = pos.puzzle as KakuroPuzzle, st = pos.state as KakuroState;
    const g = geometry(p);
    const at = (target: unknown) => { const out: Step[] = []; t.instancesAt!(p, st, target, (x) => { out.push(x as Step); }); return out; };
    const about = (x: Step, clue: number) => { const f = x.focus as Focus; return f.because.includes(clue) || (f.related ?? []).includes(clue); };
    for (const c of g.whites) {
      const plain = at(c);
      const lines = g.runsOf[c]!.map((r) => ({ r, steps: at({ cell: c, run: r }) }));
      for (const { r, steps } of lines) {
        expect(steps).toEqual(plain.filter((x) => about(x, g.runs[r]!.clue)));
        if (steps.length) expect(t.findAt!(p, st, { cell: c, run: r }) as Step | null).toEqual(steps[0]!);
        else expect(t.findAt!(p, st, { cell: c, run: r })).toBeNull();
      }
      if (lines.length === 2 && lines.every((l) => l.steps.length)) {
        expect(plain.length).toBeGreaterThanOrEqual(2);
        both++;
      }
      const off = plain.filter((x) => lines.every((l) => !l.steps.some((y) => JSON.stringify(y) === JSON.stringify(x))));
      if (off.length) {
        expect(t.id).toBe("kakuro.trial");
        cellOnly++;
      }
    }
  }
  expect(both).toBeGreaterThan(0);
  expect(cellOnly).toBeGreaterThan(0);
}, 300000);
