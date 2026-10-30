import { expect, test } from "bun:test";
import { api } from "../../api";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import dataPack from "../pokemon-data/index";
import { makeSort, moveFree, offsets, pinned, type SortPuzzle, type SortState } from "./logic";

const registry = new Registry();
dataPack({ ...api, registry });
const data = registry.getDataset("pokemon")!;
const game = makeSort(() => data);
const def = game.def;
const gen = (params: Record<string, unknown>, seed: string) => generate(def, params, seed, new AbortController().signal) as Promise<SortPuzzle>;

test("offsets: how far each sits from where its value belongs; equal values may go either way", () => {
  expect(offsets([3, 1, 2], true)).toEqual([0, 1, -1]);
  expect(offsets([3, 1, 2], false)).toEqual([2, -1, -1]);
  expect(offsets([5, 5, 1], true)).toEqual([0, 0, 0]);
  expect(offsets([1, 5, 5], true)).toEqual([2, 0, -1]);
});

test("moving shifts the free items and never a pinned one", () => {
  const order = ["a", "b", "c", "d", "e"];
  expect(moveFree(order, [false, false, false, false, false], 0, 3)).toEqual(["b", "c", "d", "a", "e"]);
  // c is pinned: a goes to the end of the free list, b and d shift around c
  expect(moveFree(order, [false, false, true, false, false], 0, 4)).toEqual(["b", "d", "c", "e", "a"]);
  expect(moveFree(order, [false, false, true, false, false], 2, 0)).toBeNull();
});

test("generation: deterministic, the asked number, distinct values, never already sorted", async () => {
  expect(await gen({}, "x")).toEqual(await gen({}, "x"));
  for (let i = 0; i < 20; i++) {
    const p = await gen({ count: 7, spread: i % 2 ? "close" : "any" }, `g${i}`);
    const vals = p.ids.map((id) => game.value(p, id));
    expect(p.ids).toHaveLength(7);
    expect(new Set(vals).size).toBe(7);
    expect(offsets(vals, p.high).some((o) => o !== 0)).toBe(true);
  }
});

test("a try marks every place; right ones are pinned; the game ends sorted or out of tries", () => {
  // weights from the data: snorlax 460 kg, pikachu 6 kg, charizard 90.5 kg
  const p: SortPuzzle = { ids: ["pikachu", "snorlax", "charizard"], attr: "weight", high: true, tries: 2, feedback: "near" };
  let s: SortState = def.init(p);
  s = def.reduce(p, s, { type: "move", from: 0, to: 2 }); // snorlax, charizard, pikachu: right
  s = def.reduce(p, s, { type: "move", from: 1, to: 2 }); // snorlax, pikachu, charizard
  s = def.reduce(p, s, { type: "submit" });
  expect(s.tries[0]!.off).toEqual([0, 1, -1]);
  expect(pinned(s)).toEqual([true, false, false]);
  expect(def.reduce(p, s, { type: "move", from: 0, to: 1 })).toBe(s);
  expect(def.isLost!(p, s)).toBe(false);
  const won = def.reduce(p, def.reduce(p, s, { type: "move", from: 2, to: 1 }), { type: "submit" });
  expect(def.isSolved(p, won)).toBe(true);
  expect(def.score!(p, won)).toEqual({ value: 2, label: "tries", better: "lower" });
  const lost = def.reduce(p, s, { type: "submit" });
  expect(def.isLost!(p, lost)).toBe(true);
  expect(def.score!(p, lost)).toBeNull();
  expect(def.shareText!(p, lost)).toBe("pokémon sort, weight: X/2\n🟩🟨🟨\n🟩🟨🟨");
});

test("the hint places one pokémon where it belongs", async () => {
  const p = await gen({ count: 8 }, "hint");
  let s: SortState = def.init(p);
  for (let k = 0; k < 8 && !def.isSolved(p, s); k++) {
    const h = def.hint!(p, s)!;
    for (const a of h.actions!) s = def.reduce(p, s, a);
  }
  if (!def.isSolved(p, s)) s = def.reduce(p, s, { type: "submit" });
  expect(def.isSolved(p, s)).toBe(true);
  expect(s.tries).toHaveLength(1);
});

test("revealing after a wrong try keeps the right ones and ends revealed", async () => {
  const p = await gen({}, "reveal");
  const session = new Session(def, p, { kind: "generated", seed: "reveal", params: {}, generatorVersion: def.generatorVersion });
  session.dispatch({ type: "submit" });
  expect(session.reveal()).toBe(true);
  expect(session.outcome).toBe("revealed");
  expect(def.isSolved(p, session.state)).toBe(true);
});
