import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { createRng } from "../../core/rng";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, findStep, firstStep, rateByTechniques } from "../../core/techniques";
import { directionTo, geometry, type SignpostPuzzle } from "./grid";
import { canLink, cellName, gridFormat, sgtFormat, signpost, type SignpostAction, type SignpostFocus } from "./logic";
import { checkLinks } from "./plugins";
import { analyze, countSolutions, freshKnowledge, logicSolve, type Level } from "./solver";
import { signpostTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(signpost, params, seed, sig()) as Promise<SignpostPuzzle>;

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
      const p = await gen({ width: 4 + (i % 3), height: 5 + (i % 2), difficulty, corners: i % 2 === 0 }, `s${i}`);
      expect(logicSolve(p, want).level).toBe(want);
      if (want > 0) expect(logicSolve(p, (want - 1) as Level).level).toBeNull();
      const g = geometry(p);
      const brute = countSolutions(g, freshKnowledge(g), 2);
      expect(brute.count).toBe(1);
      expect(analyze(p).solution).toEqual(Array.from(brute.first!.next));
    }
  });
}

test("logic never contradicts brute force on random boards", () => {
  const rng = createRng("cross");
  let solved = 0;
  for (let t = 0; t < 300; t++) {
    const w = rng.range(2, 4), h = rng.range(2, 4), n = w * h;
    const order = rng.shuffle(Array.from({ length: n }, (_, i) => i));
    const dirs = Array.from({ length: n }, () => rng.int(8));
    for (let i = 0; i + 1 < n; i++) {
      const d = directionTo(w, order[i]!, order[i + 1]!);
      if (d >= 0 && rng.bool(0.8)) dirs[order[i]!] = d;
    }
    const nums = Array.from({ length: n }, () => 0);
    order.forEach((c, i) => { if (i === 0 || i === n - 1 || rng.bool(0.2)) nums[c] = i + 1; });
    const p: SignpostPuzzle = { w, h, dirs, nums };
    const g = geometry(p);
    const brute = countSolutions(g, freshKnowledge(g), 2);
    const logic = logicSolve(p, 2);
    if (logic.level !== null) {
      solved++;
      expect(brute.count).toBe(1);
      expect(Array.from(logic.k.next)).toEqual(Array.from(brute.first!.next));
    }
    if (!logic.ok) expect(brute.count).toBe(0);
  }
  expect(solved).toBeGreaterThan(10);
});

function played(p: SignpostPuzzle, auto: string[] = []) {
  const registry = new Registry();
  for (const t of signpostTechniques) registry.technique(auto.includes(t.id) ? { ...t, defaults: { auto: true } } : t);
  const s = new Session(signpost, p, { kind: "imported" });
  new TechniqueHost(registry, s);
  checkLinks.setup!({ session: s, settings: {}, owner: "check" });
  return s;
}

test("wrong links come first; technique steps apply", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 6, height: 6, difficulty }, `h-${difficulty}`);
    const s = played(p);
    const sol = analyze(p).solution!;
    const g = geometry(p);
    let from = -1, wrongTo = -1;
    for (let c = 0; c < g.n && from < 0; c++) for (const t of g.ray[c]!) if (t !== sol[c] && canLink(p, s.state, c, t)) { from = c; wrongTo = t; break; }
    {
      s.dispatch({ type: "link", from, to: wrongTo });
      expect(s.hint()?.actions?.[0]).toEqual({ type: "unlink", from: [from] });
    }
    s.dispatch({ type: "unlink", from: [from] });
    for (let i = 0; i < 400 && !s.solved; i++) {
      const hit = firstStep(signpost, signpostTechniques, p, s.state);
      if (!hit) break;
      s.batch(() => { for (const a of hit.step.actions) s.dispatch(a as SignpostAction); });
    }
  }
});

test("rating by techniques matches the generator's difficulty", async () => {
  const lvl = (id: string) => signpostTechniques.find((t) => t.id === id)!.level;
  const top = { easy: lvl("signpost.only-prev"), medium: lvl("signpost.numbers-fit"), hard: lvl("signpost.trial") };
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    for (let i = 0; i < 4; i++) {
      const p = await gen({ width: 5, height: 5, difficulty }, `r${i}`);
      const r = rateByTechniques(signpost, signpostTechniques, p);
      expect(r).not.toBeNull();
      expect(r!.hardest.level).toBeLessThanOrEqual(top[difficulty]);
      if (difficulty === "medium") expect(r!.hardest.level).toBeGreaterThan(top.easy);
      if (difficulty === "hard") expect(r!.hardest.level).toBeGreaterThan(top.medium);
    }
  }
});

