import { expect, test } from "bun:test";
import { api } from "../../api";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import pokemonData from "../pokemon-data/index";
import pack from "./index";
import { answer, lookupOf, reduce, shareText, type HLPuzzle, type HLState } from "./logic";

const registry = new Registry();
pokemonData({ ...api, registry });
pack({ ...api, registry });
const def = registry.getPuzzle("pokemon-higher-lower")!;
const ds = registry.getDataset("pokemon")!;
const look = lookupOf(ds);
const make = (params: Record<string, unknown>, seed = "s") => generate(def, params, seed, new AbortController().signal) as Promise<HLPuzzle>;

test("a seed gives the same run; another seed a different one", async () => {
  expect(await make({}, "a")).toEqual(await make({}, "a"));
  expect((await make({}, "a")).seq).not.toEqual((await make({}, "b")).seq);
});

test("the run is drawn from the pool without repeats, as long as asked", async () => {
  const p = await make({ pool: "form:default gen:1", length: 500 });
  expect(p.seq.length).toBe(151);
  expect(new Set(p.seq).size).toBe(151);
  for (const id of p.seq) expect(look.item(id).values.gen).toBe("1");
  expect((await make({ length: 20 })).seq.length).toBe(20);
});

test("several attributes: each round asks about one of them", async () => {
  const p = await make({ attributes: ["hp", "spe"] });
  expect(new Set(p.attrs)).toEqual(new Set(["hp", "spe"]));
  expect(p.attrs.length).toBe(p.seq.length - 1);
});

test("a bad pool says what's wrong", async () => {
  await expect(make({ pool: "gen:1 type:nope" })).rejects.toThrow();
  await expect(make({ attributes: [] })).rejects.toThrow(/at least one/);
});

/** A run made by hand: pikachu (bst 320) → raichu (485) → pichu (205) → pichu-like tie. */
const handmade: HLPuzzle = { seq: ["pikachu", "raichu", "pichu", "pikachu"], attrs: ["bst", "bst", "bst"], lives: 1 };

test("right and wrong answers by the values", () => {
  expect(answer(handmade, 0, look)).toBe("higher");
  expect(answer(handmade, 1, look)).toBe("lower");
  const s1 = reduce(handmade, { results: [] }, { type: "guess", dir: "higher" }, look);
  expect(s1.results).toEqual([true]);
  const s2 = reduce(handmade, s1, { type: "guess", dir: "higher" }, look);
  expect(s2.results).toEqual([true, false]);
  // one life: game over, nothing more counts
  expect(def.isLost!(handmade, s2)).toBe(true);
  expect(def.isSolved(handmade, s2)).toBe(false);
  expect(reduce(handmade, s2, { type: "guess", dir: "higher" }, look)).toBe(s2);
});

test("a tie is right either way", () => {
  const tie: HLPuzzle = { seq: ["charmander", "charmander", "charmander"], attrs: ["bst", "spe"], lives: 1 };
  expect(answer(tie, 0, look)).toBeNull();
  expect(reduce(tie, { results: [] }, { type: "guess", dir: "lower" }, look).results).toEqual([true]);
  expect(reduce(tie, { results: [] }, { type: "guess", dir: "higher" }, look).results).toEqual([true]);
});

test("lives: the run goes on after a mistake until they're used up", () => {
  const p = { ...handmade, lives: 2 };
  let s: HLState = { results: [] };
  s = reduce(p, s, { type: "guess", dir: "lower" }, look);
  expect(s.results).toEqual([false]);
  expect(def.isLost!(p, s)).toBe(false);
  s = reduce(p, s, { type: "guess", dir: "lower" }, look);
  expect(s.results).toEqual([false, true]);
  s = reduce(p, s, { type: "guess", dir: "lower" }, look);
  expect(s.results).toEqual([false, true, false]);
  expect(def.isLost!(p, s)).toBe(true);
  expect(def.isSolved(p, s)).toBe(false);
  expect(def.score!(p, s)!.value).toBe(1);
});

test("the answer clears the whole run; score counts right answers", async () => {
  const p = await make({ length: 30, attributes: ["bst", "weight"] });
  const sol = def.solve!(p, def.init(p));
  if (!sol || !("moves" in sol)) throw new Error("no moves");
  const end = sol.moves.reduce((s, a) => def.reduce(p, s, a), def.init(p) as HLState);
  expect(end.results).toEqual(Array(29).fill(true));
  expect(def.isSolved(p, end)).toBe(true);
  expect(def.score!(p, end)).toEqual({ value: 29, label: "29 right", better: "higher" });
});

test("share text shows the score and the rounds, not the pokémon", () => {
  const text = shareText("higher or lower", handmade, { results: [true, false] });
  expect(text).toBe("higher or lower · base stat total\nstreak 1\n🟩🟥");
  expect(text).not.toMatch(/pikachu|raichu/i);
});
