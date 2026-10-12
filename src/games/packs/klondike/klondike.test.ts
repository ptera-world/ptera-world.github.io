import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Session } from "../../core/session";
import { applyStep, findPracticePosition, findStep, firstStep } from "../../core/techniques";
import { parseCards } from "../../lib/cards/deck";
import { actionsOf, dealFormat, klondike, scoreLine, type KlondikePuzzle } from "./logic";
import { bankPlugin, gain, timeAdjust } from "./score";
import { COLS, FOUND, WASTE } from "./solver";
import { klondikeTechniques } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(klondike, params, seed, sig()) as Promise<KlondikePuzzle>;

test("generation is deterministic and its stored win plays out legally", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  expect(await gen({}, "a")).not.toEqual(await gen({}, "b"));
  for (const pr of klondike.presets!) {
    const p = await gen(pr.params, "w");
    let s = klondike.init(p);
    for (const m of p.solution!) for (const a of actionsOf(m)) {
      const next = klondike.reduce(p, s, a);
      expect(next).not.toBe(s);
      s = next;
    }
    expect(klondike.isSolved(p, s)).toBe(true);
  }
}, 60000);

const ordered = () => dealFormat.parse(`draw 3, passes 2\n${"AC 2C 3C 4C 5C 6C 7C 8C 9C TC JC QC KC AD 2D 3D 4D 5D 6D 7D 8D 9D TD JD QD KD AH 2H 3H 4H 5H 6H 7H 8H 9H TH JH QH KH AS 2S 3S 4S 5S 6S 7S 8S 9S TS JS QS KS"}`);

test("the deal, drawing three, and limited passes", () => {
  const p = ordered();
  const s = klondike.init(p);
  expect(s.piles[6]!.c).toEqual(parseCards("AC"));
  expect(s.piles[12]!.c).toEqual(parseCards("7C KC 5D 9D QD AH 2H"));
  expect(s.piles[12]!.d).toBe(6);
  expect(s.piles[0]!.c.length).toBe(24);
  let t = klondike.reduce(p, s, { type: "draw" });
  expect(t.piles[1]!.c).toEqual(parseCards("3H 4H 5H"));
  for (let i = 0; i < 7; i++) t = klondike.reduce(p, t, { type: "draw" });
  expect(t.piles[0]!.c.length).toBe(0);
  t = klondike.reduce(p, t, { type: "draw" });
  expect(t.recycles).toBe(1);
  for (let i = 0; i < 8; i++) t = klondike.reduce(p, t, { type: "draw" });
  expect(klondike.reduce(p, t, { type: "draw" })).toBe(t);
});

test("moves follow the rules", () => {
  const p = ordered();
  const s = klondike.init(p);
  // AC home from column 1
  const home = klondike.reduce(p, s, { type: "move", from: 6, to: 2, n: 1 });
  expect(home.piles[2]!.c).toEqual(parseCards("AC"));
  // AC can't go to the spades foundation
  expect(klondike.reduce(p, s, { type: "move", from: 6, to: 5, n: 1 })).toBe(s);
  // only a king goes into an empty column
  expect(klondike.reduce(p, home, { type: "move", from: 7, to: 6, n: 1 })).toBe(home);
  // a face-down card can't move
  expect(klondike.reduce(p, s, { type: "move", from: 7, to: 2, n: 2 })).toBe(s);
});

test("technique steps keep applying, also after wandering off the stored line", async () => {
  const p = await gen({}, "h");
  const session = new Session(klondike, p, { kind: "imported" });
  session.dispatch({ type: "draw" });
  session.dispatch({ type: "draw" });
  for (let i = 0; i < 400; i++) {
    const hit = firstStep(klondike, klondikeTechniques, p, session.state);
    if (!hit) break;
    session.batch(() => { for (const a of hit.step.actions) session.dispatch(a as never); });
  }
}, 30000);

test("technique steps are legal on every preset; practice positions exist", async () => {
  for (const pr of klondike.presets!) {
    const p = await gen(pr.params, "t");
    let s = klondike.init(p);
    for (let i = 0; i < 400 && !klondike.isSolved(p, s); i++) {
      const hit = firstStep(klondike, klondikeTechniques, p, s);
      if (!hit) break;
      const next = applyStep(klondike, p, s, hit.step);
      expect(next).not.toBe(s);
      s = next;
    }
  }
  for (const t of klondikeTechniques) {
    const pos = await findPracticePosition(klondike, klondikeTechniques, t, "x", sig());
    const step = pos && findStep(klondike, t, pos.puzzle, pos.state);
    expect(step?.actions.length).toBeGreaterThan(0);
  }
}, 120000);

