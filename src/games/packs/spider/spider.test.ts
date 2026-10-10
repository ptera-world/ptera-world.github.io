import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost } from "../../core/techniques";
import { actionOf, dealFormat, spider, type SpiderPuzzle, type SpiderState } from "./logic";
import { checkWinnable, fallbackHint } from "./techniques";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(spider, params, seed, sig()) as Promise<SpiderPuzzle>;

test("generation is deterministic and a stored win plays out legally", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  expect(await gen({}, "a")).not.toEqual(await gen({}, "b"));
  const p = await gen({ suits: "1" }, "w");
  let s = spider.init(p);
  for (const m of p.solution!) {
    const next = spider.reduce(p, s, actionOf(m));
    expect(next).not.toBe(s);
    s = next;
  }
  expect(spider.isSolved(p, s)).toBe(true);
}, 60000);

const twoSuits = () => dealFormat.parse(`suits 2\n${Array.from({ length: 4 }, () => "KS QS JS TS 9S 8S 7S 6S 5S 4S 3S 2S AS KH QH JH TH 9H 8H 7H 6H 5H 4H 3H 2H AH").flat().join(" ")}`);

/** A state with the given columns (card ids, all face up) and stock. */
function table(cols: number[][], stock: number[] = []): SpiderState {
  return {
    piles: [{ c: stock, d: stock.length }, ...Array.from({ length: 8 }, () => ({ c: [], d: 0 })), ...Array.from({ length: 10 }, (_, j) => ({ c: cols[j] ?? [], d: 0 }))],
    moves: 0,
  };
}

test("the deal: six cards in the first four columns, five elsewhere, fifty in the stock", () => {
  const p = twoSuits();
  const s = spider.init(p);
  expect(s.piles.slice(9).map((pl) => pl.c.length)).toEqual([6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
  expect(s.piles.slice(9).every((pl) => pl.d === pl.c.length - 1)).toBe(true);
  const dealt = spider.reduce(p, s, { type: "deal" });
  expect(dealt.piles[0]!.c.length).toBe(40);
  expect(dealt.piles[9]!.c[6]).toBe(54);
});

test("only one-suit runs move together, no deal onto an empty column, a finished suit leaves", () => {
  const p = twoSuits();
  // ids 0–12 are K♠…A♠, 13–25 K♥…A♥
  const mixed = table([[0, 14]]);
  expect(spider.reduce(p, mixed, { type: "move", from: 9, to: 10, n: 2 })).toBe(mixed);
  expect(spider.reduce(p, mixed, { type: "move", from: 9, to: 10, n: 1 })).not.toBe(mixed);
  const gap = table([[0], [1], [2], [3], [4], [5], [6], [7], [8]], [30, 31, 32, 33, 34, 35, 36, 37, 38, 39]);
  expect(spider.reduce(p, gap, { type: "deal" })).toBe(gap);
  const almost = table([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [12]]);
  const done = spider.reduce(p, almost, { type: "move", from: 10, to: 9, n: 1 });
  expect(done.piles[1]!.c.length).toBe(13);
  expect(done.piles[1]!.c[12]).toBe(0);
  expect(done.piles[9]!.c.length).toBe(0);
  expect(spider.isSolved(p, done)).toBe(false);
});

test("hints win a one-suit game, also after wandering off the stored line", async () => {
  const p = await gen({ suits: "1" }, "h");
  const registry = new Registry();
  const session = new Session({ ...spider, hint: fallbackHint }, p, { kind: "imported" });
  new TechniqueHost(registry, session);
  checkWinnable.setup!({ session, settings: {}, owner: "check" });
  session.dispatch({ type: "deal" });
  for (let i = 0; i < 600 && !session.solved; i++) {
    const hint = session.hint();
    expect(hint?.actions?.length).toBeGreaterThan(0);
    session.batch(() => { for (const a of hint!.actions!) session.dispatch(a); });
  }
  expect(session.solved).toBe(true);
}, 60000);

test("the hint alone wins a one-suit deal", async () => {
  const p = await gen({ suits: "1" }, "t");
  let s = spider.init(p);
  for (let i = 0; i < 600 && !spider.isSolved(p, s); i++) {
    const h = fallbackHint(p, s);
    expect(h).not.toBeNull();
    s = h!.actions!.reduce((t, a) => spider.reduce(p, t, a), s);
  }
  expect(spider.isSolved(p, s)).toBe(true);
}, 120000);

test("deal text round-trips and checks the cards", async () => {
  const p = await gen({ suits: "2", winnable: false }, "fmt");
  const text = dealFormat.serialize!(p);
  expect(dealFormat.detect!(text)).toBe(true);
  expect(dealFormat.parse(text)).toEqual(p);
  expect(() => dealFormat.parse(text.replace("KS", "KH"))).toThrow("times");
});
