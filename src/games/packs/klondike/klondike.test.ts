import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, firstStep } from "../../core/techniques";
import { parseCards } from "../../lib/cards/deck";
import { actionsOf, dealFormat, klondike, type KlondikePuzzle } from "./logic";
import { checkWinnable, klondikeTechniques } from "./techniques";

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

test("hints win a game, also after wandering off the stored line", async () => {
  const p = await gen({}, "h");
  const registry = new Registry();
  for (const t of klondikeTechniques) registry.technique(t);
  const session = new Session(klondike, p, { kind: "imported" });
  new TechniqueHost(registry, session);
  checkWinnable.setup!({ session, settings: {}, owner: "check" });
  session.dispatch({ type: "draw" });
  session.dispatch({ type: "draw" });
  for (let i = 0; i < 400 && !session.solved; i++) {
    const hint = session.hint();
    expect(hint?.actions?.length).toBeGreaterThan(0);
    session.batch(() => { for (const a of hint!.actions!) session.dispatch(a); });
  }
  expect(session.solved).toBe(true);
}, 30000);

test("techniques alone win every preset; practice positions exist", async () => {
  for (const pr of klondike.presets!) {
    const p = await gen(pr.params, "t");
    let s = klondike.init(p);
    for (let i = 0; i < 400 && !klondike.isSolved(p, s); i++) {
      const hit = firstStep(klondike, klondikeTechniques, p, s)!;
      expect(hit).not.toBeNull();
      s = applyStep(klondike, p, s, hit.step);
    }
    expect(klondike.isSolved(p, s)).toBe(true);
  }
  for (const t of klondikeTechniques) {
    const pos = await findPracticePosition(klondike, klondikeTechniques, t, "x", sig());
    expect(pos?.step.actions.length).toBeGreaterThan(0);
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
