import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, findStep, firstStep, rateByTechniques } from "../../core/techniques";
import { bit, countSolutions, solveLevel } from "../../lib/grid-kit/csp";
import { cellName, type Focus } from "../../lib/grid-kit/names";
import {
  FULL, analyze, dominoLayout, geometry, initialDoms, isSolved, magnets, model, sgtFormat,
  type Level, type MagnetsAction, type MagnetsPuzzle,
} from "./logic";
import { checkMarks } from "./plugins";
import { magnetsTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(magnets, params, seed, sig()) as Promise<MagnetsPuzzle>;
const LEVELS = ["easy", "tricky", "hard"] as const;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 7, height: 6, difficulty: "tricky" }, "abc");
  const b = await gen({ width: 7, height: 6, difficulty: "tricky" }, "abc");
  const c = await gen({ width: 7, height: 6, difficulty: "tricky" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const strip of [false, true]) {
  for (const difficulty of LEVELS) {
    test(`${difficulty}${strip ? " with hidden numbers" : ""} puzzles are unique and need exactly ${difficulty}`, async () => {
      const want = LEVELS.indexOf(difficulty) as Level;
      for (let i = 0; i < 6; i++) {
        const p = await gen({ width: 5 + (i % 3), height: 4 + (i % 4), difficulty, strip }, `s${i}`);
        expect(solveLevel(model(p), initialDoms(p), want)).toBe(want);
        expect(countSolutions(model(p), initialDoms(p), 2).count).toBe(1);
        if (strip) expect([...p.colPlus, ...p.rowPlus, ...p.colMinus, ...p.rowMinus].some((v) => v < 0)).toBe(true);
      }
    }, 30000);
  }
}

test("domino layouts tile the board, leaving at most one lone cell", () => {
  const rng = createRng("tile");
  for (const [w, h] of [[2, 2], [3, 3], [5, 4], [7, 7], [12, 11]] as const) {
    const pair = dominoLayout(w, h, rng);
    const lone = pair.filter((o, i) => o === i).length;
    expect(lone).toBe((w * h) % 2);
    pair.forEach((o, i) => expect(pair[o]).toBe(i));
  }
});

test("tatham's examples parse, solve, and round-trip", () => {
  const ids = [
    "3x3:201,102,120,111,LRTT*BBLR",
    "5x5:.2..1,3..1.,.2..2,2..2.,LRLRTTLRTBBT*BTTBLRBBLRLR",
    "6x6:322223,323132,232223,232223,LRTLRTTTBLRBBBTTLRLRBBLRTTLRTTBBLRBB",
    "9x9:3.51...33,.2..23.13,..33.33.2,12...5.3.,**TLRTLR*,*TBLRBTLR,TBLRLRBTT,BLRTLRTBB,LRTB*TBLR,LRBLRBLRT,TTTLRLRTB,BBBTLRTB*,*LRBLRB**",
  ];
  for (const id of ids) {
    const p = sgtFormat.parse(id);
    expect(analyze(p).count).toBe(1);
    const ans = magnets.solve!(p, magnets.init(p))!;
  expect("board" in ans && isSolved(p, ans.board)).toBe(true);
    expect(sgtFormat.parse(sgtFormat.serialize!(p))).toEqual(p);
  }
  // janko's 8×8 in the same list has two solutions (a 2×2 block of magnets can swap)
  expect(analyze(sgtFormat.parse("8x8:34131323,23131334,43122323,21332243,LRTLRLRT,LRBTTTTB,LRTBBBBT,TTBTLRTB,BBTBTTBT,TTBTBBTB,BBTBLRBT,LRBLRLRB")).count).toBe(2);
  expect(() => sgtFormat.parse("3x3:201,102,120,111,LRTT*BBRL")).toThrow();
  expect(() => sgtFormat.parse("3x3:201,102,120,11,LRTT*BBLR")).toThrow();
});

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 200; t++) {
    const w = rng.range(2, 4), h = rng.range(2, 4);
    const pair = dominoLayout(w, h, rng);
    const num = (n: number) => (rng.bool(0.25) ? -1 : rng.int(Math.ceil(n / 2) + 1));
    const p: MagnetsPuzzle = { w, h, pair, colPlus: Array.from({ length: w }, () => num(h)), rowPlus: Array.from({ length: h }, () => num(w)), colMinus: Array.from({ length: w }, () => num(h)), rowMinus: Array.from({ length: h }, () => num(w)) };
    const brute = countSolutions(model(p), initialDoms(p), 2);
    const a = analyze(p);
    expect(a.count).toBe(brute.count as 0 | 1 | 2);
    if (a.count === 1) {
      solved++;
      const ans = magnets.solve!(p, magnets.init(p))!;
  expect("board" in ans && isSolved(p, ans.board)).toBe(true);
    }
  }
  expect(solved).toBeGreaterThan(5);
});

