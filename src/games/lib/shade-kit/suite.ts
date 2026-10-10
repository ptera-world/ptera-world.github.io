import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { createRng, type Rng } from "../../core/rng";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep, rateByTechniques } from "../../core/techniques";
import type { AnyPlugin, Format, PuzzleDef, Technique } from "../../core/types";
import { countSolutions, solveLevel, type Analysis, type Doms, type Model } from "../grid-kit/csp";
import { cellName, type Focus } from "../grid-kit/names";
import { BLACK, DOT, NONE, SHADED, type ShadeAction, type ShadeInteraction, type ShadeState } from "./state";

export interface ShadeSuite<Pz extends { w: number; h: number }> {
  def: PuzzleDef<Pz, ShadeState, ShadeAction, ShadeInteraction, any>;
  techniques: readonly Technique<Pz, ShadeState, ShadeAction>[];
  checkMarks: AnyPlugin;
  /** Difficulty names, easiest first; index = logic level. */
  levels: readonly string[];
  /** Generation params for a difficulty and a test index. */
  params(difficulty: string, i: number): Record<string, unknown>;
  model(p: Pz): Model;
  initialDoms(p: Pz): Doms;
  analyze(p: Pz): Analysis;
  /** Cells that never take marks. */
  fixed?(p: Pz, c: number): boolean;
  /** Small random puzzles (not necessarily solvable) for checking logic against brute force. */
  random(rng: Rng): Pz;
  /** Text formats with serialize, checked to round-trip. */
  formats: readonly Format<Pz>[];
  /** Slowest acceptable generation of any preset, in milliseconds of CPU time (so a busy machine does not fail it). */
  presetBudgetMs: number;
}

