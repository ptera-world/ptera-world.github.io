import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { applyStep, findPracticePosition, findStep, firstStep } from "../../core/techniques";
import { work } from "../../lib/work";
import { actionOf, dealFormat, tripeaks, type TriPeaksPuzzle } from "./logic";
import { COVERS, SPOTS, UNDER } from "./solver";
import { longestRun, solveFrom, tripeaksTechniques, uncover } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(tripeaks, params, seed, sig()) as Promise<TriPeaksPuzzle>;

const ordered = (head = "") => dealFormat.parse(`${head}${head ? "\n" : ""}${"AC 2C 3C 4C 5C 6C 7C 8C 9C TC JC QC KC AD 2D 3D 4D 5D 6D 7D 8D 9D TD JD QD KD AH 2H 3H 4H 5H 6H 7H 8H 9H TH JH QH KH AS 2S 3S 4S 5S 6S 7S 8S 9S TS JS QS KS"}`);

test("the peaks: every card sits on two, bottom row on none", () => {
  expect(COVERS.filter((c) => !c.length).length).toBe(10);
  expect(COVERS.filter((c) => c.length === 2).length).toBe(18);
  expect(UNDER.reduce((n, u) => n + u.length, 0)).toBe(36);
  expect(UNDER.slice(0, 3).every((u) => u.length === 0)).toBe(true);
  expect(SPOTS).toBe(28);
});

test("generation is deterministic and its stored win plays out legally", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  expect(await gen({}, "a")).not.toEqual(await gen({}, "b"));
  for (const pr of tripeaks.presets!) {
    const before = work.units;
    const p = await gen(pr.params, "w");
    expect(work.units - before).toBeLessThan(400_000);
    let s = tripeaks.init(p);
    for (const m of p.solution!) {
      const next = tripeaks.reduce(p, s, actionOf(m));
      expect(next).not.toBe(s);
      s = next;
    }
    expect(tripeaks.isSolved(p, s)).toBe(true);
  }
}, 60000);

test("the deal: bottom row face up, one card on the waste", () => {
  const p = ordered();
  const s = tripeaks.init(p);
  expect(s.piles[1]!.c.length).toBe(1);
  expect(s.piles[0]!.c.length).toBe(23);
  expect(s.piles[2 + 27]!.d).toBe(0);
  expect(s.piles[2]!.d).toBe(1);
  expect(s.piles.slice(2).filter((pl) => pl.d === 0).length).toBe(10);
});

test("plays follow the rules, with and without ace-king wrap", () => {
  // bottom row left to right: 9H 10 ... ; waste starts as the first stock card (KS here)
  const deck = [...ordered().deck];
  const take = (code: number) => deck.splice(deck.indexOf(code), 1)[0]!;
  const king = take(51), ace = take(0), queen = take(50), two = take(1);
  const rest = deck;
  // bottom row occupies spots 18..27; first drawn card goes to the waste
  const tab = [...rest.slice(0, 18), ace, queen, two, ...rest.slice(18, 25)];
  const stock = [king, ...rest.slice(25)];
  const p = { deck: [...tab, ...stock], connect: true, recycles: 0 } as TriPeaksPuzzle;
  expect(p.deck.length).toBe(52);
  const s = tripeaks.init(p);
  expect(s.piles[1]!.c).toEqual([king]);
  const wrap = tripeaks.reduce(p, s, { type: "play", spot: 18 });
  expect(wrap).not.toBe(s);
  expect(tripeaks.reduce({ ...p, connect: false }, s, { type: "play", spot: 18 })).toBe(s);
  expect(tripeaks.reduce(p, s, { type: "play", spot: 19 })).not.toBe(s);
  expect(tripeaks.reduce(p, s, { type: "play", spot: 20 })).toBe(s);
  // a covered card can't be played
  expect(tripeaks.reduce(p, s, { type: "play", spot: 0 })).toBe(s);
});