test("technique steps agree with the solution", async () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 6, height: 6, difficulty }, `sound-${difficulty}`);
    const sol = analyze(p).solution!;
    let st = signpost.init(p);
    for (let i = 0; i < 400; i++) {
      const hit = firstStep(signpost, signpostTechniques, p, st);
      if (!hit) break;
      for (const a of hit.step.actions as SignpostAction[]) {
        if (a.type !== "link") throw new Error("techniques only link");
        expect(st.next[a.from]).toBe(-1);
        expect(sol[a.from]).toBe(a.to);
      }
      st = applyStep(signpost, p, st, hit.step);
    }
    expect(signpost.isSolved(p, st)).toBe(true);
  }
});

test("every cell a hint names is highlighted", async () => {
  const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
  let seen = 0;
  for (const difficulty of ["easy", "medium", "hard"]) {
    const p = await gen({ width: 6, height: 6, difficulty }, `names-${difficulty}`);
    let st = signpost.init(p);
    for (let i = 0; i < 400; i++) {
      for (const t of signpostTechniques) {
        const step = findStep(signpost, t, p, st);
        if (!step) continue;
        const all = (f: SignpostFocus) => new Set([...f.links.flat(), ...f.because, ...(f.related ?? [])].map((c) => cellName(p, c)));
        for (const n of names(step.message)) expect(all(step.focus as SignpostFocus).has(n)).toBe(true);
        for (const n of names(step.nudge ?? "")) expect(all(step.nudgeFocus as SignpostFocus).has(n)).toBe(true);
        seen++;
      }
      const hit = firstStep(signpost, signpostTechniques, p, st);
      if (!hit) break;
      st = applyStep(signpost, p, st, hit.step);
    }
  }
  expect(seen).toBeGreaterThan(30);
});

test("links follow arrows, never loop, and replace old ends", async () => {
  const p = sgtFormat.parse("3x1:1c2c3a");
  let st = signpost.init(p);
  expect(signpost.reduce(p, st, { type: "link", from: 1, to: 0 })).toBe(st);
  st = signpost.reduce(p, st, { type: "link", from: 0, to: 2 });
  expect(st.next[0]).toBe(-1);
  st = signpost.reduce(p, st, { type: "link", from: 0, to: 1 });
  st = signpost.reduce(p, st, { type: "link", from: 1, to: 2 });
  expect(signpost.isSolved(p, st)).toBe(true);
  st = signpost.reduce(p, st, { type: "cut-chain", cell: 1 });
  expect(st.next).toEqual([-1, -1, -1]);
});

test("auto techniques cascade inside one undo step", async () => {
  const p = await gen({ width: 5, height: 5, difficulty: "easy" }, "auto");
  const s = played(p, ["signpost.consecutive", "signpost.only-next", "signpost.only-prev"]);
  s.settle(true);
  expect(s.solved).toBe(true);
  s.undo();
  expect(s.state.next.every((t) => t === -1)).toBe(true);
});

test("practice finds a position for every technique", async () => {
  for (const t of signpostTechniques) {
    const pos = await findPracticePosition(signpost, signpostTechniques, t, "practice", sig());
    expect(pos).not.toBeNull();
    expect(firstStep(signpost, signpostTechniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
  }
});

test("formats round-trip; game ids parse like the original", async () => {
  const p = await gen({ width: 5, height: 4 }, "fmt");
  for (const f of [sgtFormat, gridFormat]) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    const back = f.parse(text);
    expect(back.nums).toEqual(p.nums);
    expect(back.dirs.filter((_, c) => p.nums[c] !== 20)).toEqual(p.dirs.filter((_, c) => p.nums[c] !== 20));
  }
  const id = sgtFormat.serialize!(p);
  expect(sgtFormat.parse(id.replace(":", "c:"))).toEqual(sgtFormat.parse(id));
  expect(() => sgtFormat.parse("3x1:1cca")).toThrow();
  expect(() => sgtFormat.parse("3x1:1c2c")).toThrow();
});

test("solve() reaches a solved state", async () => {
  const p = await gen({ width: 4, height: 4 }, "solve");
  const ans = signpost.solve!(p, signpost.init(p))!;
  expect("board" in ans && signpost.isSolved(p, ans.board)).toBe(true);
  expect(signpost.isSolved(p, signpost.init(p))).toBe(false);
});
