import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost } from "../../core/techniques";
import { collapse, gridFormat, samegame, sgtFormat, type SamegamePuzzle } from "./logic";
import { findClear } from "./solver";
import { checkClearable, hint } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(samegame, params, seed, sig()) as Promise<SamegamePuzzle>;

test("generation is deterministic, fills the board, and its own order clears it", async () => {
  expect(await gen({ width: 10, height: 5 }, "a")).toEqual(await gen({ width: 10, height: 5 }, "a"));
  expect(await gen({ width: 10, height: 5 }, "a")).not.toEqual(await gen({ width: 10, height: 5 }, "b"));
  for (const pr of [...samegame.presets!.map((x) => x.params), { width: 7, height: 3, colours: 3 }, { width: 3, height: 7, colours: 5 }, { width: 2, height: 2 }]) {
    for (const seed of ["x", "y"]) {
      const p = await gen(pr, seed);
      expect(p.grid.every(Boolean)).toBe(true);
      let s = samegame.init(p);
      for (const c of p.solution!) {
        const next = samegame.reduce(p, s, { type: "remove", cell: c });
        expect(next).not.toBe(s);
        s = next;
      }
      expect(samegame.isSolved(p, s)).toBe(true);
    }
  }
});

test("gravity drops tiles and closes empty columns", () => {
  expect(collapse(3, 2, [1, 0, 2, 1, 3, 2], [0, 3])).toEqual([0, 2, 0, 3, 2, 0]);
  expect(collapse(2, 3, [1, 2, 3, 2, 1, 2], [1, 3, 5])).toEqual([1, 0, 3, 0, 1, 0]);
});

test("the search finds a clear when one exists and proves none otherwise", () => {
  const ok = gridFormat.parse("112\n122");
  expect(findClear(ok, ok.grid).path).not.toBeNull();
  const bad = gridFormat.parse("12\n21");
  const r = findClear(bad, bad.grid);
  expect(r.path).toBeNull();
  expect(r.impossible).toBe(true);
});

test("hints clear a board after a wrong turn is undone, and the check runs first", async () => {
  const p = await gen({ width: 10, height: 5, colours: 3 }, "h");
  const registry = new Registry();
  const session = new Session({ ...samegame, hint }, p, { kind: "imported" });
  new TechniqueHost(registry, session);
  checkClearable.setup!({ session, settings: {}, owner: "check" });
  for (let i = 0; i < 200 && !session.solved; i++) {
    const hint = session.hint();
    expect(hint?.actions?.length).toBeGreaterThan(0);
    session.batch(() => { for (const a of hint!.actions!) session.dispatch(a); });
  }
  expect(session.solved).toBe(true);
  const q = gridFormat.parse("1122\n3312");
  const s2 = new Session({ ...samegame, hint }, q, { kind: "imported" });
  checkClearable.setup!({ session: s2, settings: {}, owner: "check" });
  s2.dispatch({ type: "remove", cell: 0 });
  expect(s2.hint()?.message).toContain("lone");
});

test("the hint alone clears every preset", async () => {
  for (const pr of samegame.presets!) {
    const p = await gen(pr.params, "t");
    let s = samegame.init(p);
    for (let i = 0; i < 400 && !samegame.isSolved(p, s); i++) {
      const h = hint(p, s);
      expect(h).not.toBeNull();
      s = h!.actions!.reduce((t, a) => samegame.reduce(p, t, a), s);
    }
    expect(samegame.isSolved(p, s)).toBe(true);
  }
}, 30000);

test("scoring, being stuck", async () => {
  const p = gridFormat.parse("1112\n2223");
  const s = samegame.reduce(p, samegame.init(p), { type: "remove", cell: 0 });
  expect(s.score).toBe(1);
  const stuck = gridFormat.parse("12\n21");
  expect(samegame.isLost!(stuck, samegame.init(stuck))).toBe(true);
});

test("formats round-trip; sgt ids parse", async () => {
  const p = await gen({ width: 6, height: 4, colours: 4 }, "fmt");
  const { solution: _, ...bare } = p;
  for (const f of samegame.formats) {
    const text = f.serialize!(p);
    expect(f.detect!(text)).toBe(true);
    expect(f.parse(text)).toEqual({ ...bare, ...(f.id === "grid" ? { colours: Math.max(3, ...p.grid), scoreSub: 2 } : {}) });
  }
  const q = sgtFormat.parse("3x2c3s1:1,1,2,3,3,2");
  expect(q.scoreSub).toBe(1);
  expect(q.grid).toEqual([1, 1, 2, 3, 3, 2]);
  expect(() => sgtFormat.parse("2x1c3s2:1,4")).toThrow();
});
