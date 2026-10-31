import { expect, test } from "bun:test";
import { api } from "../../api";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import { Session } from "../../core/session";
import dataPack from "../pokemon-data/index";
import wordsPack from "../words-data/index";
import { answer, fitsAt, line, lookupOf, moveFree, offsets, orderDef, pinned, type DataSource, type OrderPuzzle, type OrderState } from "./logic";

const registry = new Registry();
for (const pack of [dataPack, wordsPack]) pack({ ...api, registry });
const data: DataSource = { get: (id) => registry.getDataset(id), list: () => registry.listDatasets() };
const def = orderDef(data);
const look = lookupOf(data.get("pokemon")!);
const gen = (params: Record<string, unknown>, seed: string) => generate(def, params, seed, new AbortController().signal) as Promise<OrderPuzzle>;
const base = { dataset: "pokemon", high: true, tries: 2, marks: "near" as const, lives: 1 };
const fresh = (): OrderState => ({ order: [], tries: [], results: [] });

test("offsets: how far each sits from where its value belongs; equal values may go either way", () => {
  expect(offsets([3, 1, 2], true)).toEqual([0, 1, -1]);
  expect(offsets([3, 1, 2], false)).toEqual([2, -1, -1]);
  expect(offsets([5, 5, 1], true)).toEqual([0, 0, 0]);
  expect(offsets([1, 5, 5], true)).toEqual([2, 0, -1]);
});

test("moving shifts the free items and never a pinned one", () => {
  const order = ["a", "b", "c", "d", "e"];
  expect(moveFree(order, [false, false, false, false, false], 0, 3)).toEqual(["b", "c", "d", "a", "e"]);
  expect(moveFree(order, [false, false, true, false, false], 0, 4)).toEqual(["b", "d", "c", "e", "a"]);
  expect(moveFree(order, [false, false, true, false, false], 2, 0)).toBeNull();
});

test("sort: deterministic, the asked number, distinct values, never already sorted", async () => {
  expect(await gen({ mode: "sort" }, "x")).toEqual(await gen({ mode: "sort" }, "x"));
  for (let i = 0; i < 20; i++) {
    const p = await gen({ mode: "sort", count: 7, spread: i % 2 ? "close" : "any" }, `g${i}`);
    const vals = p.ids.map((id) => look.value(id, p.attrs[0]!));
    expect(p.ids).toHaveLength(7);
    expect(new Set(vals).size).toBe(7);
    expect(offsets(vals, p.high).some((o) => o !== 0)).toBe(true);
  }
});

test("sort: a try marks every place; right ones are pinned; the game ends sorted or out of tries", () => {
  // weights from the data: snorlax 460 kg, pikachu 6 kg, charizard 90.5 kg
  const p: OrderPuzzle = { ...base, mode: "sort", ids: ["pikachu", "snorlax", "charizard"], attrs: ["weight"] };
  let s = def.init(p);
  s = def.reduce(p, s, { type: "move", from: 0, to: 2 });
  s = def.reduce(p, s, { type: "move", from: 1, to: 2 });
  s = def.reduce(p, s, { type: "submit" });
  expect(s.tries[0]!.off).toEqual([0, 1, -1]);
  expect(pinned(s)).toEqual([true, false, false]);
  expect(def.reduce(p, s, { type: "move", from: 0, to: 1 })).toBe(s);
  const won = def.reduce(p, def.reduce(p, s, { type: "move", from: 2, to: 1 }), { type: "submit" });
  expect(def.isSolved(p, won)).toBe(true);
  expect(def.score!(p, won)).toEqual({ value: 2, label: "tries", better: "lower" });
  const lost = def.reduce(p, s, { type: "submit" });
  expect(def.isLost!(p, lost)).toBe(true);
  expect(def.shareText!(p, lost)).toBe("in order, weight: X/2\n🟩🟨🟨\n🟩🟨🟨");
});