test("scoring: runs grow, a stock click ends the run, peaks add up", () => {
  const p = ordered();
  const s = tripeaks.init(p);
  const hit = firstStep(tripeaks, tripeaksTechniques, p, s);
  if (hit) {
    const t = applyStep(tripeaks, p, s, hit.step);
    expect(t.streak).toBeGreaterThan(0);
    expect(t.score).toBe(5 * t.streak * (t.streak + 1) / 2);
    const d = tripeaks.reduce(p, t, { type: "draw" });
    expect(d.streak).toBe(0);
    expect(d.score).toBe(t.score);
  }
});

test("recycling the waste, and being stuck", () => {
  const p = { ...ordered(), recycles: 1 };
  let s = tripeaks.init(p);
  for (let i = 0; i < 23; i++) s = tripeaks.reduce(p, s, { type: "draw" });
  expect(s.piles[0]!.c.length).toBe(0);
  const t = tripeaks.reduce(p, s, { type: "draw" });
  expect(t.recycles).toBe(1);
  expect(t.piles[1]!.c.length).toBe(0);
  const none = { ...p, recycles: 0 };
  let u = tripeaks.init(none);
  for (let i = 0; i < 23; i++) u = tripeaks.reduce(none, u, { type: "draw" });
  expect(tripeaks.reduce(none, u, { type: "draw" })).toBe(u);
});

test("technique steps are legal on every preset; practice positions exist", async () => {
  for (const pr of tripeaks.presets!) {
    const p = await gen(pr.params, "t");
    let s = tripeaks.init(p);
    for (let i = 0; i < 100 && !tripeaks.isSolved(p, s); i++) {
      const hit = firstStep(tripeaks, tripeaksTechniques, p, s);
      if (!hit) break;
      const next = applyStep(tripeaks, p, s, hit.step);
      expect(next).not.toBe(s);
      s = next;
    }
  }
  for (const t of tripeaksTechniques) {
    const pos = await findPracticePosition(tripeaks, tripeaksTechniques, t, "x", sig());
    const step = pos && findStep(tripeaks, t, pos.puzzle, pos.state);
    expect(step?.actions.length).toBe(1);
  }
}, 60000);

test("techniques read only what's face up", async () => {
  const p = await gen({}, "vis");
  const s = tripeaks.init(p);
  // swapping two face-down cards changes nothing a technique can say
  const down = s.piles.map((pl, i) => (i >= 2 && pl.d === 1 ? i : -1)).filter((i) => i >= 0);
  const swapped = { ...s, piles: s.piles.map((pl, i) => (i === down[0] ? s.piles[down[1]!]! : i === down[1] ? s.piles[down[0]!]! : pl)) };
  const texts = (st: typeof s) => [uncover, longestRun].map((t) => { const out: string[] = []; t.instances(p, st, (x) => { out.push(x.message); }); return out; });
  expect(texts(swapped)).toEqual(texts(s));
});

test("a winning line is found from where the player is", async () => {
  const p = await gen({}, "rev");
  let s = tripeaks.init(p);
  const first = firstStep(tripeaks, tripeaksTechniques, p, s);
  if (first) s = applyStep(tripeaks, p, s, first.step);
  const ans = solveFrom(p, s);
  expect(ans).not.toBeNull();
  for (const a of ans!.moves) {
    const next = tripeaks.reduce(p, s, a);
    expect(next).not.toBe(s);
    s = next;
  }
  expect(tripeaks.isSolved(p, s)).toBe(true);
});

test("deal text round-trips", async () => {
  const p = await gen({ connect: false, recycles: 2 }, "fmt");
  const { solution: _, ...bare } = p;
  const text = dealFormat.serialize!(p);
  expect(dealFormat.detect!(text)).toBe(true);
  expect(dealFormat.parse(text)).toEqual(bare);
  expect(() => dealFormat.parse("AS AS")).toThrow();
});
