import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Session } from "../../core/session";
import { applyStep, findPracticePosition, findStep, firstStep } from "../../core/techniques";
import { work } from "../../lib/work";
import type { Step } from "../../core/types";
import { dealFormat, pyramid, tapAction, type PyramidAction, type PyramidPuzzle, type PyramidState } from "./logic";
import { aims, king, pyramidTechniques, solveFrom } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(pyramid, params, seed, sig()) as Promise<PyramidPuzzle>;

const ordered = (passes = 3) => dealFormat.parse(`passes ${passes}\nAC 2C 3C 4C 5C 6C 7C 8C 9C TC JC QC KC AD 2D 3D 4D 5D 6D 7D 8D 9D TD JD QD KD AH 2H 3H 4H 5H 6H 7H 8H 9H TH JH QH KH AS 2S 3S 4S 5S 6S 7S 8S 9S TS JS QS KS`);
const played = { ...pyramid, solve: solveFrom, aims };
const same = (s: PyramidState, t: PyramidState) => expect(t).toBe(s);

test("generation is deterministic and its stored win plays out legally", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  expect(await gen({}, "a")).not.toEqual(await gen({}, "b"));
  for (const pr of pyramid.presets!) {
    const p = await gen(pr.params, "w");
    if (!p.solution) continue;
    let s = pyramid.init(p);
    for (const m of p.solution) {
      const a = m.t === "draw" ? { type: "draw" as const } : m.t === "take" ? { type: "take" as const, pile: m.a } : { type: "pair" as const, a: m.a, b: m.b };
      const next = pyramid.reduce(p, s, a);
      expect(next).not.toBe(s);
      s = next;
    }
    expect(pyramid.isSolved(p, s)).toBe(true);
  }
}, 120000);

test("generation counts its work and wins most three-pass deals", async () => {
  const before = work.units;
  const solved = (await Promise.all(["x", "y", "z", "u"].map((sd) => gen({}, sd)))).filter((p) => p.solution).length;
  expect(solved).toBe(4);
  expect(work.units - before).toBeLessThan(400_000);
}, 60000);

test("the deal: free cards are the bottom row, then the ones it uncovers", () => {
  const p = ordered();
  const s = pyramid.init(p);
  expect(s.piles.length).toBe(30);
  expect(s.piles[0]!.c.length).toBe(24);
  expect(s.piles[2]!.c).toEqual([0]);
  // the king in the bottom row goes alone; the apex can't move yet
  expect(pyramid.reduce(p, s, { type: "take", pile: 27 })).not.toBe(s);
  same(s, pyramid.reduce(p, s, { type: "take", pile: 2 }));
  // queen + ace = 13, queen + jack is not
  const t = pyramid.reduce(p, s, { type: "pair", a: 26, b: 28 });
  expect(t.piles[26]!.c).toEqual([]);
  expect(t.score).toBe(10);
  same(s, pyramid.reduce(p, s, { type: "pair", a: 25, b: 26 }));
  // a card under another can't be taken
  same(s, pyramid.reduce(p, s, { type: "pair", a: 20, b: 29 }));
});

test("the waste's top card pairs with a free card; only its top card is free", () => {
  const p = ordered();
  let s = pyramid.reduce(p, pyramid.init(p), { type: "draw" });
  expect(s.piles[1]!.c).toEqual([28]);
  // 3 + 10 = 13: TD is spot 22, pile 24
  const t = pyramid.reduce(p, s, { type: "pair", a: 1, b: 24 });
  expect(t.piles[1]!.c).toEqual([]);
  expect(t.piles[24]!.c).toEqual([]);
  s = pyramid.reduce(p, s, { type: "draw" });
  // the 3 is buried under the new top: it can't pair any more
  same(s, pyramid.reduce(p, s, { type: "pair", a: 1, b: 21 }));
});

test("picking: tap picks, a second tap pairs or moves the pick, the same card puts it down", () => {
  const p = ordered();
  const s = pyramid.init(p);
  expect(tapAction(p, s, 26, 0)).toEqual([{ type: "pick", pile: 26 }]);
  const picked = pyramid.reduce(p, s, { type: "pick", pile: 26 });
  expect(picked.pick).toBe(26);
  expect(tapAction(p, picked, 28, 0)).toEqual([{ type: "pair", a: 26, b: 28 }]);
  expect(tapAction(p, picked, 25, 0)).toEqual([{ type: "pick", pile: 25 }]);
  expect(tapAction(p, picked, 26, 0)).toEqual([{ type: "pick", pile: 26 }]);
  expect(pyramid.reduce(p, picked, { type: "pick", pile: 26 }).pick).toBe(-1);
  // kings go at once and can't be picked; covered cards can't be picked
  expect(tapAction(p, s, 27, 0)).toEqual([{ type: "take", pile: 27 }]);
  same(s, pyramid.reduce(p, s, { type: "pick", pile: 27 }));
  same(s, pyramid.reduce(p, s, { type: "pick", pile: 2 }));
  expect(tapAction(p, s, 2, 0)).toBeNull();
  // a draw puts the pick down
  expect(pyramid.reduce(p, picked, { type: "draw" }).pick).toBe(-1);
});

