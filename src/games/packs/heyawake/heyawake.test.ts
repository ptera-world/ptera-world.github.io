import { expect, test } from "bun:test";
import { work } from "../../lib/work";
import { generate } from "../../core/generate";
import { createRng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, findStep, rateByTechniques } from "../../core/techniques";
import { countSolutions, solveLevel } from "../../lib/grid-kit/csp";
import { cellName, type Focus } from "../../lib/grid-kit/names";
import { BLACK, DOT, NONE, SHADED, type ShadeAction } from "../../lib/shade-kit/state";
import {
  analyze, cutRooms, findConflicts, geometry, heyawake, initialDoms, isSolved, model, pzprFormat, textFormat,
  type HeyawakePuzzle, type Level,
} from "./logic";
import { checkMarks } from "./plugins";
import { heyawakeTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(heyawake, params, seed, sig()) as Promise<HeyawakePuzzle>;
const LEVELS = ["easy", "normal", "hard"] as const;

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ width: 7, height: 7, difficulty: "normal" }, "abc");
  const b = await gen({ width: 7, height: 7, difficulty: "normal" }, "abc");
  const c = await gen({ width: 7, height: 7, difficulty: "normal" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of LEVELS) {
  test(`${difficulty} puzzles are unique, rectangular, and need exactly ${difficulty}`, async () => {
    const want = LEVELS.indexOf(difficulty) as Level;
    for (let i = 0; i < 6; i++) {
      const p = await gen({ width: 6 + (i % 3), height: 6 + (i % 2), difficulty }, `s${i}`);
      expect(solveLevel(model(p), initialDoms(p), want)).toBe(want);
      expect(countSolutions(model(p), initialDoms(p), 2).count).toBe(1);
      for (const cells of geometry(p).cells) {
        const xs = cells.map((c) => c % p.w), ys = cells.map((c) => Math.floor(c / p.w));
        expect((Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1)).toBe(cells.length);
      }
    }
  }, 30000);
}

test("every preset generates within its work budget", async () => {
  for (const preset of heyawake.presets!) {
    const before = work.units;
    const p = await gen(preset.params, `preset-${preset.label}`);
    expect(analyze(p).count).toBe(1);
    expect(work.units - before).toBeLessThan(2_000_000);
  }
}, 60000);

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 300; t++) {
    const w = rng.range(3, 5), h = rng.range(3, 5);
    const rooms = cutRooms(w, h, rng, 6);
    const count = rooms.reduce((a, r) => Math.max(a, r + 1), 0);
    const p: HeyawakePuzzle = { w, h, rooms, clues: Array.from({ length: count }, () => (rng.bool(0.6) ? rng.range(0, 2) : -1)) };
    const brute = countSolutions(model(p), initialDoms(p), 2);
    const a = analyze(p);
    expect(a.count).toBe(brute.count as 0 | 1 | 2);
    if (a.count === 1) {
      solved++;
      const ans = heyawake.solve!(p, heyawake.init(p))!;
      expect("board" in ans && isSolved(p, ans.board)).toBe(true);
    }
  }
  expect(solved).toBeGreaterThan(5);
});

function played(p: HeyawakePuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of heyawakeTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(heyawake, p, { kind: "imported" });
  const host = new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return { s, host };
}

test("a wrong mark is cleared by the hint first; technique steps keep producing actions", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty }, `h-${difficulty}`);
    const { s } = played(p);
    const sol = analyze(p).solution!;
    const bad = sol.findIndex((v) => v !== SHADED);
    s.dispatch({ type: "set", cells: [bad], value: BLACK });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "set", cells: [bad], value: NONE });
    let st = heyawake.init(p);
    for (let i = 0; i < 600; i++) {
      const hit = firstStep(heyawake, heyawakeTechniques, p, st);
      if (!hit) break;
      expect(hit.step.actions.length).toBeGreaterThan(0);
      st = applyStep(heyawake, p, st, hit.step);
    }
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  const lastOf = ["heyawake.span", "heyawake.split", "heyawake.trial"];
  const level = (id: string) => heyawakeTechniques.find((t) => t.id === id)!.level;
  for (const [i, difficulty] of LEVELS.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = await gen({ width: 8, height: 8, difficulty }, `r${j}`);
      const r = rateByTechniques(heyawake, heyawakeTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(level(lastOf[i]!));
      if (i > 0) expect(r!.hardest.level).toBeGreaterThan(level(lastOf[i - 1]!));
    }
  }
});

test("every technique step agrees with the solution and never touches marked cells", async () => {
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = heyawake.init(p);
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(heyawake, heyawakeTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as ShadeAction[]) {
        for (const c of a.cells) {
          expect(st.marks[c]).toBe(NONE);
          expect(a.value === BLACK ? SHADED : 0).toBe(sol[c]!);
        }
      }
      st = applyStep(heyawake, p, st, hit.step);
    }
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of LEVELS) {
    const p = await gen({ width: 8, height: 8, difficulty }, `names-${difficulty}`);
    let st = heyawake.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of heyawakeTechniques) {
        const step = findStep(heyawake, t, p, st);
        if (!step) continue;
        const all = (x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as Focus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as Focus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(heyawake, heyawakeTechniques, p, st);
      if (!hit) break;
      st = applyStep(heyawake, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(50);
});

test("auto techniques cascade inside the move that triggered them, as one undo step", async () => {
  const p = await gen({ width: 7, height: 7, difficulty: "easy" }, "auto");
  const { s } = played(p, heyawakeTechniques.slice(0, 4).map((t) => t.id));
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.marks.every((m) => m === NONE)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of heyawakeTechniques) {
    const pos = await findPracticePosition(heyawake, heyawakeTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(heyawake, heyawakeTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
}, 60000);

test("conflicts flag touching shaded cells, overfull rooms, dotted runs across two walls, and cut-off cells", () => {
  // rooms: AAB / AAB / CCB ; the B column is one room, C a 1×2 room
  const p: HeyawakePuzzle = { w: 3, h: 3, rooms: [0, 0, 1, 0, 0, 1, 2, 2, 1], clues: [1, -1, 0] };
  const marks = Array.from({ length: 9 }, () => NONE);
  marks[0] = marks[1] = BLACK;
  const c = findConflicts(p, marks);
  expect(c.touching).toEqual([0, 1]);
  expect(c.rooms).toEqual([0]);
  expect(findConflicts({ w: 3, h: 3, rooms: [0, 1, 2, 0, 1, 2, 0, 1, 2], clues: [-1, -1, -1] }, [DOT, DOT, DOT, 0, 0, 0, 0, 0, 0]).runs).toEqual([0, 1, 2]);
  const cut = Array.from({ length: 9 }, () => NONE);
  cut[1] = cut[3] = BLACK;
  expect(findConflicts(p, cut).cut).toEqual([0]);
});

test("puzz.link URLs and the text format round-trip", async () => {
  const p = await gen({ width: 8, height: 7 }, "fmt");
  expect(pzprFormat.parse(pzprFormat.serialize!(p))).toEqual(p);
  expect(textFormat.parse(textFormat.serialize!(p))).toEqual(p);
  expect(pzprFormat.detect!(pzprFormat.serialize!(p))).toBe(true);
  expect(textFormat.detect!(textFormat.serialize!(p))).toBe(true);
  expect(() => pzprFormat.parse("https://puzz.link/p?heyawake/4/4/")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 8, height: 8 }, "solve");
  const ans = heyawake.solve!(p, heyawake.init(p))!;
  expect("board" in ans && isSolved(p, ans.board)).toBe(true);
  expect(isSolved(p, heyawake.init(p))).toBe(false);
});