test("sort: the hint places one where it belongs; a reveal ends revealed", async () => {
  const p = await gen({ mode: "sort", count: 8 }, "hint");
  let s = def.init(p);
  for (let k = 0; k < 8 && !def.isSolved(p, s); k++) for (const a of def.hint!(p, s)!.actions!) s = def.reduce(p, s, a);
  if (!def.isSolved(p, s)) s = def.reduce(p, s, { type: "submit" });
  expect(def.isSolved(p, s)).toBe(true);
  expect(s.tries).toHaveLength(1);
  const session = new Session(def, p, { kind: "generated", seed: "reveal", params: {}, generatorVersion: def.generatorVersion });
  session.dispatch({ type: "submit" });
  expect(session.reveal()).toBe(true);
  expect(session.outcome).toBe("revealed");
});

test("higher or lower: right and wrong by the values, ties either way, lives", () => {
  // bst: pikachu 320, raichu 485, pichu 205
  const p: OrderPuzzle = { ...base, mode: "last", ids: ["pikachu", "raichu", "pichu", "raichu"], attrs: ["bst", "bst", "bst"] };
  expect(answer(p, 0, look)).toBe("higher");
  expect(answer(p, 1, look)).toBe("lower");
  let s = def.reduce(p, fresh(), { type: "guess", dir: "higher" });
  s = def.reduce(p, s, { type: "guess", dir: "higher" });
  expect(s.results).toEqual([true, false]);
  expect(def.isLost!(p, s)).toBe(true);
  expect(def.reduce(p, s, { type: "guess", dir: "higher" })).toBe(s);
  expect(def.verdict!(p, s)).toBe("streak of 1");
  expect(def.shareText!(p, s)).toBe("higher or lower · base stat total\nstreak 1\n🟩🟥");
  const tie: OrderPuzzle = { ...base, mode: "last", ids: ["charmander", "charmander"], attrs: ["bst"] };
  expect(def.reduce(tie, fresh(), { type: "guess", dir: "lower" }).results).toEqual([true]);
  const two = { ...p, lives: 2 };
  let t = def.reduce(two, fresh(), { type: "guess", dir: "lower" });
  t = def.reduce(two, t, { type: "guess", dir: "lower" });
  expect(def.isLost!(two, t)).toBe(false);
  expect(def.score!(two, t)!.value).toBe(1);
});

test("a line: each new one goes into a gap; right or wrong it joins in its true place", () => {
  // weight: pikachu 6, charizard 90.5, snorlax 460, bulbasaur 6.9
  const p: OrderPuzzle = { ...base, mode: "line", lives: 2, ids: ["charizard", "snorlax", "pikachu", "bulbasaur"], attrs: ["weight"] };
  let s = fresh();
  expect(fitsAt(p, s, look, 0)).toBe(true); // snorlax above charizard
  s = def.reduce(p, s, { type: "place", at: 1 }); // snorlax below charizard: wrong
  expect(s.results).toEqual([false]);
  expect(line(p, s, look)).toEqual(["snorlax", "charizard"]);
  s = def.reduce(p, s, { type: "place", at: 2 }); // pikachu at the bottom: right
  expect(s.results).toEqual([false, true]);
  expect(def.hint!(p, s)!.message).toBe("it goes between Charizard and Pikachu");
  s = def.reduce(p, s, def.hint!(p, s)!.actions![0]!);
  expect(def.isSolved(p, s)).toBe(true);
  expect(line(p, s, look)).toEqual(["snorlax", "charizard", "bulbasaur", "pikachu"]);
});

test("every mode's solution clears its run; other datasets with numbers play too", async () => {
  for (const params of [{ mode: "sort" }, { mode: "line", length: 25 }, { mode: "last", length: 25, by: ["bst", "weight"] }]) {
    const p = await gen(params, "solve");
    const sol = def.solve!(p, def.init(p));
    if (!sol || !("moves" in sol)) throw new Error("no moves");
    const end = sol.moves.reduce((s, a) => def.reduce(p, s, a), def.init(p));
    expect([params.mode, def.isSolved(p, end)]).toEqual([params.mode, true]);
    expect(def.rules!(p).length).toBeGreaterThan(2);
  }
  for (const preset of def.presets!) await gen(preset.params, `preset ${preset.label}`);
});