function played(p: MagnetsPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of magnetsTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(magnets, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("following hints solves boards of every difficulty; wrong marks come first", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 7, height: 6, difficulty, strip: difficulty === "tricky" }, `h-${difficulty}`);
    const { s } = played(p);
    const sol = analyze(p).solution!;
    s.dispatch({ type: "set", doms: [0], mask: FULL & ~bit(sol[0]!) });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "set", doms: [0], mask: FULL });
    for (let i = 0; i < 400 && !s.solved; i++) {
      const hnt = s.hint();
      expect(hnt?.actions?.length).toBeGreaterThan(0);
      s.batch(() => { for (const a of hnt!.actions!) s.dispatch(a); });
    }
    expect(s.solved).toBe(true);
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  const lastOf = ["magnets.count-all", "magnets.dominoes", "magnets.trial"];
  const level = (id: string) => magnetsTechniques.find((t) => t.id === id)!.level;
  for (const [i, difficulty] of LEVELS.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = await gen({ width: 7, height: 6, difficulty }, `r${j}`);
      const r = rateByTechniques(magnets, magnetsTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(level(lastOf[i]!));
      if (i > 0) expect(r!.hardest.level).toBeGreaterThan(level(lastOf[i - 1]!));
    }
  }
});

test("every technique step keeps the solution", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 7, height: 6, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = magnets.init(p);
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(magnets, magnetsTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as MagnetsAction[]) {
        expect(a.type).toBe("narrow");
        for (const d of a.doms) {
          if (a.type === "narrow") expect(a.keep & bit(sol[d]!)).toBeTruthy();
        }
      }
      st = applyStep(magnets, p, st, hit.step);
    }
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 7, height: 6, difficulty }, `names-${difficulty}`);
    let st = magnets.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of magnetsTechniques) {
        const step = findStep(magnets, t, p, st);
        if (!step) continue;
        const all = (x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as Focus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as Focus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(magnets, magnetsTechniques, p, st);
      if (!hit) break;
      st = applyStep(magnets, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(30);
});

test("techniques aim at a cell's domino", async () => {
  const p = await gen({ width: 6, height: 5, difficulty: "easy" }, "aim");
  const st = magnets.init(p);
  const g = geometry(p);
  let aimed = 0;
  for (let c = 0; c < g.n; c++) {
    for (const t of magnetsTechniques) {
      const step = t.findAt!(p, st, c);
      if (!step) continue;
      const f = step.focus as Focus;
      expect(f.cells.includes(c) || f.because.includes(c)).toBe(true);
      aimed++;
    }
  }
  expect(aimed).toBeGreaterThan(0);
});

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 6, height: 5, difficulty: "easy" }, "auto");
  const { s } = played(p, ["magnets.poles", "magnets.count-full", "magnets.count-all"]);
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.doms.every((m) => m === FULL)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of magnetsTechniques) {
    const pos = await findPracticePosition(magnets, magnetsTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(magnets, magnetsTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 30000);

test("solve() reaches a solved state; an empty board isn't solved", async () => {
  const p = await gen({ width: 8, height: 7 }, "solve");
  const ans = magnets.solve!(p, magnets.init(p))!;
  expect("board" in ans && isSolved(p, ans.board)).toBe(true);
  expect(isSolved(p, magnets.init(p))).toBe(false);
});
