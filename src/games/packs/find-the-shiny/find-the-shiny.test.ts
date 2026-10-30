import { expect, test } from "bun:test";
import { generate } from "../../core/generate";
import { decode, type PokemonDataFile } from "../../lib/pokemon/codec";
import type { PokemonDataset } from "../../lib/pokemon/types";
import { candidates, FINDABLE, makeFindTheShiny, mistakesMade, type ShinyAction, type ShinyPuzzle, type ShinyState } from "./logic";

const file = (await Bun.file(new URL("../pokemon-data/data.json", import.meta.url)).json()) as PokemonDataFile;
const items = decode(file);
const diff = ((await Bun.file(new URL("./shiny-diff.json", import.meta.url)).json()) as { diff: Record<string, number> }).diff;
const dataset = { id: "pokemon", name: "pokémon", version: file.version, credits: "", attributes: file.attributes, items: () => items, tables: { typeChart: file.typeChart } } as PokemonDataset;
const def = makeFindTheShiny(() => dataset, diff);
const gen = (params: Record<string, unknown>, seed: string) => generate(def, params, seed, new AbortController().signal) as Promise<ShinyPuzzle>;
const play = (p: ShinyPuzzle, actions: ShinyAction[]): ShinyState => actions.reduce((s, a) => def.reduce(p, s, a), def.init(p));
const wrongCell = (p: ShinyPuzzle, i: number) => (p.rounds[i]!.shiny + 1) % (p.rounds[i]!.size ** 2);

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
    expect(r.shiny).toBeLessThan(r.size ** 2);
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
  const ranked = candidates(items, diff).map((i) => diff[i.id]!).sort((a, b) => b - a);
  const p = await gen({ rounds: 8, difficulty: "hard" }, "h");
  for (const r of p.rounds) expect(diff[r.ids[0]!]!).toBeLessThan(ranked[Math.floor(ranked.length * 0.6)]!);
});

test("different pokémon: one shiny among others of other species", async () => {
  const p = await gen({ grid: "mixed", start: 4, end: 4 }, "m");
  for (const r of p.rounds) {
    expect(r.ids.length).toBe(16);
    const base = items.find((i) => i.id === r.ids[r.shiny])!.base;
    expect(r.ids.filter((id) => items.find((i) => i.id === id)!.base === base).length).toBe(1);
  }
});

test("finding the shiny moves on; a wrong pick costs a mistake and can't be repeated", async () => {
  const p = await gen({ rounds: 3, mistakes: 1 }, "c");
  let s = play(p, [{ type: "pick", cell: wrongCell(p, 0) }]);
  expect(mistakesMade(s)).toBe(1);
  expect(def.reduce(p, s, { type: "pick", cell: wrongCell(p, 0) })).toBe(s);
  s = def.reduce(p, s, { type: "pick", cell: p.rounds[0]!.shiny });
  expect(s.rounds.length).toBe(2);
  expect(def.reduce(p, s, { type: "timeout" })).toBe(s);
  s = def.reduce(p, s, { type: "pick", cell: wrongCell(p, 1) });
  expect(def.isLost!(p, s)).toBeTruthy();
  expect(def.reduce(p, s, { type: "pick", cell: p.rounds[1]!.shiny })).toBe(s);
  expect(def.score!(p, s)).toEqual({ value: 98, label: "1/3 found, 2 mistakes", better: "higher" });
  expect(def.shareText!(p, s)).toBe("Find the shiny ✨ 1/3 · out at round 2\n🟨🟥⬛");
});

test("running out of time counts as a mistake and ends the round", async () => {
  const p = await gen({ rounds: 2, time: 5, mistakes: 2 }, "t");
  const s = play(p, [{ type: "timeout" }, { type: "pick", cell: p.rounds[1]!.shiny }]);
  expect(def.isSolved(p, s)).toBe(true);
  expect(def.score!(p, s)!.label).toBe("1/2 found, 1 mistake");
  expect(def.shareText!(p, s)).toBe("Find the shiny ✨ 1/2 · 1 mistake\n🟥🟩");
});