/** The checks every shading pack runs: generation, logic, hints, techniques, formats and preset timing. */
export function shadeSuite<Pz extends { w: number; h: number }>(o: ShadeSuite<Pz>): void {
  const sig = () => new AbortController().signal;
  const gen = (params: Record<string, unknown>, seed: string) => generate(o.def, params, seed, sig()) as Promise<Pz>;
  const fixed = (p: Pz, c: number) => o.fixed?.(p, c) ?? false;
  const last = o.levels[o.levels.length - 1]!;

  test("generation is deterministic per (params, seed)", async () => {
    const a = await gen(o.params(o.levels[0]!, 0), "abc");
    const b = await gen(o.params(o.levels[0]!, 0), "abc");
    const c = await gen(o.params(o.levels[0]!, 0), "abd");
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  for (const [want, difficulty] of o.levels.entries()) {
    test(`${difficulty} puzzles are unique and need exactly ${difficulty}`, async () => {
      for (let i = 0; i < 4; i++) {
        const p = await gen(o.params(difficulty, i), `s${i}`);
        expect(solveLevel(o.model(p), o.initialDoms(p), want)).toBe(want);
        expect(countSolutions(o.model(p), o.initialDoms(p), 2).count).toBe(1);
      }
    }, 60000);
  }

  test("logic never contradicts brute force on random boards", () => {
    const rng = createRng("cross");
    let solved = 0;
    for (let t = 0; t < 300; t++) {
      const p = o.random(rng);
      const brute = countSolutions(o.model(p), o.initialDoms(p), 2);
      const a = o.analyze(p);
      expect(a.count).toBe(brute.count as 0 | 1 | 2);
      if (a.count === 1) {
        solved++;
        const ans = o.def.solve!(p, o.def.init(p))!;
        expect("board" in ans && o.def.isSolved(p, ans.board)).toBe(true);
      }
    }
    expect(solved).toBeGreaterThan(3);
  });

  const played = (p: Pz) => {
    const registry = new Registry();
    for (const t of o.techniques) registry.technique(t);
    const s = new Session(o.def, p, { kind: "imported" });
    new TechniqueHost(registry, s);
    o.checkMarks.setup!({ session: s, settings: {}, owner: "check" });
    return s;
  };

  test("following hints solves boards of every difficulty; wrong marks come first", async () => {
    for (const difficulty of o.levels) {
      const p = await gen(o.params(difficulty, 0), `h-${difficulty}`);
      const s = played(p);
      const sol = o.analyze(p).solution!;
      const bad = sol.findIndex((v, c) => !fixed(p, c) && v !== SHADED);
      s.dispatch({ type: "set", cells: [bad], value: BLACK });
      expect(s.hint()?.actions?.[0]).toEqual({ type: "set", cells: [bad], value: NONE });
      for (let i = 0; i < 600 && !s.solved; i++) {
        const h = s.hint();
        expect(h?.actions?.length).toBeGreaterThan(0);
        s.batch(() => { for (const a of h!.actions!) s.dispatch(a); });
      }
      expect(s.solved).toBe(true);
    }
  }, 60000);

  test("rating by techniques orders the difficulties", async () => {
    const hardest = (difficulty: string, j: number) => gen(o.params(difficulty, j), `r${j}`).then((p) => rateByTechniques(o.def, o.techniques, p)!.hardest.level);
    for (let i = 1; i < o.levels.length; i++) {
      for (let j = 0; j < 2; j++) expect(await hardest(o.levels[i]!, j)).toBeGreaterThan(await hardest(o.levels[i - 1]!, j));
    }
  }, 60000);

  test("every technique step agrees with the solution, never touches marked cells, and names only highlighted cells", async () => {
    const names = (msg: string) => msg.match(/\b[A-Z]+\d+\b/g) ?? [];
    const all = (p: Pz, x: Focus) => new Set([...x.cells, ...x.because, ...(x.related ?? [])].map((c) => cellName(p, c)));
    for (const difficulty of o.levels) {
      const p = await gen(o.params(difficulty, 1), `sound-${difficulty}`);
      const sol = o.analyze(p).solution!;
      let st = o.def.init(p);
      const wrong = sol.findIndex((v, c) => !fixed(p, c) && v === SHADED);
      st = o.def.reduce(p, st, { type: "set", cells: [wrong], value: DOT });
      for (let i = 0; i < 600; i++) {
        const hit = firstStep(o.def, o.techniques, p, st);
        if (!hit) break;
        for (const n of names(hit.step.message)) expect(all(p, hit.step.focus as Focus).has(n)).toBe(true);
        for (const n of names(hit.step.nudge ?? "")) expect(all(p, hit.step.nudgeFocus as Focus).has(n)).toBe(true);
        for (const a of hit.step.actions as ShadeAction[]) {
          for (const c of a.cells) {
            expect(st.marks[c]).toBe(NONE);
            expect(a.value === BLACK ? SHADED : 0).toBe(sol[c]!);
          }
        }
        st = applyStep(o.def, p, st, hit.step);
      }
    }
  }, 60000);

  test("practice finds a position for every technique", async () => {
    for (const t of o.techniques) {
      const pos = await findPracticePosition(o.def, o.techniques, t, "practice", sig());
      expect(pos).not.toBeNull();
      expect(firstStep(o.def, o.techniques, pos!.puzzle, pos!.state)!.technique.id).toBe(t.id);
    }
  }, 120000);

  test("formats round-trip", async () => {
    const p = await gen(o.params(last, 0), "fmt");
    for (const f of o.formats) expect(f.parse(f.serialize!(p))).toEqual(p);
  });

  test(`every preset generates within ${o.presetBudgetMs} ms of cpu time`, async () => {
    for (const preset of o.def.presets ?? []) {
      for (let i = 0; i < 2; i++) {
        const t = process.cpuUsage();
        const p = await gen(preset.params as Record<string, unknown>, `preset-${i}`);
        const { user, system } = process.cpuUsage(t);
        expect((user + system) / 1000).toBeLessThan(o.presetBudgetMs);
        expect(o.analyze(p).count).toBe(1);
      }
    }
  }, 300000);
}
