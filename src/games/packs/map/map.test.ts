import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import { geometry, randomColouring, randomMap, renumber, type MapPuzzle } from "./grid";
import { map, sgtFormat, type MapAction, type MapFocus } from "./logic";
import { checkMarks } from "./plugins";
import { analyze, countSolutions, logicSolve, startKnowledge, type Level } from "./solver";
import { mapTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(map, params, seed, sig()) as Promise<MapPuzzle>;
const MID = { width: 14, height: 10, regions: 22 };

test("generation is deterministic per (params, seed)", async () => {
  const a = await gen({ ...MID, difficulty: "hard" }, "abc");
  const b = await gen({ ...MID, difficulty: "hard" }, "abc");
  const c = await gen({ ...MID, difficulty: "hard" }, "abd");
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
});

for (const difficulty of ["easy", "medium", "hard"] as const) {
  test(`${difficulty} maps are unique, logic-solvable, and need exactly ${difficulty}`, async () => {
    const want = ["easy", "medium", "hard"].indexOf(difficulty) as Level;
    for (let i = 0; i < 6; i++) {
      const p = await gen({ width: 14 + i, height: 10 + (i % 3), regions: 22 + 2 * i, difficulty }, `s${i}`);
      expect(logicSolve(p, want).level).toBe(want);
      if (want > 0) expect(logicSolve(p, (want - 1) as Level).level).toBeNull();
      const brute = countSolutions(geometry(p), startKnowledge(p)!, 2);
      expect(brute.count).toBe(1);
      expect(analyze(p).solution).toEqual(Array.from(brute.first!.col));
    }
  });
}

test("logic never contradicts brute force on random maps", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 200; t++) {
    const w = rng.range(3, 6), h = rng.range(3, 6), n = rng.range(4, Math.min(12, w * h));
    const { map: cells } = renumber(randomMap(w, h, n, rng));
    const g = geometry({ w, h, n, map: cells });
    const col = randomColouring(g, rng)!;
    const given = col.map((c) => (rng.bool(0.6) ? c : -1));
    if (rng.bool(0.2)) given[rng.int(n)] = rng.int(4);
    const p: MapPuzzle = { w, h, n, map: cells, given };
    const start = startKnowledge(p);
    const logic = logicSolve(p, 2);
    if (!start) { expect(logic.ok).toBe(false); continue; }
    const brute = countSolutions(g, start, 2);
    if (logic.level !== null) {
      solved++;
      expect(brute.count).toBe(1);
      expect(Array.from(logic.k!.col)).toEqual(Array.from(brute.first!.col));
    }
    if (!logic.ok) expect(brute.count).toBe(0);
  }
  expect(solved).toBeGreaterThan(10);
});

function played(p: MapPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of mapTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(map, p, { kind: "imported" });
  new TechniqueHost(registry, s);
  checkMarks.setup!({ session: s, settings: {}, owner: "check" });
  return s;
}

test("following hints solves every difficulty; wrong colours come first", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ ...MID, difficulty }, `h-${difficulty}`);
    const s = played(p);
    const sol = analyze(p).solution!;
    const r = p.given.findIndex((c) => c < 0);
    s.dispatch({ type: "colour", regions: [r], colour: (sol[r]! + 1) % 4 });
    expect(s.hint()?.actions?.[0]).toEqual({ type: "colour", regions: [r], colour: -1 });
    for (let i = 0; i < 400 && !s.solved; i++) {
      const h = s.hint();
      expect(h?.actions?.length).toBeGreaterThan(0);
      s.batch(() => { for (const a of h!.actions!) s.dispatch(a); });
    }
    expect(s.solved).toBe(true);
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  for (const [difficulty, id] of [["easy", "map.only-colour"], ["medium", "map.pair"], ["hard", "map.trial"]] as const) {
    for (let i = 0; i < 3; i++) {
      const p = await gen({ ...MID, difficulty }, `r${i}`);
      const r = rateByTechniques(map, mapTechniques, p);
      expect(r!.hardest.id).toBe(id);
    }
  }
});

test("technique steps agree with the solution", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ ...MID, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = map.init(p);
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(map, mapTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as MapAction[]) {
        if (a.type === "colour") for (const r of a.regions) { expect(st.colours[r]).toBe(-1); expect(a.colour).toBe(sol[r]!); }
        else if (a.type === "marks") for (const r of a.regions) expect(a.marks & (1 << sol[r]!)).toBeTruthy();
      }
      st = applyStep(map, p, st, hit.step);
    }
    expect(map.isSolved(p, st)).toBe(true);
  }
});

test("every region a hint names is highlighted", async () => {
  let seen = 0;
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ ...MID, difficulty }, `names-${difficulty}`);
    const g = geometry(p);
    const name = (r: number) => `${String.fromCharCode(65 + (g.anchor[r]! % p.w))}${Math.floor(g.anchor[r]! / p.w) + 1}`;
    let st = map.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of mapTechniques) {
        const step = t.find(p, st);
        if (!step) continue;
        const all = (f: MapFocus) => new Set([...f.regions, ...f.because].map(name));
        for (const n of step.message.match(/\b[A-Z]+\d+\b/g) ?? []) expect(all(step.focus as MapFocus).has(n)).toBe(true);
        for (const n of (step.nudge ?? "").match(/\b[A-Z]+\d+\b/g) ?? []) expect(all(step.nudgeFocus as MapFocus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(map, mapTechniques, p, st);
      if (!hit) break;
      st = applyStep(map, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(20);
});

test("auto techniques cascade inside one undo step", async () => {
  const p = await gen({ ...MID, difficulty: "easy" }, "auto");
  const s = played(p, ["map.only-colour"]);
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.colours).toEqual(p.given);
});

test("practice finds a position for every technique", async () => {
  for (const t of mapTechniques) {
    const pos = await findPracticePosition(map, mapTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(map, mapTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
});

test("game ids round-trip and parse like the original", async () => {
  const p = await gen({ width: 20, height: 15, regions: 30 }, "fmt");
  const text = sgtFormat.serialize!(p);
  expect(sgtFormat.detect!(text)).toBe(true);
  expect(sgtFormat.parse(text)).toEqual(p);
  expect(sgtFormat.parse(text.replace(":", "dn:"))).toEqual(p);
  // a 2×2 board split into two columns: edges are (H) A1-A2 no, B1-B2 no, (V) A1-B1 yes, A2-B2 yes
  const two = sgtFormat.parse("2x2n2:cb,0a");
  expect(two.map).toEqual([0, 1, 0, 1]);
  expect(two.given).toEqual([0, -1]);
  expect(sgtFormat.serialize!(two)).toBe("2x2n2:cb,0a");
  expect(() => sgtFormat.parse("2x2n3:cb,0a")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen(MID, "solve");
  expect(map.isSolved(p, map.solve!(p)!)).toBe(true);
  expect(map.isSolved(p, map.init(p))).toBe(false);
});