test("passes through the stock", () => {
  for (const passes of [1, 2, 0]) {
    const p = ordered(passes);
    let s = pyramid.init(p);
    for (let i = 0; i < 24; i++) s = pyramid.reduce(p, s, { type: "draw" });
    expect(s.piles[0]!.c.length).toBe(0);
    const t = pyramid.reduce(p, s, { type: "draw" });
    if (passes === 1) { same(s, t); continue; }
    expect(t.recycles).toBe(1);
    expect(t.piles[0]!.c.length).toBe(24);
    expect(t.piles[0]!.c[23]).toBe(28);
    let u = t;
    for (let i = 0; i < 24; i++) u = pyramid.reduce(p, u, { type: "draw" });
    expect(pyramid.reduce(p, u, { type: "draw" }) === u).toBe(passes === 2);
  }
});

test("clearing a row scores its bonus, and clearing the pyramid solves", () => {
  const p = ordered();
  const s = pyramid.init(p);
  const lone: PyramidState = { ...s, piles: s.piles.map((pl, i) => (i === 2 ? { c: [12], d: 0 } : i > 2 ? { c: [], d: 0 } : pl)) };
  expect(pyramid.isSolved(p, lone)).toBe(false);
  const done = pyramid.reduce(p, lone, { type: "take", pile: 2 });
  expect(done.score).toBe(5 + 70);
  expect(pyramid.isSolved(p, done)).toBe(true);
});

test("a position with nothing left to do is lost", () => {
  const p = ordered(1);
  const s = pyramid.init(p);
  expect(pyramid.isLost!(p, s)).toBe(false);
  const left = (cards: Record<number, number>): PyramidState => ({ ...s, piles: s.piles.map((_, i) => ({ c: cards[i] === undefined ? [] : [cards[i]!], d: 0 })) });
  expect(pyramid.isLost!(p, left({ 28: 26, 29: 27 }))).toBe(true);
  expect(pyramid.isLost!(p, left({ 26: 24, 28: 26 }))).toBe(false);
});

test("deal text round-trips", async () => {
  const p = await gen({}, "fmt");
  const { solution: _, ...bare } = p;
  const text = dealFormat.serialize!(p);
  expect(dealFormat.detect!(text)).toBe(true);
  expect(dealFormat.parse(text)).toEqual(bare);
  expect(() => dealFormat.parse("AS AS")).toThrow();
});

test("technique steps are legal on every preset and aim at their cards", async () => {
  for (const pr of pyramid.presets!) {
    const p = await gen(pr.params, "t");
    let s = pyramid.init(p);
    for (let i = 0; i < 100 && !pyramid.isSolved(p, s); i++) {
      const hit = firstStep(pyramid, pyramidTechniques, p, s);
      if (!hit) { s = pyramid.reduce(p, s, { type: "draw" }); continue; }
      const next = applyStep(pyramid, p, s, hit.step);
      expect(next).not.toBe(s);
      const step = hit.step as Step<PyramidAction>;
      const a = step.actions[0]!;
      expect(aims(p, step, { pile: a.type === "take" ? a.pile : a.type === "pair" ? a.a : -1 })).toBe(true);
      s = next;
    }
  }
  const p = ordered();
  expect((findStep(pyramid, king, p, pyramid.init(p)) as Step<PyramidAction> | null)?.actions).toEqual([{ type: "take", pile: 27 }]);
}, 60000);

test("practice positions exist for every technique", async () => {
  for (const t of pyramidTechniques) {
    const pos = await findPracticePosition(played, pyramidTechniques, t, "x", sig());
    const step = pos && findStep(played, t, pos.puzzle, pos.state);
    expect(step?.actions.length).toBe(1);
  }
}, 60000);

test("a session on the deal can be played to the stored win", async () => {
  const p = await gen({}, "play");
  const session = new Session(pyramid, p, { kind: "imported" });
  for (const m of p.solution!) session.dispatch(m.t === "draw" ? { type: "draw" } : m.t === "take" ? { type: "take", pile: m.a } : { type: "pair", a: m.a, b: m.b });
  expect(session.outcome).toBe("solved");
}, 30000);
