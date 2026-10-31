import { expect, test } from "bun:test";
import { api } from "../../api";
import { generate } from "../../core/generate";
import { Registry } from "../../core/registry";
import type { PokemonItem } from "../../lib/pokemon/types";
import pokemonPack from "../pokemon-data/index";
import wordsPack from "../words-data/index";
import { candidates, FINDABLE, makeOddOneOut, mistakesMade, type DataSource, type OddAction, type OddPuzzle, type OddState } from "./logic";

const registry = new Registry();
for (const pack of [pokemonPack, wordsPack]) pack({ ...api, registry });
const data: DataSource = { get: (id) => registry.getDataset(id), list: () => registry.listDatasets() };
const dataset = data.get("pokemon")!;
const items = dataset.items() as readonly PokemonItem[];
const diff = ((await Bun.file(new URL("../pokemon-data/shiny-diff.json", import.meta.url)).json()) as { diff: Record<string, number> }).diff;
const def = makeOddOneOut(data);
const gen = (params: Record<string, unknown>, seed: string) => generate(def, params, seed, new AbortController().signal) as Promise<OddPuzzle>;
const play = (p: OddPuzzle, actions: OddAction[]): OddState => actions.reduce((s, a) => def.reduce(p, s, a), def.init(p));
const wrongCell = (p: OddPuzzle, i: number) => (p.rounds[i]!.odd + 1) % (p.rounds[i]!.size ** 2);

test("the measurements cover every item with both sprites", () => {
  const both = items.filter((i) => i.media.includes("sprite") && i.media.includes("shiny"));
  expect(both.filter((i) => !(i.id in diff)).map((i) => i.id)).toEqual([]);
});

test("generation is deterministic, grows the grid, and never repeats a shiny", async () => {
  expect(await gen({}, "a")).toEqual(await gen({}, "a"));
  const p = await gen({ rounds: 10, start: 3, end: 6 }, "b");
  expect(p.rounds.map((r) => r.size)).toEqual([3, 3, 4, 4, 4, 5, 5, 5, 6, 6]);
  expect(new Set(p.rounds.map((r) => r.ids[0])).size).toBe(10);
  for (const r of p.rounds) {
    expect(r.ids.length).toBe(1);
    expect(r.odd).toBeLessThan(r.size ** 2);
    expect(diff[r.ids[0]!]!).toBeGreaterThanOrEqual(FINDABLE);
  }
});

test("rounds get subtler: later shinies differ less from their normal colors", async () => {
  let early = 0, late = 0;
  for (let k = 0; k < 20; k++) {
    const p = await gen({ rounds: 10 }, `r${k}`);
    early += diff[p.rounds[0]!.ids[0]!]!;
    late += diff[p.rounds[9]!.ids[0]!]!;
  }
  expect(early / 20).toBeGreaterThan(40);
  expect(late / 20).toBeLessThan(8);
});

test("a fixed difficulty stays in its band", async () => {
  const ranked = candidates(items, dataset.media!.shiny!, dataset.media!.sprite!).map((i) => diff[i.id]!).sort((a, b) => b - a);
  const p = await gen({ rounds: 8, difficulty: "hard" }, "h");
  for (const r of p.rounds) expect(diff[r.ids[0]!]!).toBeLessThan(ranked[Math.floor(ranked.length * 0.6)]!);
});

test("different pokémon: the odd one appears once among others", async () => {
  const p = await gen({ grid: "mixed", start: 4, end: 4 }, "m");
  for (const r of p.rounds) {
    expect(r.ids.length).toBe(16);
    expect(r.ids.filter((id) => id === r.ids[r.odd]).length).toBe(1);
  }
});

test("only datasets with variant pictures are offered", () => {
  const opts = def.params.dataset.options;
  expect((typeof opts === "function" ? opts() : opts).map((o) => o.value)).toEqual(["pokemon"]);
});

test("finding the shiny moves on; a wrong pick costs a mistake and can't be repeated", async () => {
  const p = await gen({ rounds: 3, mistakes: 1 }, "c");
  let s = play(p, [{ type: "pick", cell: wrongCell(p, 0) }]);
  expect(mistakesMade(s)).toBe(1);
  expect(def.reduce(p, s, { type: "pick", cell: wrongCell(p, 0) })).toBe(s);
  s = def.reduce(p, s, { type: "pick", cell: p.rounds[0]!.odd });
  expect(s.rounds.length).toBe(2);
  expect(def.reduce(p, s, { type: "timeout" })).toBe(s);
  s = def.reduce(p, s, { type: "pick", cell: wrongCell(p, 1) });
  expect(def.isLost!(p, s)).toBeTruthy();
  expect(def.reduce(p, s, { type: "pick", cell: p.rounds[1]!.odd })).toBe(s);
  expect(def.score!(p, s)).toEqual({ value: 98, label: "1/3 found, 2 mistakes", better: "higher" });
  expect(def.shareText!(p, s)).toBe("odd one out (shiny sprite) 1/3 · out at round 2\n🟨🟥⬛");
});

test("running out of time counts as a mistake and ends the round", async () => {
  const p = await gen({ rounds: 2, time: 5, mistakes: 2 }, "t");
  const s = play(p, [{ type: "timeout" }, { type: "pick", cell: p.rounds[1]!.odd }]);
  expect(def.isSolved(p, s)).toBe(true);
  expect(def.score!(p, s)!.label).toBe("1/2 found, 1 mistake");
  expect(def.shareText!(p, s)).toBe("odd one out (shiny sprite) 1/2 · 1 mistake\n🟥🟩");
});