test("deal text round-trips", async () => {
  const p = await gen({ draw: "3", passes: "3" }, "fmt");
  const { solution: _, ...bare } = p;
  const text = dealFormat.serialize!(p);
  expect(dealFormat.detect!(text)).toBe(true);
  expect(dealFormat.parse(text)).toEqual(bare);
  expect(() => dealFormat.parse("AS AS")).toThrow("52");
});

const withHead = (head: string) => dealFormat.parse(`${head}\nAC 2C 3C 4C 5C 6C 7C 8C 9C TC JC QC KC AD 2D 3D 4D 5D 6D 7D 8D 9D TD JD QD KD AH 2H 3H 4H 5H 6H 7H 8H 9H TH JH QH KH AS 2S 3S 4S 5S 6S 7S 8S 9S TS JS QS KS`);

test("standard scoring: points for what is played, never below zero", () => {
  const p = withHead("draw 1, passes 0, scoring standard");
  let s = klondike.init(p);
  expect(s.score).toBe(0);
  s = klondike.reduce(p, s, { type: "move", from: COLS, to: FOUND, n: 1 });
  expect(s.score).toBe(10);
  s = klondike.reduce(p, s, { type: "draw" });
  expect(s.score).toBe(10);
  const before = { stock: [], waste: [1], found: [0, 0, 0, 0], cols: [[5], [6]], down: [0, 0], recycles: 0 };
  expect(gain("standard", 1, before, { ...before, waste: [], cols: [[5], [6, 1]] }, { from: WASTE, to: COLS + 1, n: 1 })).toBe(5);
  expect(gain("standard", 1, before, { ...before, stock: [1], waste: [], recycles: 1 }, null)).toBe(-100);
  expect(gain("standard", 3, before, { ...before, stock: [1], waste: [], recycles: 2 }, null)).toBe(0);
  expect(gain("standard", 3, before, { ...before, stock: [1], waste: [], recycles: 3 }, null)).toBe(-20);
  expect(gain("standard", 1, { ...before, found: [1, 0, 0, 0] }, before, { from: FOUND, to: COLS, n: 1 })).toBe(-15);
  expect(gain("standard", 1, { ...before, down: [1, 0], cols: [[5, 6], [7]] }, { ...before, down: [0, 0], cols: [[5], [7, 6]] }, { from: COLS, to: COLS + 1, n: 1 })).toBe(5);
});

test("vegas scoring starts down the stake and pays five a card home", () => {
  const p = withHead("draw 3, passes 3, scoring vegas");
  let s = klondike.init(p);
  expect(s.score).toBe(-52);
  s = klondike.reduce(p, s, { type: "move", from: COLS, to: FOUND, n: 1 });
  expect(s.score).toBe(-47);
  expect(scoreLine(p, s, 0)).toBe("-$47 · 1 move");
});

test("no scoring shows only moves; timed scoring takes points for time and adds a quick-win bonus", () => {
  const none = withHead("draw 1, passes 0, scoring none");
  expect(klondike.init(none).score).toBe(0);
  expect(scoreLine(none, klondike.init(none), 0)).toBe("0 moves");
  expect(timeAdjust(25_000, false)).toBe(-4);
  expect(timeAdjust(200_000, true)).toBe(-40 + 3500);
  expect(timeAdjust(30_000, true)).toBe(-6);
  const timed = withHead("draw 1, passes 0, scoring standard, timed");
  expect(timed.timed).toBe(true);
  const s = klondike.reduce(timed, klondike.init(timed), { type: "move", from: COLS, to: FOUND, n: 1 });
  expect(scoreLine(timed, s, 25_000)).toBe("score 6 · 1 move");
  expect(scoreLine(timed, s, 600_000)).toBe("score 0 · 1 move");
});

test("the running vegas total counts each deal once, however often it is resumed", () => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  const p = withHead("draw 1, passes 0, scoring vegas-keep");
  const open = () => {
    const session = new Session(klondike, p, { kind: "imported" });
    const plugin = bankPlugin(klondike);
    plugin.setup!({ session, settings: {}, owner: "t" });
    return session;
  };
  const a = open();
  open();
  expect(scoreLine(p, a.state, 0)).toBe("this deal -$52 · total -$52 · 0 moves");
  a.dispatch({ type: "move", from: COLS, to: FOUND, n: 1 });
  expect(scoreLine(p, a.state, 0)).toBe("this deal -$47 · total -$47 · 1 move");
  const resumed = Session.restore(klondike, a.snapshot());
  bankPlugin(klondike).setup!({ session: resumed, settings: {}, owner: "r" });
  const other = { ...p, deck: [...p.deck.slice(1), p.deck[0]!] };
  const b = new Session(klondike, other, { kind: "imported" });
  bankPlugin(klondike).setup!({ session: b, settings: {}, owner: "u" });
  expect(scoreLine(other, b.state, 0)).toBe("this deal -$52 · total -$99 · 0 moves");
  delete (globalThis as { localStorage?: unknown }).localStorage;
});
