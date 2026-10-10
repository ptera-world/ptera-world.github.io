import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import { TechniqueHost, applyStep, findPracticePosition, findStep, firstStep } from "../../core/techniques";
import { LAYOUTS } from "./layouts";
import { dealFormat, mahjong, type MahjongPuzzle } from "./logic";
import { boardOf, isFree, solve, stuckPair } from "./solver";
import { checkClearable, fallbackHint, mahjongTechniques } from "./techniques";
import { fullSet, matchKey } from "./tiles";

const sig = () => new AbortController().signal;
const gen = (params: Record<string, unknown>, seed: string) => generate(mahjong, params, seed, sig()) as Promise<MahjongPuzzle>;

test("layouts: even sizes; on the turtle the top and the row ends are free, tiles under or between others aren't", () => {
  for (const l of LAYOUTS) expect(l.spots.length % 2).toBe(0);
  const turtle = LAYOUTS.find((l) => l.id === "turtle")!;
  expect(turtle.spots.length).toBe(144);
  const b = boardOf(turtle.spots);
  const none = turtle.spots.map(() => 0);
  const at = (x: number, y: number, z: number) => turtle.spots.findIndex((q) => q[0] === x && q[1] === y && q[2] === z);
  const free = (x: number, y: number, z: number) => isFree(b, none, at(x, y, z));
  expect(free(13, 7, 4)).toBe(true);
  expect(free(12, 6, 3)).toBe(false);
  expect(free(0, 7, 0)).toBe(true);
  expect(free(28, 7, 0)).toBe(true);
  expect(free(2, 6, 0)).toBe(false);
  expect(free(2, 0, 0)).toBe(true);
  expect(free(4, 0, 0)).toBe(false);
  expect(free(8, 2, 1)).toBe(true);
  expect(free(10, 2, 1)).toBe(false);
});

test("generation is deterministic, uses the right tiles, and its stored order clears the board", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  expect(await gen({}, "a")).not.toEqual(await gen({}, "b"));
  const t = await gen({ layout: "turtle" }, "set");
  expect([...t.tiles].sort((a, b) => a - b)).toEqual(fullSet().sort((a, b) => a - b));
  for (const pr of mahjong.presets!) {
    const p = await gen(pr.params, "w");
    let s = mahjong.init(p);
    for (const [a, b] of p.solution!) {
      const next = mahjong.reduce(p, s, { type: "match", a, b });
      expect(next).not.toBe(s);
      s = next;
    }
    expect(mahjong.isSolved(p, s)).toBe(true);
  }
});

test("only free matching tiles go; flowers match flowers", async () => {
  const p = await gen({ layout: "small" }, "rules");
  const s = mahjong.init(p);
  const b = boardOf(p.spots);
  const free = p.spots.map((_, i) => i).filter((i) => isFree(b, s.gone, i));
  const blocked = p.spots.map((_, i) => i).find((i) => !isFree(b, s.gone, i))!;
  const twin = p.tiles.findIndex((t, i) => i !== blocked && matchKey(t) === matchKey(p.tiles[blocked]!));
  expect(mahjong.reduce(p, s, { type: "match", a: blocked, b: twin })).toBe(s);
  const pair = free.flatMap((a) => free.filter((c) => c > a && matchKey(p.tiles[a]!) === matchKey(p.tiles[c]!)).map((c) => [a, c] as const))[0];
  if (pair) expect(mahjong.reduce(p, s, { type: "match", a: pair[0], b: pair[1] })).not.toBe(s);
  expect(matchKey(34)).toBe(matchKey(37));
  expect(matchKey(38)).toBe(matchKey(41));
  expect(matchKey(33)).not.toBe(matchKey(34));
});

test("a last pair stacked one on the other is spotted as stuck", () => {
  const spots = [[0, 0, 0], [0, 0, 1], [4, 0, 0], [6, 0, 0]] as [number, number, number][];
  const tiles = [5, 5, 7, 7];
  const b = boardOf(spots);
  expect(stuckPair(b, tiles, [0, 0, 0, 0])).toEqual([0, 1]);
  expect(solve(spots, tiles, [0, 0, 0, 0]).impossible).toBe(true);
});

test("hints clear a board, also after wandering off the stored line", async () => {
  const p = await gen({ layout: "pyramid" }, "h");
  const registry = new Registry();
  for (const t of mahjongTechniques) registry.technique(t);
  const session = new Session({ ...mahjong, hint: fallbackHint }, p, { kind: "imported" });
  new TechniqueHost(registry, session);
  checkClearable.setup!({ session, settings: {}, owner: "check" });
  const [a, b] = p.solution![1]!;
  session.dispatch({ type: "match", a, b });
  for (let i = 0; i < 100 && !session.solved; i++) {
    const hint = session.hint();
    expect(hint?.actions?.length).toBeGreaterThan(0);
    session.batch(() => { for (const x of hint!.actions!) session.dispatch(x); });
  }
  expect(session.solved).toBe(true);
}, 30000);

test("techniques alone clear every preset; practice positions exist", async () => {
  for (const pr of mahjong.presets!) {
    const p = await gen(pr.params, "t");
    let s = mahjong.init(p);
    for (let i = 0; i < 100 && !mahjong.isSolved(p, s); i++) {
      const hit = firstStep(mahjong, mahjongTechniques, p, s);
      const h = hit ? null : fallbackHint(p, s);
      expect(hit ?? h).not.toBeNull();
      s = hit ? applyStep(mahjong, p, s, hit.step) : h!.actions!.reduce((t, a) => mahjong.reduce(p, t, a), s);
    }
    expect(mahjong.isSolved(p, s)).toBe(true);
  }
  for (const t of mahjongTechniques) {
    const pos = await findPracticePosition(mahjong, mahjongTechniques, t, "x", sig());
    const step = pos && findStep(mahjong, t, pos.puzzle, pos.state);
    expect(step?.actions.length).toBe(1);
  }
}, 60000);

test("deal text round-trips and checks the tiles", async () => {
  const p = await gen({ layout: "pyramid" }, "fmt");
  const { solution: _, ...bare } = p;
  const text = dealFormat.serialize!(p);
  expect(dealFormat.detect!(text)).toBe(true);
  expect(dealFormat.parse(text)).toEqual(bare);
  expect(() => dealFormat.parse("small 1D")).toThrow("36");
  expect(() => dealFormat.parse(`small ${Array.from({ length: 36 }, (_, i) => (i === 0 ? "2D" : "1D")).join(" ")}`)).toThrow("pair");
});
